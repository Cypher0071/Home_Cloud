---
title: Ports
description: Which ports Home Cloud uses, what it listens on, and how to change the port.
sidebar:
  order: 2
---

## Ports at a glance

| Port | Protocol | Used by | When |
| :--- | :--- | :--- | :--- |
| 3000 | TCP | Home Cloud agent: dashboard, API, and WebSockets | Always. Default, set by `PORT`. |
| 22 | TCP | OpenSSH server | Installed or enabled by `setup.sh` unless you pass `--skip-ssh`. |
| 5173 | TCP | Vite dev server | Only when you run `pnpm dev`. |

The agent serves HTTP and WebSocket traffic (terminal and container exec) on the same port. There is no separate WebSocket port.

Cloudflare Tunnel needs no inbound port. `cloudflared` makes outbound connections to Cloudflare.

Containers you run in Docker publish their own ports. Those are separate from Home Cloud.

## Binding

The agent calls `listen(PORT)` without a host address. It accepts connections on all network interfaces, so the dashboard is reachable at `http://<server-ip>:3000` from any device that can reach the machine. There is no setting to bind it to `127.0.0.1` only.

When a Cloudflare Tunnel is configured, `cloudflared` connects to the agent on `http://localhost:3000`.

Because the dashboard is plain HTTP on the LAN, keep port 3000 off the public internet. Do not forward it on your router. See the [threat model](/docs/security/threat-model/).

## Firewall

If UFW is active when you run the installer, it runs:

```bash
sudo ufw allow 3000/tcp comment "Home Cloud Dashboard"
sudo ufw allow OpenSSH
```

The second rule is skipped with `--skip-ssh`. If UFW is not active, the installer changes nothing. Other firewalls are not configured, so open the port yourself if you use one.

## Check that the port is free or in use

```bash
ss -tulpn | rg ':3000'
```

If another program already uses 3000, the agent cannot start. Check the log with `sudo journalctl -u home-cloud -n 50 -o cat`.

## Change the port

The installer writes port 3000 into several places, so change all of them.

1. Set `PORT` in `~/home-cloud/agent/.env`:

   ```ini
   PORT=8080
   ```

2. If you use a Cloudflare Tunnel, update the dashboard rule in `~/.cloudflared/config.yml`:

   ```yaml
   ingress:
     - hostname: dash.example.com
       service: http://localhost:8080
     - service: http_status:404
   ```

3. If you use UFW, open the new port:

   ```bash
   sudo ufw allow 8080/tcp comment "Home Cloud Dashboard"
   sudo ufw delete allow 3000/tcp
   ```

4. Restart:

   ```bash
   sudo systemctl restart home-cloud
   ```

The dashboard then reports the new port to your browser, so [LAN switching](/docs/getting-started/remote-access/#local-lan-switching) uses `http://<server-ip>:8080`.

:::caution
The installer assumes port 3000. Its closing message always prints `:3000`, and the `config.yml` and UFW rule it creates use 3000. Rerunning `setup.sh` keeps a valid existing `config.yml`. The `pnpm dev` proxy also targets port 3000.
:::

## Ports taken by services you expose

When `CF_DOMAIN` is set, exposing a container adds a rule that points a subdomain at `http://localhost:<host-port>`. Port 22 and port 3001 are protected: Home Cloud will not remove an ingress rule that targets them by port. Names such as `dash`, `ssh`, `api`, and `admin` are reserved and cannot be used as subdomains.
