# Home Cloud - Project Context

## What is this?

A self-hosted cloud platform that turns a spare PC (running Linux) into a remotely managed server. Accessible from any browser tab, on any device, anywhere in the world. Think ngrok + AnyDesk combined into one unified web dashboard.

The goal is personal utility. Replace the need for a paid cloud server by using a spare PC at home as a full server, while being able to access and manage it remotely as if it were a real cloud server. Software-wise the experience is identical to a cloud VM. Hardware-wise it is your own physical machine sitting at home.

The fundamental problem being solved: Indian ISPs (Jio, Airtel, etc.) use CGNAT — you share one public IP with thousands of users. No inbound connections can reach your home PC. A cloud VM costs money and is worse hardware than a spare PC. Cloudflare Tunnel solves this by flipping the direction: the server reaches out, not the client in.

---

## Core Concepts

**Agent** - A lightweight Node.js background process running on the spare PC. It never needs inbound connections. It opens an outbound connection to Cloudflare's servers, which relay traffic from the browser to the agent. This bypasses NAT and ISP restrictions entirely.

**Cloudflare Tunnel (cloudflared)** - Free tunneling solution. The agent spawns a cloudflared process which creates a secure outbound tunnel and exposes the agent publicly via a stable HTTPS URL. No VPS required, no port forwarding needed. Works even on Indian ISPs with CGNAT. One cloudflared process can handle multiple hostnames via ingress rules in a single config file.

**Dashboard** - A React SPA served as static files by the agent itself. Accessed from any browser.

**Docker** - Handles installation, isolation, lifecycle management, and resource monitoring of self-hosted apps. Every installed app is a Docker container. Docker socket (`/var/run/docker.sock`) is a Unix domain socket that exposes a REST API — dockerode is a Node.js client that talks to it.

---

## How Networking Works

The spare PC is behind home NAT (no public IP). Cloudflare Tunnel solves this by flipping the direction of connections:

```
1. cloudflared on spare PC opens an OUTBOUND connection to Cloudflare's servers
2. Cloudflare assigns stable HTTPS URLs (home-cloud.live, *.home-cloud.live)
3. When browser hits those URLs, Cloudflare routes requests through the tunnel to the agent
4. Agent handles requests locally and sends responses back through the same tunnel
```

No inbound ports needed. Your router allows outbound connections so this just works.

Hostnames such as `home-cloud.live` in this file are examples. `CF_DOMAIN` has no default, and the agent does not publish DNS.

---

## Architecture

```
SPARE PC (Linux, always on, lid closed)
│
├── Node.js Agent (Express + WebSocket server) on port 3000
│   ├── Serves React dashboard (static build from ../dashboard/dist)
│   ├── REST API (auth, files, metrics, docker)
│   ├── WebSocket server for terminal (shares port 3000 via HTTP upgrade event)
│   ├── node-pty → real PTY sessions in browser terminal
│   ├── systeminformation → SSE metrics stream
│   ├── dockerode → Docker socket management
│   ├── fs + multer → file management
│   ├── jsonwebtoken + cookies → auth
│   └── orchestrates cloudflared config (ingress rules per installed app)
│
├── Docker Engine
│   ├── jellyfin container  (internal port 8096)
│   ├── sonarr container    (internal port 8989)
│   ├── pihole container    (internal port 8080)
│   └── ... (any installed app)
│
└── cloudflared (single process, ingress rules)
    ├── home-cloud.live           → localhost:3000  (dashboard + agent API)
    ├── jellyfin.home-cloud.live  → localhost:8096  (Jellyfin UI)
    ├── sonarr.home-cloud.live    → localhost:8989  (Sonarr UI)
    └── pihole.home-cloud.live    → localhost:8080  (Pi-hole UI)
            |
            | outbound tunnel (all hostnames, one process)
            v
    Cloudflare Edge Network
            |
            | HTTPS
            v
BROWSER (any device, anywhere)
└── React Dashboard (home-cloud.live)
    ├── Terminal tab (xterm.js over WebSocket)
    ├── File manager tab (upload, download, browse, search)
    ├── Monitoring tab (CPU, RAM, disk - live SSE)
    ├── Docker tab (containers, images, lifecycle controls, logs)
    ├── App Store tab (one-click install catalog) — not shipped
    ├── Remote desktop tab (noVNC - VNC client in browser) — not shipped
    └── Installed apps open in NEW TABS at their own subdomain
```

---

## How App Installation Works

**Not shipped.** There is no app store catalog and no `POST /api/docker/install` flow. The steps below are an old design sketch, not the running agent. Exposing a container writes ingress YAML in `~/.cloudflared/config.yml` and restarts `cloudflared`. The agent does not call the Cloudflare DNS API and does not send `SIGHUP`.

When a user clicks "Install Jellyfin" in the App Store:

```
1. Agent: POST /api/docker/install { app: "jellyfin" }
2. Agent pulls docker image (jellyfin/jellyfin) via dockerode
   └── streams pull progress to browser via SSE
3. Agent allocates a free host port (e.g. 8096) — checks existing containers to avoid conflicts
4. Agent creates + starts container via dockerode
   └── HostConfig.PortBindings maps host:8096 → container:8096
5. Agent appends ingress rule to ~/.cloudflared/config.yml:
      - hostname: jellyfin.home-cloud.live
        service: http://localhost:8096
6. Agent calls Cloudflare DNS API to create CNAME:
      jellyfin.home-cloud.live → <tunnel-id>.cfargotunnel.com
7. Agent sends SIGHUP to cloudflared process → reloads config, no downtime
8. Dashboard shows Jellyfin card with "Open" button → window.open('https://jellyfin.home-cloud.live')
```

Docker handles: installation, isolation, resource limits, metrics, removal.
Cloudflare handles: making the app reachable from anywhere via its own subdomain.
Agent glues both together.

---

## Why Not iframe / Why Apps Open in New Tabs

Each installed app runs on its own subdomain (`jellyfin.home-cloud.live`). The dashboard runs on `home-cloud.live`. These are different origins. Most self-hosted apps set `X-Frame-Options: SAMEORIGIN` or `DENY`, which causes browsers to refuse iframe embedding across origins. Embedding is unreliable and out of our control.

Apps open in new tabs via `window.open()`. This is intentional and correct:
- Dashboard = control plane (install, monitor, manage)
- App = data plane (actually using Jellyfin for 2 hours)
- These belong in separate browser tabs, not crammed together

This is how Umbrel, CasaOS, and Cosmos all work.

---

## Why Docker (Not Native apt installs)

Docker gives every installed app a uniform API regardless of what the app is:

| Concern | Without Docker | With Docker |
|---------|---------------|-------------|
| Start/Stop | Parse systemd (fragile) | `container.start()` / `container.stop()` |
| CPU/RAM per app | Hunt PIDs in /proc | `container.stats()` — built in |
| Remove cleanly | apt + leftover configs | `docker rm` — completely gone |
| Update | Different per app | `docker pull` — same for all |
| Dependency conflicts | System-wide chaos | Each container has its own filesystem |
| Roll back bad update | Impossible | Switch image tag |

---

## Tech Stack

### Agent (Backend)
- **Runtime**: Node.js v24
- **Module system**: CommonJS (`require`, not `import`) — mandatory. `node-pty` and `dockerode` have native C++ bindings compiled to `.node` files. These load via `require()` synchronously. ESM's async `import()` and the lack of `require` in ESM scope add friction with no benefit for a backend daemon.
- **Framework**: Express v5
- **WebSockets**: `ws` library, attached to the same HTTP server as Express via the `upgrade` event. Single port 3000.
- **Terminal**: `node-pty` — creates a real PTY (pseudo-terminal). Programs like vim, htop, fzf call `isatty()` to detect if they're in a real terminal. A real PTY returns true. `child_process.spawn` returns false — those programs break or behave differently.
- **System info**: `systeminformation` — CPU, RAM, disk, network metrics
- **Docker**: `dockerode` — Node.js client for Docker's Unix socket REST API
- **Auth**: `jsonwebtoken` — JWT stored in `httpOnly; secure` cookies. httpOnly prevents JS access (XSS protection). Cookies auto-send on every request to the same origin including WebSocket upgrades.
- **File uploads**: `multer`
- **Dev**: `nodemon`
- **Tunnel**: `cloudflared` binary spawned as child process, config managed dynamically by agent

### Dashboard (Frontend)
- **Framework**: React
- **Build tool**: Vite
- **Language**: TypeScript + React Compiler
- **Terminal UI**: xterm.js
- **Remote desktop**: noVNC

### Monorepo
- **Package manager**: pnpm with pnpm workspaces
- **Dev orchestration**: concurrently (runs agent + dashboard dev servers simultaneously)
- No Turborepo, no overkill. Only 2 packages.

---

## Project Structure

```
home-cloud/
├── pnpm-workspace.yaml
├── package.json              <- root, concurrently dev script
├── docs/
│   ├── CONTEXT.md            <- this file
│   ├── implementation.md     <- Docker feature roadmap/milestones
│   └── learn/                <- deep-dive learning notes
│       └── docker-concepts.md
├── agent/                    <- Node.js backend
│   ├── index.js              <- entry point (CommonJS)
│   ├── .env                  <- JWT_SECRET, PASSWORD
│   ├── tunnel.js             <- cloudflared child process spawner (root level, NOT in routes/)
│   ├── middleware/
│   │   └── auth.js           <- JWT cookie verification middleware
│   ├── routes/
│   │   ├── auth.js           <- POST /api/auth/login, /logout
│   │   ├── file.js           <- file CRUD, upload, download, search (fzf+fd), drives
│   │   └── metrics.js        <- SSE stream of CPU/RAM/disk every 2s
│   ├── sockets/
│   │   └── terminal.js       <- WebSocket handler, spawns node-pty per connection
│   └── package.json          <- NO "type": "module" - must stay CommonJS
└── dashboard/                <- React frontend (Vite + TypeScript)
    ├── src/
    └── package.json
```

> [!NOTE]
> `routes/docker.js` and `routes/compose.js` handle container and docker-compose lifecycle.
> Metrics are SSE over HTTP (not WebSocket) so there is no `sockets/metrics.js`.
> `tunnel.js` lives at the agent root, not inside `routes/`.

---

## Key Architecture Decisions

**Single port for everything** — The agent HTTP server and WebSocket server share port 3000. `ws` attaches to the HTTP server via the `upgrade` event — when a browser sends `Connection: Upgrade` + `Upgrade: websocket`, the `ws` library intercepts it before Express sees it. Express only handles normal HTTP. One cloudflared tunnel covers both.

**Express route ordering** — Critical. Must be:
1. Public routes first (`/api/auth`) — no auth check
2. Auth middleware (`/api`) — all subsequent `/api/*` routes require valid JWT cookie
3. Protected API routes (`/api/metrics`, `/api/files`, `/api/docker`)
4. Static file serving (`express.static('../dashboard/dist')`)
5. Catch-all LAST (`app.get('/{*path}')` returns `index.html`)

The catch-all exists because React Router handles client-side routing. Hard refresh to `/docker` asks the server for `/docker`. Express finds no such file. Without catch-all: 404. With it: returns `index.html`, React loads, React Router renders the right tab.

**SSE for metrics, WebSocket for terminal** — Metrics are server-to-client only. SSE is simpler, has built-in reconnection (`retry:`), framing (`\n\n`), and heartbeat (`: comment`) support. WebSocket is bidirectional — mandatory for terminal where keystrokes go up and output comes down.

**Cloudflare ingress rules for app access** — One cloudflared process, one config file, multiple hostname→port mappings. The shipped expose path appends an ingress rule and restarts `cloudflared`. It does not call the Cloudflare DNS API and it does not send `SIGHUP`. The app-store install flow that used to be described here is not shipped. Each exposed app can still have its own subdomain once DNS (a wildcard CNAME, not an agent API call) points at the tunnel. No reverse proxy inside Express is required. Apps run at `/` as they expect.

**Docker for app lifecycle, Cloudflare for app access** — These are separate concerns handled by separate systems. Docker: install, isolate, start, stop, monitor, remove. Cloudflare: make the app reachable from the internet. The agent orchestrates both.

**httpOnly cookie auth, not localStorage** — JWT stored in `httpOnly; secure` cookie. Browser automatically sends it on every HTTP request AND on WebSocket handshake (which is an HTTP upgrade request). JavaScript cannot read it (`httpOnly`). This prevents token theft via XSS. `secure: true` means cookie only sent over HTTPS — works in production via Cloudflare tunnel. In local dev over HTTP, set `secure: false` temporarily.

**CommonJS, not ESM** — `node-pty` and `dockerode` have native C++ `.node` bindings that use `require()` internally. ESM has no `require`. Mixing them requires `createRequire()` hacks with no benefit for a backend daemon. Stay CommonJS.

**Path traversal protection** — All file routes resolve user-supplied paths with `path.resolve()` then check `startsWith(BASE_DIR + '/')`. Note the trailing slash — `startsWith('/home/<user>')` alone would pass `/home/<user>-evil/`. The slash prevents this.

**EXDEV on file move** — `fs.rename()` is a single atomic kernel syscall that only works within the same filesystem/mount. Moving across mounts (WSL drive to Windows mount, or to a USB drive) returns `EXDEV`. The move route falls back to `fs.cp()` + `fs.rm()` in this case.

**Why not Next.js** — WebSocket support requires custom server setup. Too heavy to run as a background daemon on a spare PC.

**Why not Turborepo** — Only 2 packages. Concurrently is sufficient.

---

## Real-time Data Flow

### Terminal (WebSocket)
```
User presses 'l' in xterm.js (browser)
  -> xterm.js captures keydown
  -> sends raw bytes over WebSocket
  -> agent receives in ws.on('message')
  -> agent calls pty.write('l')
  -> PTY passes 'l' to bash
  -> bash writes output back to PTY
  -> PTY emits data event on agent
  -> agent sends raw bytes over WebSocket
  -> xterm.js renders the character
```

### Metrics (SSE)
```
Agent reads CPU/RAM every 2s via systeminformation
  -> formats as SSE event: "data: {cpu: 45, ram: 62}\n\n"
  -> \n\n is the frame delimiter (single \n = field line end, double = event end)
  -> browser EventSource fires onmessage
  -> React state updates -> chart re-renders

Every 15s: agent writes ": heartbeat\n\n"
  -> lines starting with : are SSE comments, EventSource ignores them
  -> but the bytes travel through Cloudflare tunnel, resetting its idle timeout
  -> prevents Cloudflare from killing the connection for inactivity
```

### Why Not Plain Long HTTP for Metrics
1. **Timeouts** — proxies and CDNs (including Cloudflare) kill long-running HTTP requests
2. **Buffering** — HTTP middleware buffers the body expecting a complete response. Data sits in a buffer until connection closes
3. **No framing** — raw bytes with no concept of where one event ends and another begins

SSE solves all three. `\n\n` is the frame delimiter. Browser's EventSource parses events. Browsers treat SSE responses specially — no buffering.

---

## Development Environment

**OS**: Linux (Ubuntu). The agent uses Linux-specific packages (node-pty, system metrics). The spare PC runs native Linux.

**Project files**: `~/code/projects/home_cloud`

**Running**:
```bash
# from root — runs both agent and dashboard
pnpm dev

# agent only
pnpm --filter agent dev

# dashboard only
pnpm --filter dashboard dev
```

**Native builds**: node-pty needs build tools:
```bash
sudo apt install -y build-essential python3
```
If you see `gyp ERR! not found: make`, this is why.

**Docker access**: Node.js process needs to be in the `docker` group to access `/var/run/docker.sock`:
```bash
sudo usermod -aG docker $USER
# log out and back in
```

---

## Linux Config for Spare PC

To keep the spare PC on with lid closed:

```bash
# /etc/systemd/logind.conf
HandleLidSwitch=ignore
```

Then: `systemctl restart systemd-logind`