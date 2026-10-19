# Cloudflare Tunnels & Ingress Routing: Under the Hood

This guide explains the architecture, protocol, and networking mechanics behind Cloudflare Tunnels (`cloudflared`) and how dynamic ingress routing enables zero-downtime, secure self-hosting without public port forwarding.

---

## 1. Traditional Self-Hosting vs. Cloudflare Tunnels

To understand the beauty of Cloudflare Tunnels, let's contrast them with standard home-hosting:

```
[ Traditional Web Hosting ]
Browser ──► Internet ──► Router Firewall (Needs Port 80/443 Open) ──► Port Forwarding ──► Spare PC (Port 3000)
* Security Risk: Exposes your home's public IP address to scanners and DDoS attacks.
* ISP Hurdles: Many consumer ISPs block ports 80/443 or use Carrier-Grade NAT (CGNAT), making inbound traffic impossible.
```

```
[ Cloudflare Tunnel Connection ]
Browser ──► Cloudflare Edge (SSL terminates here)
                  ▲
                  │  4 Outbound QUIC/UDP Connections (Established by host daemon)
                  ▼
Router Firewall (STRICT: All Inbound Ports Closed) ◄── Spare PC (cloudflared daemon) ──► Local HTTP (localhost:3000)
* Security Profile: No inbound ports are opened. Your public IP is completely hidden.
* Bypasses NAT: Works seamlessly behind CGNAT, double NAT, and strict firewalls.
```

---

## 2. Tunnel Architecture: The 4-Socket Structure

When the `cloudflared` daemon starts up on your spare PC, it reads your credentials and initiates **outbound connections** to the nearest Cloudflare Edge locations. 

* **Physical Protocol:** By default, it uses **QUIC (UDP-based)**, falling back to TCP if UDP is blocked by your firewall.
* **Redundancy (4 Connections):** Cloudflare opens **4 persistent connections** to different, physically separated Edge data centers (e.g., `del02`, `del05`, `del06` in India).
* **Traffic Flow:** If one Edge datacenter experiences packet loss or power outages, Cloudflare instantly routes web traffic through the remaining 3 active tunnels without dropping active client connections.

---

## 3. How DNS Integration Works

When you create a hostname like `dash.home-cloud.live` and bind it to your tunnel:

1. Cloudflare automatically inserts a CNAME record in your domain's DNS panel pointing to:
   `[TUNNEL_UUID].cfargotunnel.com`
2. When a visitor's browser requests `dash.home-cloud.live`, the DNS lookup resolves to Cloudflare's Edge IPs.
3. The Edge server matching that request checks which active tunnel connections are currently linked to `[TUNNEL_UUID]`.
4. The Edge server forwards the browser's HTTP request down one of the persistent QUIC streams inside your tunnel connection.

---

## 4. What is Ingress?

In networking, **Ingress** simply refers to **incoming traffic**—data entering a network from the outside world. (Conversely, **Egress** refers to outgoing traffic leaving a network).

An **Ingress Controller** or **Ingress Rule** acts as the gatekeeper at the entry point of your network. It inspects incoming packets, determines their destination, and routes them to the correct internal service.

When using Cloudflare, the `ingress` section in `config.yml` is your **routing table**. It defines how traffic entering your Spare PC from the Cloudflare network should be distributed to your locally running apps.

---

## 5. How One Tunnel Serves Apps on Different Ports (The Host Header Magic)

A single Cloudflare Tunnel is a single, multiplexed QUIC connection between your machine and Cloudflare. To understand how this one connection can split traffic to Nginx on port `80`, Jellyfin on port `8096`, and Node.js on port `3000`, we look at the **HTTP Host Header**.

### The Dispatcher flow:
```
Subdomain Request             Cloudflare Edge                 Spare PC (cloudflared)         Local Ports
"jellyfin.home-cloud.live" ──► Inspects Host Header ──► Sends down tunnel ──► Matches rule ──► http://localhost:8096
"gitea.home-cloud.live"    ──► Inspects Host Header ──► Sends down tunnel ──► Matches rule ──► http://localhost:3000
```

### The Step-by-Step Mechanics

1. **HTTP Host Headers:** When you type `https://jellyfin.home-cloud.live` in a browser, your browser sends an HTTP request containing a special header called `Host`:
   ```http
   GET /index.html HTTP/1.1
   Host: jellyfin.home-cloud.live
   User-Agent: Chrome/120.0
   ```
2. **Edge Processing:** The request hits Cloudflare’s Edge server. Because both `jellyfin.home-cloud.live` and `gitea.home-cloud.live` point to the *same* Cloudflare Tunnel UUID in DNS, Cloudflare sends both requests down the **exact same QUIC tunnel connection**.
3. **Local Dispatching:** The `cloudflared` daemon on your Spare PC receives the raw HTTP request bytes. It reads the `Host` header value (`jellyfin.home-cloud.live`).
4. **Local Proxying:** `cloudflared` acts as a **Reverse Proxy**. It looks at your `ingress` rules:
   - "If `Host` matches `jellyfin.home-cloud.live` → establish a connection to `localhost:8096`."
   - "If `Host` matches `gitea.home-cloud.live` → establish a connection to `localhost:3000`."
5. **Private Loopback:** `cloudflared` forwards the request locally to `127.0.0.1:8096`. To the Jellyfin container, it looks like a standard request coming from the local machine.
6. **No Port Exposition:** The ports `8096` and `3000` are **completely closed** to the public router. Only the local `cloudflared` daemon (which is inside your network) can talk to them.

---

## 6. Ingress Routing: The Local Traffic Cop

The `cloudflared` daemon running on your Spare PC acts as a **local reverse proxy** (similar to Nginx or Apache). It receives HTTP requests coming down the tunnel and uses the **Ingress Rules** configured in `config.yml` to decide where to route them.

### Example `config.yml`

```yaml
tunnel: <tunnel-id>
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json

ingress:
  # Rule 1: Match subdomain "dash"
  - hostname: dash.home-cloud.live
    service: http://localhost:3000

  # Rule 2: Match subdomain "files"
  - hostname: files.home-cloud.live
    service: http://localhost:3001

  # Rule 3: Catch-all fallback (Required: must be the last rule)
  - service: http_status:404
```

### The Path of a Request (Step-by-Step)
1. User visits `https://files.home-cloud.live/css/main.css`.
2. Request hits Cloudflare Edge → decrypted from HTTPS → sent down the tunnel socket.
3. The local `cloudflared` daemon receives the request headers.
4. It scans `config.yml` rules sequentially:
   - Does it match `dash.home-cloud.live`? **No.**
   - Does it match `files.home-cloud.live`? **Yes.**
5. `cloudflared` makes a local HTTP loopback connection:
   `GET http://localhost:3001/css/main.css`
6. Your local file app (port 3001) responds to `cloudflared` with the file.
7. `cloudflared` sends those bytes back up the tunnel.
8. Cloudflare Edge encrypts the response with SSL and sends it back to the browser.

---

## 5. WebSockets and SSE Multiplexing

A common question is: *How can multiple real-time streams (like stats SSE, terminal WebSockets, and log SSE) run simultaneously through the same tunnel?*

This is handled by **HTTP/2 stream multiplexing** inside the QUIC tunnel:
* The physical tunnel is a single TCP or QUIC connection.
* Inside this single connection, HTTP/2 can open hundreds of **logical streams** identified by unique IDs.
* A Server-Sent Events (SSE) stream simply keeps one logical stream open indefinitely. 
* Keystrokes on a WebSocket are sent as framing packets on another stream.
* All of this traffic shares the same physical network wire, preventing `cloudflared` from needing to spawn new network sockets for every client request.

---

## 6. Dynamic Configuration: Zero-Downtime Reloading (`SIGHUP`)

For a self-hosted App Store, we need to add subdomains dynamically (e.g. adding `https://jellyfin.home-cloud.live` on-the-fly). 

If we restarted the `cloudflared` service every time we added an app, it would sever the tunnel connections, causing the visitor to see a Gateway Error (`502`) for several seconds and dropping their active desktop socket sessions.

### The Signal Solution: `SIGHUP`
Instead of restarting, the system utilizes **Unix Signals** (specifically `SIGHUP` - Signal Hang Up, historically used to notify processes of terminal disconnection, but conventionally used to trigger configuration reloads).

1. The Node.js agent appends the new subdomain mapping to `config.yml` on disk:
   ```yaml
   - hostname: jellyfin.home-cloud.live
     service: http://localhost:8096
   ```
2. The agent finds the Process ID (PID) of the running `cloudflared` daemon.
3. The agent sends a `SIGHUP` signal to that process:
   ```javascript
   process.kill(cloudflaredPid, 'SIGHUP');
   ```
4. `cloudflared` catches the signal, re-reads `config.yml` off the disk, updates its routing table, and instantly registers the new route with the Cloudflare Edge servers.
5. All existing active connections (like your system dashboard session) continue running completely uninterrupted.
