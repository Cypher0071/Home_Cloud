---
title: First login
description: Open the dashboard on your local network, sign in with your password, and find your way around.
sidebar:
  order: 3
---

## Open the dashboard

The installer prints the local URL when it finishes. It looks like this, with your server's own address in place of `<server-ip>`:

```text
Access locally at:  http://<server-ip>:3000
```

From another device on the same network, open that address in a browser. From the server itself, use `http://localhost:3000`. To find the server's address later:

```bash
hostname -I
```

If the page does not load, check that the service is running and that nothing blocks the port:

```bash
sudo systemctl status home-cloud
sudo journalctl -u home-cloud -n 50 -o cat
```

The log should contain `Agent is running on port: 3000`. For more, see [Troubleshooting](/docs/operations/troubleshooting/).

:::note
On your LAN the dashboard is served over plain HTTP. Use it on a network you trust. Remote access through Cloudflare Tunnel is HTTPS. See [Remote access](/docs/getting-started/remote-access/).
:::

## Sign in

The login page shows "Enter your password to unlock the workspace". There is no username. Enter the password you chose during install.

The password is stored as `PASSWORD` in `agent/.env` inside the install directory (`~/home-cloud/agent/.env` by default). If you ran the installer without a password in non-interactive mode, it generated a random one and did not print it. Set a new one:

1. Open `~/home-cloud/agent/.env` and set `PASSWORD=` to a value of at least 8 characters.
2. Restart the service: `sudo systemctl restart home-cloud`.

### Failed attempts

After 5 failed logins from one address within 60 seconds, that address is locked out for 5 minutes. The response includes a `Retry-After` header. There is also a combined limit of 30 failures per 60 seconds across all connections that reach the agent through the tunnel. The counters live in memory, so restarting the service clears them.

### Sessions

A successful login sets a cookie that lasts 7 days. The cookie is `HttpOnly`, host-only, and `Secure` when you use HTTPS.

Logging out revokes every session on every device, not just the current one. Changing the password does the same. Details are in [Sessions](/docs/security/sessions/).

## What you see first

After login you get a desktop-style workspace with windows for these apps:

| App | What it does | Guide |
| :--- | :--- | :--- |
| Activity Monitor | CPU, memory, disk, and network stats | [Dashboard](/docs/using/dashboard/) |
| File Explorer | Browse, upload, download, copy, rename, move | [Files](/docs/using/files/) |
| Terminal | Shell on the host, as the service user | [Terminal](/docs/using/terminal/) |
| Docker Manager | Containers, logs, exec, Compose stacks | [Docker](/docs/using/docker/) |
| Settings | Personalization, storage scope, password, updates | [Updates](/docs/using/updates/) |

You can open an app directly by its path, for example `http://<server-ip>:3000/terminal`. The valid paths are `/terminal`, `/files`, `/docker`, `/metrics`, and `/settings`.

The Settings app has four tabs:

- **Personalization:** wallpaper presets and custom wallpaper.
- **Storage & System:** Safe Server Mode and the full system access switch. See [Full system access](/docs/configuration/full-system-access/).
- **Security & Sessions:** change the password, and see the remote SSH hostname when a tunnel is configured.
- **Updates & System:** check for and apply updates.

## Things to do now

1. Open Settings, then Security & Sessions, and confirm your password works by changing it if you used a temporary one.
2. Decide whether you want [remote access](/docs/getting-started/remote-access/).
3. Read the [threat model](/docs/security/threat-model/). Anyone with the password has a shell on this machine.
