# Home Cloud - Project Context

A short orientation for anyone (or any tool) new to the codebase. For the as-built architecture
read [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md); for the dashboard's visual language read
[`DESIGN.md`](DESIGN.md); for what is planned or known to be rough, read
[`future_roadmap.md`](future_roadmap.md) and [`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md).

---

## What is this?

A self-hosted control panel that turns a spare Linux PC into a machine you can manage from any
browser, anywhere. One dashboard gives you a host shell, a file manager, live system stats, and
Docker and Compose management, with remote access that the installer sets up for you.

The problem it solves: most home ISPs put you behind CGNAT, so no inbound connection can reach
your PC, and a cloud VM costs money. Home Cloud avoids both by connecting **outbound** to
Cloudflare, which relays browser traffic back through that connection.

It is single-owner by design: one password, one machine. See the
[threat model](../landing/src/content/docs/docs/security/threat-model.md) before exposing it.

---

## Core Concepts

**Agent** - The Node.js process (`agent/`) running on the PC as a systemd service. It serves
the REST API, the WebSocket terminals, the SSE metrics stream, and the built dashboard, all on
one port (default `3000`, set by `PORT`).

**Dashboard** - A React single-page app (`dashboard/`) built to static files and served by the
agent. It presents a desktop-style workspace: windows, a dock, and a system tray.

**Cloudflare Tunnel (`cloudflared`)** - The agent supervises one `cloudflared` process, which
opens an outbound tunnel. Ingress rules map hostnames (`dash.<domain>`, `ssh.<domain>`, and one
per exposed container) to local ports. No inbound ports are opened and no router changes are
needed.

**Docker** - Every managed app is a container. The agent talks to the Docker socket
(`/var/run/docker.sock`) through `dockerode`, and manages Compose stacks through the Docker CLI.

**Landing site** - `landing/` is the public website and the documentation under `/docs`
(Astro and Starlight). It is deployed separately from the product.

---

## How Networking Works

```
1. cloudflared on the PC opens an OUTBOUND connection to Cloudflare
2. Browsers hit https://dash.<your-domain>
3. Cloudflare routes the request through the tunnel to the agent
4. The agent answers locally and the response returns through the same tunnel
```

`CF_DOMAIN` has no default; the installer asks for it. Exposing a container writes an ingress
rule to the local `cloudflared` config and restarts `cloudflared`. The agent does not call the
Cloudflare DNS API. On the home network the dashboard can switch to the machine's LAN address
automatically (`dashboard/src/hooks/useNetworkDetector.ts`).

### Why apps open in new tabs, not iframes

Each exposed app runs on its own subdomain, a different origin from the dashboard, and most
self-hosted apps send `X-Frame-Options` or a CSP that forbids framing. The dashboard is the
control plane; the app is the data plane, so apps open in their own tab.

---

## Tech Stack

**Agent**
- Node.js `>=22.23.4`, Express 5, CommonJS (`require`, no `"type": "module"`)
- `ws` for WebSockets on the same HTTP server (via the `upgrade` event)
- `node-pty` for real PTY sessions behind the browser terminal
- `systeminformation` for metrics, `dockerode` for Docker, `multer` for uploads
- `jsonwebtoken` for sessions, in an `httpOnly` cookie

**Dashboard**
- React 19, Vite, TypeScript, React Compiler, xterm.js

**Monorepo**
- pnpm workspaces: `agent`, `dashboard`, `landing`. No Turborepo.

---

## Key Architecture Decisions

**One port for everything.** HTTP, WebSocket, and SSE share the agent's port. `ws` attaches to
the HTTP server through the `upgrade` event, so there is a single thing to tunnel and firewall.

**CommonJS, not ESM.** `node-pty` and `dockerode` load native bindings through `require()`.
Mixing in ESM adds `createRequire()` workarounds for no benefit in a backend daemon.

**SSE for metrics, WebSocket for terminals.** Metrics only flow server to client, and SSE gives
framing, reconnection, and heartbeats for free (a `: heartbeat` comment every 15s keeps the
tunnel from idling out). Terminals are bidirectional, so they use WebSockets. Any new streaming
endpoint must also be SSE or a WebSocket: `cloudflared` buffers other chunked responses.

**Cookie auth, not localStorage.** The session JWT lives in an `httpOnly`, `SameSite=Lax`,
host-only cookie, so page JavaScript cannot read it and the browser sends it on WebSocket
handshakes too. Logging out everywhere bumps a session epoch that invalidates every session.

**Express route order matters.** Public routes (`/api/auth`) come first, then the auth
middleware, then protected API routes, then static files, and the SPA catch-all
(`app.get('/{*path}')` returning `index.html`) comes last so client-side routes survive a hard
refresh.

**Path scoping on file routes.** Paths are resolved with `path.resolve()` and checked against
the allowed scope with a trailing separator, so `/home/user` does not match `/home/user2`.
Moving across mounts can fail with `EXDEV` (`fs.rename` only works within one filesystem), so
the code falls back to copy-and-delete.

**Docker for app lifecycle, Cloudflare for app access.** Two systems, two concerns: Docker
installs, isolates, runs, and monitors; Cloudflare makes the result reachable.

---

## Development Environment

**OS:** Linux. The agent relies on Linux-only pieces (`node-pty`, host metrics, systemd).

```bash
pnpm dev                          # agent and dashboard together
pnpm --filter agent dev           # agent only (nodemon)
pnpm --filter dashboard dev       # dashboard only (Vite proxies /api, /terminal, /ws to :3000)
pnpm dev:landing                  # landing site and docs
pnpm test                         # dashboard, agent, and end-to-end suites
```

**Native builds:** `node-pty` needs build tools. If you see `gyp ERR! not found: make`:

```bash
sudo apt install -y build-essential python3
```

**Docker access:** the service user must be in the `docker` group to use the socket:

```bash
sudo usermod -aG docker $USER   # then log out and back in
```

**Keeping a laptop awake with the lid closed:** the installer does this for you
(`--skip-lid` opts out). Manually, set `HandleLidSwitch=ignore` in
`/etc/systemd/logind.conf` and run `systemctl restart systemd-logind`.
