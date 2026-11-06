---
title: Remote access
description: Reach the dashboard from anywhere with Cloudflare Tunnel, add it after install, and understand local LAN switching.
sidebar:
  order: 4
---

Remote access is optional. It uses a Cloudflare Named Tunnel, so you do not open router ports or need a static IP. The agent starts `cloudflared` itself as a child process when it boots. You do not need a separate `cloudflared` service.

## Requirements

- A Cloudflare account.
- A domain whose DNS is managed by Cloudflare.
- `cloudflared` installed. The installer can do this for you.

## What the installer does

If you answer yes to the tunnel prompt, `setup.sh` runs these steps as your user:

1. **Login.** Runs `cloudflared tunnel login` if `~/.cloudflared/cert.pem` does not exist. It prints a URL. Open it in a browser and pick your domain.
2. **Domain.** Asks for your root domain, for example `example.com`. It strips `https://`, paths, and a leading `dash.`.
3. **Tunnel.** Looks for a tunnel with your tunnel name (default `home-cloud`). If none exists, it runs `cloudflared tunnel create`.
4. **Config.** Writes `~/.cloudflared/config.yml`.
5. **DNS.** Runs `cloudflared tunnel route dns --overwrite-dns <tunnel> dash.<domain>`. This replaces an existing DNS record for that name.
6. **Env.** Sets `CF_DOMAIN` and `TUNNEL_NAME` in `agent/.env`.

The generated `config.yml` looks like this:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /home/<user>/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: dash.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Afterwards the dashboard is at `https://dash.example.com`.

If you pass `--skip-cloudflared`, decline the prompt, or login does not finish, the installer continues without a tunnel. The agent logs that the tunnel is inactive and serves the LAN address only.

### Remote SSH

Unless you pass `--skip-ssh`, the installer can also publish `ssh.<domain>` in the same tunnel. It does this only if your `~/.ssh/authorized_keys` has at least one key, and `sshd_config` includes `sshd_config.d`. It then installs `/etc/ssh/sshd_config.d/60-home-cloud-tunnel.conf`, which turns off password logins for connections arriving through the tunnel (from `127.0.0.1` and `::1`). If a check fails, SSH is not published and the dashboard setup continues.

Put a Cloudflare Access policy on `ssh.<domain>` in Zero Trust. The installer recommends this too.

## Add remote access later

### Option 1: run the installer again

Run the same `setup.sh` again. It detects the existing install, keeps your password, and offers the tunnel prompt again if `~/.cloudflared/config.yml` does not exist. Pass the same `--dir` if you used a custom one. It also moves the install to the latest release, so add `--branch <tag>` if you want to stay on your current version.

```bash
bash setup.sh --domain example.com
```

### Option 2: do it by hand

Install `cloudflared`, then:

```bash
cloudflared tunnel login
cloudflared tunnel create home-cloud
cloudflared tunnel list   # note the tunnel ID
```

Create `~/.cloudflared/config.yml` using the example above, with your tunnel ID, username, and domain. Then publish DNS and tell the agent about the domain:

```bash
cloudflared tunnel route dns home-cloud dash.example.com
```

Add these lines to `~/home-cloud/agent/.env`:

```ini
CF_DOMAIN=example.com
TUNNEL_NAME=home-cloud
```

Restart the service. The agent only looks for `config.yml` when it starts.

```bash
sudo systemctl restart home-cloud
sudo journalctl -u home-cloud -n 30 -o cat
```

You should see `Tunnel successfully established: https://dash.example.com`. If the config file is missing you will see `Config file not found` and the agent runs in LAN-only mode.

:::note
The installer's own hint says `cloudflared tunnel login && cloudflared tunnel create home-cloud`. That is not enough on its own. You also need `config.yml`, the DNS route, and the two `.env` values, or you can re-run the installer.
:::

## Exposing other services

When `CF_DOMAIN` is set, exposing a container from Docker Manager adds an ingress rule to `config.yml` and restarts `cloudflared`. It does not create DNS records. Only `dash.<domain>` (and `ssh.<domain>` if published) get DNS from the installer. Other hostnames need a DNS record you create yourself, such as a wildcard CNAME in Cloudflare DNS that points at the tunnel. See [Docker](/docs/using/docker/).

## Local LAN switching

When you open the dashboard through the tunnel while you are at home, Home Cloud can move you to the direct LAN address. This is called split-horizon switching. No DNS records change. It is a browser redirect.

How it works:

1. The dashboard learns the server's LAN address from `/api/network/info` after you log in, and remembers it in the browser's local storage. It picks the first non-internal IPv4 address, skipping interfaces named `docker*`, `veth*`, `br-*`, `vbox*`, `vmnet*`, `tun*`, and `tap*`.
2. It makes a browser request to `http://<lan-ip>:<port>/api/lan-identity/proof?nonce=<random>` with a 2 second timeout.
3. The agent answers with an HMAC of the nonce, keyed from a value derived from `JWT_SECRET`. It refuses this request if it arrived from loopback or through Cloudflare (requests carrying `CF-Connecting-IP`, `CF-Ray`, or `CDN-Loop`). That stops a fake LAN host from relaying a proof through the public name.
4. The dashboard sends the proof to the tunnel origin at `/api/lan-identity/verify`, which checks it.
5. If it is valid, the browser is redirected to `http://<lan-ip>:<port>`.

If any step fails or times out, you stay on the tunnel. Browsers can block requests from an HTTPS page to a private address, and in that case you stay on the tunnel too.

The session cookie is host-only, so the LAN address has its own session. Expect to sign in again after the switch.

The tray shows `LAN · <ip>` when you are on the direct address and `Tunnel` when you are not. Clicking `Tunnel` switches to the LAN address by hand. To stay on the tunnel for one visit, add `?stay_remote` to the URL:

```text
https://dash.example.com/?stay_remote
```

The LAN port comes from the agent's `PORT`. See [Ports](/docs/configuration/ports/).
