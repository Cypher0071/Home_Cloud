---
title: Threat model
description: Who Home Cloud trusts, what the password gives an attacker, and which attacks it does and does not defend against.
sidebar:
  order: 1
---

Home Cloud is a control panel for one Linux machine and one owner. This page states what that means for security, including the parts that are uncomfortable.

## The short version

**The dashboard password is the keys to the machine.** Anyone who has it can run commands on the host as the service user and control Docker. Docker control is root-equivalent. Treat the password and `JWT_SECRET` like root credentials.

Everything else on this page follows from that.

## Single owner, no accounts

There is one password and no user accounts, roles or permissions. Signing in grants full administrative authority. There is no read-only mode and no second factor built in.

This is a design choice, not a gap to be filled later. Home Cloud does not try to separate people from each other. If you need several people with different access, Home Cloud is the wrong tool.

## What the password grants

| Capability | What it allows |
| --- | --- |
| Host terminal | A shell as the Linux user that runs the service. `sudo` works if that account can use it. |
| Docker | Create, run and delete containers, and deploy Compose files. The service user is in the `docker` group, so a container can mount `/` and act as root on the host. |
| File explorer | Read, write and delete files the service user can reach. |
| Settings | Change the password, revoke sessions and apply software updates. |
| Remote exposure | Publish a container on a public subdomain through the tunnel. |

The service never runs as root. Root-level changes from the terminal still need `sudo`. But the `docker` group closes that gap, because a container can do what root can.

### Safe Server Mode is a guard rail, not a wall

Safe Server Mode limits the file explorer to your home directory and storage mounts. It protects you from clicking the wrong folder. It does not limit the terminal, Docker or Compose. A signed-in user can already read any file the service user can read by using the terminal. See [Full system access](/docs/configuration/full-system-access/).

`/proc`, `/sys` and `/dev` are blocked in the file explorer in every mode. That prevents hangs and raw device access through the file API. It is not a defense against a shell.

## Trust boundaries

```text
Browser ──(HTTPS)──> Cloudflare edge ──(tunnel)──> cloudflared ──(HTTP, loopback)──> agent :3000
Browser ──(HTTP, LAN)────────────────────────────────────────────────────────────> agent :3000
agent ──> Docker socket, host shell (PTY), host filesystem
```

### Cloudflare sees your traffic

When you use the tunnel, TLS ends at Cloudflare's edge. Cloudflare decrypts the traffic, including the login request and the terminal stream, then sends it down the tunnel to `cloudflared` on your machine. That hop is an outbound connection from your host, so you open no inbound ports.

You are trusting Cloudflare, your Cloudflare account and your DNS. Someone who takes over that account can route traffic to or from your host. Protect it with a strong password and a second factor.

### The LAN is plain HTTP

The agent does not serve TLS. On your local network, the dashboard at `http://<server-ip>:3000` is unencrypted. The password and the session cookie cross your LAN in clear text. Anyone who can sniff your local network can read them. The cookie is not marked `Secure` there. Do not expose port 3000 to the internet, and keep it firewalled to devices you trust. See [Ports](/docs/configuration/ports/).

### Loopback is trusted

`cloudflared` connects to the agent from `127.0.0.1`. For connections from loopback, the agent reads the real client address from the `CF-Connecting-IP` header. It ignores that header from any other source.

Any process on the host can also connect over loopback, including containers that use host networking. Such a process can claim any client address, which lets it avoid the per-address login lockout. A shared limit on the loopback peer still applies. See [Sessions and login](/docs/security/sessions/).

### Exposed apps share a site

Apps you expose on `<name>.<your-domain>` are separate hostnames under the same domain as the dashboard, so browsers treat them as the same site. The session cookie is host-only and is not sent to them. The agent also checks `Origin` on every state-changing request. But the dashboard does not add a login to those apps. Only expose apps whose content you control, and put a Cloudflare Access policy in front of anything private.

### SSH

If the installer published `ssh.<your-domain>`, the tunnel carries SSH traffic to your host. The tunnel does not authenticate SSH clients, and `sshd` sees every tunnel client as `127.0.0.1`, so source-based bans do not tell attackers apart. The project's advice is to protect that hostname with a Cloudflare Access application and to allow key-only SSH. See [Remote access](/docs/getting-started/remote-access/).

## What Home Cloud defends against

- **Password guessing.** Fixed-window rate limits per client address and per loopback peer, with a 5 minute lockout. The password is compared in constant time.
- **Cross-site request forgery.** State-changing requests must carry a matching `Origin` or `Referer`. Cross-site API requests that carry the session cookie are rejected. The cookie is `SameSite=Lax`.
- **Cross-site WebSocket hijacking.** WebSocket upgrades need a matching `Origin`.
- **Clickjacking.** Responses send `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'`.
- **Stolen or forgotten sessions.** One action revokes every session on every device and closes live terminals and streams.
- **Path traversal and symlink escape in the file API.** Paths are resolved to their real location before the scope check.
- **Inline script from uploaded files.** File view serves only PNG, JPEG, GIF and WebP inline. Everything else is an attachment with `nosniff`.
- **Weak start-up configuration.** The agent refuses to start with a missing, short or placeholder `PASSWORD` or `JWT_SECRET`.
- **Secret leakage into the shell.** `PASSWORD`, `JWT_SECRET` and `GITHUB_TOKEN` are removed from the terminal's environment.
- **Privilege.** The installer sets the service up to run as the install user, not root.

## What it does not defend against

- **Anyone who knows the password.** There is no second factor and no per-action approval.
- **A leaked `JWT_SECRET`.** With it, an attacker can mint valid session tokens. The revocation counter is a small integer that is easy to guess.
- **A compromised browser or device.** Malware on a signed-in phone or laptop has your session.
- **A compromised host.** If something else already runs as your user, it can read `agent/.env`. The password is stored there in plain text.
- **Malicious images or Compose files.** Containers run with whatever the YAML asks for. Home Cloud does not scan images or limit what Compose can mount.
- **A compromised Cloudflare account or DNS.**
- **Weak passwords.** The only rule is a minimum of 8 characters. A short password still falls to a patient attacker who can reach the login page, even with the rate limit.
- **Script injection in the dashboard itself.** The agent sets no script-restricting Content Security Policy, only `frame-ancestors`.
- **Denial of service.** Only the login endpoint is rate limited, and a signed-in user can fill the disk or run the host out of memory.
- **Other local users on the host.** Home Cloud assumes the machine is yours.

## Telemetry

Home Cloud sends no telemetry. The agent's own outbound web request is the update check to `api.github.com`. See [Updates and rollback](/docs/using/updates/).

## What to do about it

1. Use a long, unique password. Put a Cloudflare Access policy with a second factor in front of the dashboard hostname if you use the tunnel.
2. Keep port 3000 firewalled to the LAN.
3. Keep `agent/.env` readable only by the service user, and never commit it.
4. Run the service as a normal user. Do not set `User=root`.
5. Review any Compose file before you deploy it.
6. Use Log Out Everywhere after you lose a device.

To report a flaw, see [Reporting a vulnerability](/docs/security/reporting/).
