# Real Split-Horizon DNS — Why the LAN Chip Fails, and What “Same URL Everywhere” Actually Needs

This note explains, in plain language, the bug you hit when you clicked **LAN** on a container, what split-horizon DNS really is, and why a DNS server by itself is not enough to make `https://app.home-cloud.live` fast at home.

It is the “why” companion to [`split_horizon_dns_and_local_lan_switching.md`](./split_horizon_dns_and_local_lan_switching.md), which describes the **client-side shortcut** that is in the code today.

Nothing in this file is implemented as a running DNS server. Treat it as the design explanation.

---

## 📑 Table of Contents

1. [The thing that actually broke](#1-the-thing-that-actually-broke)
2. [DNS in two minutes](#2-dns-in-two-minutes)
3. [What split-horizon DNS means](#3-what-split-horizon-dns-means)
4. [What Home Cloud does today (not DNS)](#4-what-home-cloud-does-today-not-dns)
5. [Why a private `ip:port` tab dies](#5-why-a-private-ipport-tab-dies)
6. [Why DNS alone is still not enough](#6-why-dns-alone-is-still-not-enough)
7. [The three pieces of a real setup](#7-the-three-pieces-of-a-real-setup)
8. [The three traffic paths](#8-the-three-traffic-paths)
9. [The catch: who asks our DNS?](#9-the-catch-who-asks-our-dns)
10. [What “make the click work” really means](#10-what-make-the-click-work-really-means)
11. [How you would tell it is working](#11-how-you-would-tell-it-is-working)
12. [How this maps to this machine right now](#12-how-this-maps-to-this-machine-right-now)

---

## 1. The thing that actually broke

You start a container (for example nginx published as `0.0.0.0:8080 → 80`). The Docker row shows a green **LAN** chip. You click it. A new tab opens something like:

```
http://192.168.1.50:8080
```

The tab says **website not reachable**.

That is not Cloudflare being down, and it is not nginx being down. From the spare PC itself that URL returns HTTP 200 (“Welcome to nginx!”). The new tab fails because **the browser that opened it cannot reach that private address**.

The LAN chip is a link, not a DNS lookup:

```tsx
href={`http://${net.serverLocalIp}:${firstPublicPort}`}
```

So the browser is told, in the clear: “go talk to this house-internal IP on this port.” If that browser is not on the same Layer-3 network as the spare PC, the packet has nowhere to go.

Typical cases where the tab dies:

| Where the browser actually is | What `192.168.1.50:8080` means to it |
|---|---|
| Phone on 4G / another Wi‑Fi, dashboard opened via `dash.home-cloud.live` | A stranger’s private IP. Unreachable. |
| Laptop on home Wi‑Fi, spare PC on ethernet, home router isolating Wi‑Fi from LAN | Same house, different islands. Unreachable. |
| VS Code Remote / WSL: click opens a tab on **Windows**, not inside Linux | Windows may not share that route, or uses a different DNS/firewall. Often unreachable. |
| Same machine, same network namespace | Works. This is the case where the private address is reachable. |

The chip is also shown whenever the Agent knows its own LAN IP **and** the container has a published port. It does **not** check that *your* browser is on that LAN. So it looks like “LAN is ready” even when the click cannot possibly work.

---

## 2. DNS in two minutes

A hostname is a name. An IP address is where packets go. DNS is the phonebook that turns one into the other.

```
You type:  https://test-ngnix.home-cloud.live
Browser asks DNS:  “what IP is that?”
DNS answers:       104.x.x.x     (Cloudflare, today)
Browser connects:  to that IP, port 443, Host: test-ngnix.home-cloud.live
```

Important details:

- The **name** in the address bar never has to change.
- Only the **answer** (the IP) can change.
- After HTTPS, the browser also sends a `Host` header so one IP can serve many apps (`dash`, `jellyfin`, `test-ngnix`, …).
- Your phone, laptop, and the spare PC each do their own DNS lookup, using **whichever DNS server that device is configured to use** (usually whatever the router handed out over DHCP: the ISP resolver, `1.1.1.1`, `8.8.8.8`, …).

Public DNS for `home-cloud.live` is Cloudflare. Every device on the internet that asks Cloudflare “what is `dash.home-cloud.live`?” gets a Cloudflare anycast IP. Traffic then goes:

```
Browser ──HTTPS──► Cloudflare Edge ──tunnel──► cloudflared on the spare PC ──► localhost:port
```

That path **always works** (agent + tunnel up, app exposed). It is also **slow at home**, because packets leave the house and come back, capped by the ISP upload.

---

## 3. What split-horizon DNS means

**Split-horizon** (also called split-view or dual-horizon) means:

> The **same name** returns a **different IP** depending on who asked.

```
                    “what is test-ngnix.home-cloud.live?”

         asked from home Wi‑Fi                    asked from 4G / a café
                    │                                          │
                    ▼                                          ▼
         local DNS on the spare PC                  public Cloudflare DNS
         answers: 192.168.1.50                    answers: Cloudflare anycast
                    │                                          │
                    ▼                                          ▼
         packets stay in the house                  packets go out to CF and
         (gigabit, < 2 ms)                          back down the tunnel
```

The user always opens `https://test-ngnix.home-cloud.live`. No `ip:port`. No second button. The phonebook is what changes.

This is how companies do `intranet.company.com` (private IP inside the office, unreachable or different outside). Pi-hole and BIND 9 do the same with `view` blocks or local DNS records.

It is **not** what the LAN chip does. The LAN chip skips the phonebook and writes the private IP into the URL.

---

## 4. What Home Cloud does today (not DNS)

V3 called this “smart split-horizon DNS.” What shipped is a **client-side guess**:

1. Dashboard calls `GET /api/network/info`.
2. Agent looks at Linux interfaces, skips `docker0` / `veth` / `br-` / `tun`, returns something like `serverLocalIp: "192.168.1.50"`.
3. Dashboard tries a 1.5 s ping to `http://192.168.1.50:3000/api/health`.
4. If that works, it may redirect the **dashboard tab** to `http://192.168.1.50:3000`.
5. Container LAN chips always open `http://LAN_IP:publishedPort`.

There is no BIND, no Pi-hole, no CoreDNS, no local `:53` listener. `*.home-cloud.live` always resolves to Cloudflare, for everyone.

What the probes actually return, and the crack that remains:

- **`/api/health` and `/api/ping` are public.** Neither requires a JWT. `/api/ping` returns `{ status: "ok" }`. `/api/health` returns `{ status: "ok", shuttingDown }`. A CORS ping from the dashboard origin to `http://LAN_IP:3000/api/health` or `/api/ping` is not rejected for a missing session cookie.
- **Redirecting to `http://IP:3000` still fights the browser.** The session cookie is `Secure` on HTTPS and host-only. Cloudflare may have set HSTS. Mixed content blocks `http://` fetches from an `https://` page. A new tab is allowed to open `http://`, but the dashboard itself is a bad origin to live on.

So today you have a label that says LAN, a link that is a private IP, and no phonebook that would make the *real* hostname local.

---

## 5. Why a private `ip:port` tab dies

`192.168.1.50` is an **RFC 1918** address. Routers on the internet will not forward it. Only devices that share `192.168.1.0/24` (and are not isolated from each other) can open a TCP connection to it.

```
[ Your browser ]  ── tries TCP ──►  192.168.1.50:8080

  on the spare PC itself     SYN/ACK, nginx 200     ✅
  on another LAN device      maybe, if no AP isolation
  on 4G / café / office      black hole              ❌
  on Windows, app in WSL     maybe, depends on mirrored
                             networking + firewall   ❓
```

The container can be healthy. Docker can be bound to `0.0.0.0:8080`. The Agent can even report the correct LAN IP. The click still fails if **that browser** is not a neighbor on that subnet.

That is why “it opens `ip:port` in a new window and the website is not reachable” is expected with the current chip, not a mystery Docker bug.

---

## 6. Why DNS alone is still not enough

Suppose we only add a DNS server that answers:

```
test-ngnix.home-cloud.live.   30  IN  A  192.168.1.50
```

The browser now goes to `https://test-ngnix.home-cloud.live`. Three more problems show up immediately.

### 6.1 The port is wrong

The URL is HTTPS, so the browser connects to **port 443**. Nginx is published on **8080**. Nothing is listening on `192.168.1.50:443` today. Connection refused.

Cloudflare’s job, remotely, is exactly this translation:

```
Host: test-ngnix.home-cloud.live  +  :443  →  localhost:8080
```

On LAN you need the same translation sitting on the spare PC.

### 6.2 The certificate is wrong

Cloudflare presents a trusted cert for `*.home-cloud.live`. Your nginx default page does not. A homemade cert will show a scary warning. A Cloudflare **origin** certificate is only trusted by Cloudflare, not by Chrome.

So the LAN proxy must get a **publicly trusted** cert (Let’s Encrypt) for `home-cloud.live` and `*.home-cloud.live`.

HTTP-01 (Let’s Encrypt hitting `:80` on the public internet) cannot reach this PC — CGNAT, no inbound ports. The only workable challenge is **DNS-01** against the Cloudflare zone, using the existing `CF_API_TOKEN`.

### 6.3 HSTS will refuse HTTP

If you have ever opened `https://dash.home-cloud.live`, the browser may remember HSTS: “this name is HTTPS-only.” Then `http://dash.home-cloud.live` is upgraded to HTTPS before a single packet is sent. Serving HTTP on `:80` at home is not a real fallback.

**Bottom line:** split-horizon DNS without a local HTTPS reverse proxy just moves the failure from “not reachable” to “connection refused” or “certificate invalid.”

---

## 7. The three pieces of a real setup

```
                         same URL everywhere
                    https://test-ngnix.home-cloud.live
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
            device uses our DNS              device uses 1.1.1.1 / the ISP resolver
                    │                               │
                    ▼                               ▼
         ① Local DNS (:53)                  Public Cloudflare DNS
         A 192.168.1.50                   A  Cloudflare anycast
                    │                               │
                    ▼                               ▼
         ② Local HTTPS proxy                Cloudflare Edge + tunnel
            :443, real LE cert              ③ already exists
            Host → localhost:8080           Host → localhost:8080
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
                           nginx (or any app)
```

### ① Local DNS (the actual split horizon)

A DNS server on the spare PC, bound to the **LAN IP** (e.g. `192.168.1.50:53`), not to `127.0.0.53` (that address is often the local stub resolver).

For names we own:

```
*.home-cloud.live      →  <current LAN IP>
dash.home-cloud.live   →  <current LAN IP>
```

For everything else (`google.com`, `netflix.com`, …): **forward** to `1.1.1.1` or the router. We are not trying to become the whole internet’s DNS, only to override our own zone.

The LAN IP must be **rewritten when DHCP changes**. Hardcoding `192.168.1.50` in a zone file is how Pi-hole setups rot after a router reboot. The Agent already knows how to read `os.networkInterfaces()` and skip Docker bridges — that same function should refresh the DNS records.

A wildcard in CoreDNS is enough. New containers do not need a new DNS record; they need a new **proxy** route.

Why Docker, not a Node process? This user cannot bind ports 53 / 80 / 443 (`ip_unprivileged_port_start=1024`, no passwordless sudo). A container can.

### ② Local HTTPS reverse proxy

Something that listens on `:80` and `:443` on the spare PC and routes by `Host`, the same way `cloudflared` already does from `~/.cloudflared/config.yml`:

| Host header | Upstream |
|---|---|
| `dash.home-cloud.live` | `127.0.0.1:3000` (Agent + dashboard + WebSockets) |
| `test-ngnix.home-cloud.live` | `127.0.0.1:8080` |
| `jellyfin.home-cloud.live` | `127.0.0.1:8096` |
| anything unknown | 404 |

TLS: one wildcard Let’s Encrypt cert via Cloudflare DNS-01 (`CF_API_TOKEN`, `CF_ZONE_ID`, `CF_DOMAIN`). Then every new subdomain is already trusted.

WebSockets for the terminal must be passed through (Traefik / Caddy do this by default).

The Agent should regenerate this route table whenever:

- a container is started with a published port,
- a container is exposed / unexposed,
- the LAN IP changes.

A small request header, e.g. `X-Homecloud-Via: lan`, lets the dashboard know the hit came through the local proxy rather than the tunnel. Same URL, honest tray label.

### ③ Public Cloudflare path (already there)

Leave public DNS and the tunnel alone. That **is** the other horizon.

- `dash.home-cloud.live` CNAME → `<tunnel-id>.cfargotunnel.com` (proxied)
- optional `*.home-cloud.live` wildcard CNAME, or a CNAME per expose
- `cloudflared` ingress: Host → `localhost:<port>`

If a device does **not** use our local DNS, it still gets Cloudflare, and the page still loads — just via the slow path. That is the correct fail-open.

Do **not** auto-expose every published port to the internet. Redis on `6379` should not become `https://my-redis.home-cloud.live` on the public tunnel. Local DNS+proxy can know about it; Cloudflare should only know about apps the user explicitly **Expose**s.

---

## 8. The three traffic paths

Use this when debugging “why is this tab slow / dead / fine?”

### Path A — At home, device uses our DNS (the goal)

```
https://test-ngnix.home-cloud.live
        │
        ▼
  DNS 192.168.1.50:53  →  A 192.168.1.50
        │
        ▼
  TCP 192.168.1.50:443
        │
        ▼
  local proxy (valid cert, Host header)
        │
        ▼
  127.0.0.1:8080  nginx
```

Gigabit, no ISP, no Cloudflare. Address bar still says `https://test-ngnix.home-cloud.live`.

### Path B — At home, device still uses the ISP resolver / 1.1.1.1 (very common)

```
https://test-ngnix.home-cloud.live
        │
        ▼
  public DNS  →  Cloudflare IP
        │
        ▼
  out to the internet, back down the tunnel
        │
        ▼
  cloudflared  →  localhost:8080
```

Works **only if** that hostname is in Cloudflare ingress (the app was **Exposed**). Slow. This is today’s normal path.

If the app was never exposed, this path is a Cloudflare 404. That is why an unexposed container’s LAN chip cannot be “fixed” by hostname alone unless you are on Path A.

### Path C — Not at home (4G, café)

Same as Path B. Private `192.168.1.50:8080` must never be the link you put in the tab. The hostname is the only URL that can work here.

---

## 9. The catch: who asks our DNS?

Starting CoreDNS on the spare PC does **not** make the house use it.

DHCP on the home router (`192.168.1.1`) tells every phone and laptop: “your DNS is *me*” (or the ISP resolver). Those devices will never send a query to `192.168.1.50:53` until someone changes that.

| What you configure | Who gets split-horizon |
|---|---|
| CoreDNS listening on the spare PC | Only clients that **choose** that IP as DNS |
| Router DHCP → DNS `192.168.1.50` | Every device that uses automatic DNS |
| `/etc/hosts` or systemd-resolved on the spare PC | Only that machine |
| Windows hosts file (needs Admin) | Only that Windows install |
| Nothing | Everyone stays on Path B / C |

This PC is **not** the default gateway. We cannot intercept other devices’ port 53 with iptables on the spare PC. We are a sibling on the LAN, not the router.

So a complete rollout is:

1. Run local DNS + TLS proxy (code).
2. Tell the human: set the router’s LAN DNS to the spare PC’s IP (and ideally a DHCP reservation so that IP does not move).
3. Keep the tunnel so Path B/C never break.

If the spare PC is down, and it was the only DNS, the whole house loses name resolution. Forwarding “everything else” to `1.1.1.1` is mandatory, and the router should have a secondary DNS (`1.1.1.1`) if the UI allows it.

---

## 10. What “make the click work” really means

Two different jobs get mixed up. They should stay separate.

**Job 1 — The click must not open a dead private IP.**  
The Docker row should open `https://<name>.home-cloud.live`, the same as the green globe / Expose badge. Remote users then get Path C. Home users without our DNS get Path B. Nobody gets `http://192.168.x.x:8080` as the primary action.

**Job 2 — When you *are* home and using our DNS, that same name is local and fast.**  
That is real split-horizon: CoreDNS + TLS proxy + Agent keeping routes and the LAN IP fresh.

Job 1 fixes the bug you saw. Job 2 is the speed feature. Doing Job 2 without Job 1 still leaves a chip that lies. Doing Job 1 without Job 2 still hairpins through Cloudflare on the couch.

The dashboard tray can then be honest:

- hostname is a private IP → “direct LAN” (old shortcut, if anyone still uses it),
- request arrived with `X-Homecloud-Via: lan` → “LAN (split-horizon)”,
- otherwise → “Tunnel”.

No more auto-redirect to `http://192.168.1.50:3000`. That redirect undoes HTTPS, cookies, and HSTS.

---

## 11. How you would tell it is working

Run these from the **same device whose browser you care about**, not only from the spare PC.

```bash
# 1. Does this device even use our DNS?
resolvectl status          # Linux
# or: nslookup test-ngnix.home-cloud.live

# 2. What IP did we get?
#    Home + our DNS:  192.168.1.50
#    Everyone else:   a Cloudflare anycast IP (104.x / 172.64.x / …)

# 3. Does local HTTPS answer with our cert?
curl -vI --max-time 5 https://test-ngnix.home-cloud.live/
#    Path A:  connected to 192.168.1.50:443, Let's Encrypt
#    Path B/C: connected to Cloudflare, CF cert

# 4. Does the raw container still work on the server itself?
curl -sS -o /dev/null -w "%{http_code}\n" http://192.168.1.50:8080/
```

If step 1 shows the ISP resolver / `1.1.1.1` / `8.8.8.8`, split-horizon is installed but **unused**. Fix the router, not the container.

If step 2 is the LAN IP but step 3 fails, DNS is fine and the proxy/cert is not.

If step 4 fails on the spare PC, Docker publishing is the bug — not DNS.

---

## 12. Example snapshot (generic homelab)

These values are examples, not a reading from one machine:

| Fact | Example |
|---|---|
| LAN address the agent would pick | `192.168.1.50` on the LAN interface |
| Docker bridge (skipped) | `172.17.0.1` on `docker0` |
| Example container | `test-nginx` published as `0.0.0.0:8080→80/tcp` |
| `curl http://192.168.1.50:8080` from the spare PC | nginx 200, when that container is running |
| Process on `:53` for that LAN address | none, until you run a local DNS server |
| Process on `:80` / `:443` | none, until you run a local TLS proxy |
| BIND / Pi-hole / CoreDNS | not part of Home Cloud |
| Home router | `192.168.1.1` |

So: the app can be reachable on the LAN address from the server, public hostname routing exists via Cloudflare when the tunnel is up, and split-horizon is not running inside Home Cloud. The LAN chip is a shortcut that writes the private IP into a new tab. That is why the tab died.

---

## Related reading

- [`split_horizon_dns_and_local_lan_switching.md`](./split_horizon_dns_and_local_lan_switching.md) — client-side detector, 1.5 s ping, page-origin redirect (what the code does today).
- [`cloudflare_tunnels.md`](./cloudflare_tunnels.md) — why the remote path exists (CGNAT, outbound QUIC, Host-header ingress).
- [`cloudflare_ingress_autowiring.md`](./cloudflare_ingress_autowiring.md) — how expose writes `config.yml` and (planned) Cloudflare CNAMEs.
- [`../SYSTEM_DESIGN.md`](../SYSTEM_DESIGN.md) §6.5 — as-built: “LAN vs tunnel is client-side, not DNS.”
