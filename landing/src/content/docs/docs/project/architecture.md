---
title: Architecture
description: How Home Cloud is put together, how a request travels, and where its state lives.
sidebar:
  order: 1
---

Home Cloud is one Node.js process on one Linux machine. It serves a web dashboard and gives it access to the host terminal, the Docker socket, the filesystem and system stats. An optional `cloudflared` child process makes it reachable from outside your network.

## Components

### Agent

The agent is an Express 5 app in `agent/`. It does all the work:

- **HTTP API** under `/api`: login, system metrics, files, Docker, Compose, settings and updates.
- **WebSockets** on the same port: `/terminal` for the host shell and `/ws/docker/exec` for a shell inside a container. The host shell is a real pseudo-terminal from `node-pty`, running as the service user.
- **Docker** through `dockerode` and the Docker socket, and through the `docker compose` command for Compose projects.
- **System stats** from the `systeminformation` library.
- **Static files**: it serves the built dashboard and falls back to `index.html` for any other path.
- **Tunnel supervisor**: it starts `cloudflared`, restarts it with backoff if it drops, and stops it on shutdown.
- **Updater**: it checks GitHub releases and applies one with `git`, `pnpm` and a restart.

Routes stay thin. Logic lives in `agent/services/` (preferences, ingress, the update manager) and `agent/middleware/` (authentication, origin checks, security headers).

### Dashboard

The dashboard is a React 19 and Vite single-page app in `dashboard/`. It looks like a desktop with windows. It has no server of its own. The installer builds it to `dashboard/dist`, and the agent serves that folder.

In development, Vite runs on port 5173 and proxies `/api`, `/terminal` and `/ws` to the agent on port 3000.

### setup.sh

The installer. It checks that systemd is running, resolves and clones the latest published release, installs Node.js and Docker when they are missing, writes `agent/.env`, optionally sets up the tunnel, builds the dashboard and installs the service. It uses `sudo` for the system changes it makes. See [Install](/docs/getting-started/install/).

### systemd unit

`home-cloud.service` is rendered from `home-cloud.service.template`. It runs `node index.js` from `agent/` as your user, never as root, with the `docker` group added. It loads `agent/.env`, restarts the agent on failure, and logs to the journal.

### cloudflared tunnel

`cloudflared` is optional. The agent starts it as a child process with the config in `~/.cloudflared/config.yml`. It opens an outbound connection to Cloudflare, so you do not open any port on your router. When you expose a container from the dashboard, the agent edits the ingress rules in that file and restarts the tunnel.

## Request flow

```text
 On your network                        From the internet

 Browser                                Browser
    |                                      |
    | http://<host>:3000                   | https://dash.<domain>
    |                                      v
    |                                  Cloudflare edge
    |                                      |
    |                                      v  (outbound tunnel)
    |                                  cloudflared  (child of the agent)
    |                                      |
    |                                      | http://localhost:3000
    v                                      v
 +--------------------------------------------------+
 |  Agent (Express + ws, port 3000)                 |
 |  security headers, cookies, origin check         |
 |  /api/auth  (public)    /api/*  (login required) |
 |  dashboard/dist         /terminal, /ws/*         |
 +-----------+-------------+----------------+-------+
             |             |                |
         host shell     Docker socket    filesystem
         (node-pty)     (dockerode)      (storage scope)
```

Both paths end at the same Express app. The agent does not treat them differently, except for one detail: a request from the tunnel arrives from the loopback address with a `CF-Connecting-IP` header. The agent trusts that header only when the connection comes from loopback, and uses it for login rate limits.

### Login

`POST /api/auth/login` compares the password in constant time. On success it sets a `token` cookie holding a signed JWT that expires after 7 days. Every `/api` route except login, health, ping and the LAN proof requires that cookie, and so do both WebSocket paths. State-changing requests and WebSocket upgrades must also come from the same origin as the page. See [Sessions](/docs/security/sessions/).

### Local detection

Two public endpoints, `/api/ping` and `/api/lan-identity/proof`, let the dashboard tell when you are on the same network. The proof is signed with a key derived from `JWT_SECRET`, and the agent refuses to give it to requests that came through the tunnel.

## Where state lives

| State | Location |
| --- | --- |
| Password, JWT secret, port, domain, tunnel name | `agent/.env` in the install directory |
| Storage scope, custom paths, desktop settings, session counter, wallpaper | `~/.config/home-cloud/` |
| Compose projects | `~/.home-cloud/compose/<project>/docker-compose.yml` |
| Tunnel config, credentials, account certificate | `~/.cloudflared/` |
| Service definition | `/etc/systemd/system/home-cloud.service` |
| Login attempt counters, running terminal sessions | In memory only. A restart clears them. |
| Containers, images, volumes | Docker, not Home Cloud |

There is no database. See [Backup and restore](/docs/operations/backup/) for what to copy.

## Trust model

Anyone who logs in gets a shell as the service user and control of Docker. The agent is designed for one owner on one machine. Read the [threat model](/docs/security/threat-model/) before you expose it to the internet. The longer design notes are in [docs/SYSTEM_DESIGN.md](https://github.com/Cypher0071/Home_Cloud/blob/main/docs/SYSTEM_DESIGN.md). Where they disagree with the code, the code is right.
