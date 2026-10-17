# Home Cloud — System Design

This is the as-built architecture of the running system. Every box, port, and path below maps to code in `agent/` or `dashboard/`. Roadmap items that are **not** shipped (App Store, noVNC, Cloudflare DNS API, SIGHUP reload) are called out separately and do not appear as live components.

---

## 1. What the system is

Home Cloud turns a spare Linux PC into a remotely managed server. The spare PC sits behind home NAT / CGNAT (typical of Indian ISPs). It cannot accept inbound connections, so it opens one **outbound** Cloudflare Tunnel. A browser anywhere then reaches a Web-OS control plane over HTTPS, and optionally reaches installed Docker apps on their own subdomains.

```
Control plane  =  dash.home-cloud.live   →  Agent :3000  (dashboard + API + WebSocket)
Data plane     =  <app>.home-cloud.live  →  container host port  (the app's own UI)
```

Those two planes are different browser origins on purpose. Installed apps open in new tabs via `window.open()`, never in an iframe (`X-Frame-Options` would block them).

---

## 2. Whole-system architecture

Read this top-to-bottom. Traffic always originates from a browser. The home router never opens an inbound port.

```mermaid
%%{init: {
  "theme": "dark",
  "themeVariables": {
    "primaryColor": "#12261f",
    "primaryTextColor": "#e8eaed",
    "primaryBorderColor": "#2dd4bf",
    "lineColor": "#6b7385",
    "secondaryColor": "#1e1635",
    "tertiaryColor": "#152238",
    "fontSize": "13px"
  }
}}%%
flowchart TB
  classDef client fill:#152238,stroke:#60a5fa,color:#e8eaed
  classDef edge fill:#2a1a10,stroke:#fb923c,color:#e8eaed
  classDef host fill:#10141c,stroke:#2dd4bf,color:#e8eaed
  classDef agent fill:#1e1635,stroke:#c4b5fd,color:#e8eaed
  classDef docker fill:#0d3d38,stroke:#14b8a6,color:#e8eaed
  classDef os fill:#12261a,stroke:#4ade80,color:#e8eaed
  classDef auth fill:#2a1520,stroke:#f87171,color:#e8eaed
  classDef data fill:#2a2110,stroke:#fbbf24,color:#e8eaed

  subgraph WORLD["ANY DEVICE  ·  any browser  ·  anywhere"]
    direction TB
    BROWSER["React SPA  —  dashboard/src<br/>React 19 + Vite + TS + React Compiler"]
    LOGIN["/login<br/>POST /api/auth/login {password}"]
    SHELL["Desktop Shell  —  pages/desktop.tsx<br/>OSWindow · taskbar · ErrorBoundary per app"]
    AM["Activity Monitor<br/>EventSource /api/metrics"]
    FE["File Explorer<br/>axios /api/files/*"]
    TERM["Terminal<br/>WS  {ws|wss}://host/terminal"]
    DM["Docker Manager<br/>REST + SSE + WS exec"]
    APPTAB["Data-plane tabs  window.open()<br/>https://&lt;sub&gt;.home-cloud.live"]
    NET["useNetworkDetector<br/>GET /api/network/info<br/>1.5s CORS ping → LAN redirect"]

    BROWSER --> LOGIN
    LOGIN --> SHELL
    SHELL --> AM & FE & TERM & DM & NET
    DM -.->|"Open exposed app"| APPTAB
  end

  subgraph CF["CLOUDFLARE EDGE  ·  public HTTPS, TLS terminated here"]
    direction LR
    DNS["DNS zone  home-cloud.live<br/>dash.home-cloud.live<br/>*.home-cloud.live"]
    TUN["Named tunnel  home-cloud<br/>&lt;tunnel-id&gt;.cfargotunnel.com"]
    ING["Ingress match on Host header<br/>dash → :3000<br/>jellyfin → :8096<br/>&lt;sub&gt; → :&lt;hostPort&gt;<br/>else → http_status:404"]
    DNS --> TUN --> ING
  end

  subgraph PC["SPARE LINUX PC  ·  always-on  ·  lid closed  ·  HandleLidSwitch=ignore"]
    direction TB

    subgraph CFD["cloudflared  —  child of the Agent"]
      TJS["tunnel.js<br/>spawn cloudflared tunnel --config<br/>/home/rudra-unix/.cloudflared/config.yml<br/>run home-cloud"]
      CFG["~/.cloudflared/config.yml<br/>credentials JSON"]
      REL["reload = restartTunnel()<br/>SIGTERM old child + respawn<br/>NOT SIGHUP"]
    end

    subgraph AGENT["Node.js Agent  ·  Express v5 + ws  ·  :3000  ·  CommonJS"]
      HTTP["http.createServer(app)"]
      WSS["ws.WebSocketServer({ server })<br/>same port, upgrade event"]
      PIPE["1. express.json + cookie-parser<br/>2. /api/auth, /api/health, /api/network  PUBLIC<br/>3. /api/*      JWT middleware (/api/auth/me)<br/>4. metrics · files · compose · docker<br/>5. express.static ../dashboard/dist<br/>6. GET /{*path} → index.html"]
      AUTH["routes/auth.js + middleware/auth.js<br/>jwt.sign 7d  ·  httpOnly + secure cookie"]
      MET["routes/metrics.js<br/>SSE every 2s + :heartbeat 15s"]
      FILES["routes/file.js<br/>BASE_DIR=/home/rudra-unix"]
      DOCK["routes/docker.js<br/>dockerode → Docker Engine"]
      CMP["routes/compose.js<br/>~/.home-cloud/compose/&lt;name&gt; (legacy stacks aliased)"]
      NETR["routes/network.js<br/>os.networkInterfaces() LAN IP"]
      INGS["services/ingress.js<br/>js-yaml edit config.yml"]
      PTYH["sockets/terminal.js<br/>node-pty bash"]
      PTYC["sockets/containerExec.js<br/>docker exec PTY"]

      HTTP --- WSS
      HTTP --> PIPE
      PIPE --> AUTH & MET & FILES & DOCK & STK & NETR
      DOCK --> INGS
      WSS -->|"url contains /ws/docker/exec"| PTYC
      WSS -->|"everything else incl. /terminal"| PTYH
    end

    subgraph HOS["Host OS interfaces"]
      SOCK["/var/run/docker.sock"]
      FS["Filesystem<br/>BASE_DIR + multer + EXDEV fallback"]
      SI["systeminformation<br/>CPU · mem · disk"]
      SH["real PTY  isatty()=true<br/>cwd=$HOME  TERM=xterm-256color"]
    end

    subgraph DE["Docker Engine"]
      CTR["Containers  isolated FS + PortBindings"]
      IMG["Images  pull / prune / delete / run"]
      CMP["Compose projects<br/>label com.docker.compose.project"]
    end

    TJS --> CFG
    INGS --> REL
    REL --> TJS
    DOCK --> SOCK
    STK --> SOCK
    PTYC --> SOCK
    MET --> SI
    FILES --> FS
    PTYH --> SH
    SOCK --> CTR & IMG & CMP
  end

  BROWSER -->|"HTTPS / WSS"| DNS
  APPTAB -->|"HTTPS Host: &lt;sub&gt;.home-cloud.live"| DNS
  ING -->|"outbound tunnel only"| TJS
  TJS -->|"localhost:3000 HTTP+WS"| HTTP
  TJS -->|"localhost:&lt;hostPort&gt;"| CTR

  class BROWSER,LOGIN,SHELL,AM,FE,TERM,DM,APPTAB,NET client
  class DNS,TUN,ING edge
  class TJS,CFG,REL edge
  class HTTP,WSS,PIPE,MET,FILES,DOCK,STK,NETR,INGS,PTYH,PTYC agent
  class AUTH auth
  class SOCK,FS,SI,SH os
  class CTR,IMG,CMP docker
```

### Physical path of a request

```
┌──────────────┐   HTTPS / WSS    ┌─────────────────────┐   outbound QUIC/HTTP2    ┌──────────────────────────┐
│   Browser    │ ───────────────► │  Cloudflare Edge    │ ◄────────────────────── │  cloudflared on spare PC │
│  any device  │ ◄─────────────── │  TLS + Host route   │                         │  child of Agent          │
└──────────────┘                  └──────────┬──────────┘                         └────────────┬─────────────┘
                                             │ Host: dash.home-cloud.live                      │
                                             │ Host: jellyfin.home-cloud.live                  ▼
                                             │                                                 ┌──────────────────────────┐
                                             │                                    localhost:3000│  Agent  Express + ws     │
                                             │                                    localhost:8096│  Docker published ports  │
                                             └────────────────────────────────────────────────►└──────────────────────────┘
```

CGNAT means the right-hand side can only *leave* the house. Cloudflare flips the direction: the PC dials out, then Cloudflare relays the browser in.

---

## 3. Repo and process layout

pnpm workspace. Two packages. No extra runtime.

```
home_cloud/
├── package.json                 concurrently: agent + dashboard
├── pnpm-workspace.yaml          agent, dashboard
│
├── agent/                       CommonJS  —  no "type": "module"
│   ├── index.js                 HTTP + WS server, route mount order, startTunnel()
│   ├── tunnel.js                spawn / kill / respawn cloudflared
│   ├── middleware/auth.js       jwt.verify(req.cookies.token)
│   ├── services/ingress.js      read/write ~/.cloudflared/config.yml
│   ├── routes/
│   │   ├── auth.js              POST /login  POST /logout
│   │   ├── metrics.js           GET /           SSE
│   │   ├── file.js              CRUD + search + drives
│   │   ├── docker.js            containers, images, expose
│   │   ├── compose.js           compose deploy / start / stop / logs (aliased to /stacks)
│   │   └── network.js           GET /info  LAN IP
│   └── sockets/
│       ├── terminal.js          host bash via node-pty
│       └── containerExec.js     docker exec bash-or-sh
│
└── dashboard/                   ESM  —  React 19 + Vite 8 + TS
    └── src/
        ├── App.tsx              BrowserRouter routes
        ├── hooks/useNetworkDetector.ts
        ├── components/
        │   ├── ProtectedRoute.tsx     GET /api/auth/me
        │   ├── OSWindow.tsx           drag / resize / min / max / close
        │   └── apps/
        │       ├── SystemMonitorApp.tsx
        │       ├── TerminalApp.tsx
        │       ├── DockerApp.tsx
        │       └── ContainerConsoleTab.tsx
        └── pages/
            ├── login.tsx
            ├── desktop.tsx            Web-OS shell + taskbar
            └── files.tsx              File Explorer window body
```

### Runtime topology

```mermaid
flowchart LR
  classDef proc fill:#1e1635,stroke:#c4b5fd,color:#e8eaed
  classDef child fill:#2a2110,stroke:#fbbf24,color:#e8eaed
  classDef engine fill:#0d3d38,stroke:#14b8a6,color:#e8eaed

  DEV["pnpm dev<br/>concurrently"] --> ADEV["nodemon index.js"]
  DEV --> VITE["vite  :5173<br/>proxies /api & WS to :3000"]
  PROD["pnpm build + start"] --> APROD["node index.js"]
  APROD --> STATIC["serves dashboard/dist"]
  ADEV --> CF["child: cloudflared"]
  APROD --> CF
  ADEV --> D["dockerode → docker.sock"]
  APROD --> D
  D --> E["dockerd"]

  class DEV,ADEV,APROD,VITE proc
  class CF child
  class D,E engine
```

Production is one Node process on `:3000` that serves the built SPA, the API, and both WebSocket kinds. Dev runs Vite separately; there is no `server.proxy` in `vite.config.ts`, so the intended remote/LAN path is always through the Agent.

---

## 4. Agent internals

### 4.1 Single-port HTTP + WebSocket

`agent/index.js` creates one `http.Server`, then hangs `ws.WebSocketServer({ server })` on it. Cloudflare therefore only needs one ingress target for the control plane: `http://localhost:3000`.

```mermaid
flowchart TB
  classDef in fill:#152238,stroke:#60a5fa,color:#e8eaed
  classDef mux fill:#1e1635,stroke:#c4b5fd,color:#e8eaed
  classDef pub fill:#12261a,stroke:#4ade80,color:#e8eaed
  classDef prot fill:#2d1b69,stroke:#8b5cf6,color:#e8eaed
  classDef spa fill:#152238,stroke:#60a5fa,color:#e8eaed
  classDef ws fill:#2a1520,stroke:#f472b6,color:#e8eaed

  IN["TCP :3000"] --> UPG{"Upgrade: websocket ?"}
  UPG -->|yes| WSS["wss.on('connection')<br/>demux on request.url"]
  UPG -->|no| EXP["Express"]

  WSS -->|"includes /ws/docker/exec"| EXEC["handleContainerExec<br/>JWT from Cookie header<br/>container.exec Tty+hijack"]
  WSS -->|"else  e.g. /terminal"| HOST["handleSystemTerminal<br/>JWT from Cookie header<br/>node-pty bash"]

  EXP --> JSON["express.json"]
  JSON --> CK["cookie-parser"]
  CK --> R1["/api/auth/*   PUBLIC"]
  CK --> HL["GET /api/health   PUBLIC (PNA + CORS)"]
  CK --> NET["/api/network   PUBLIC (LAN IP)"]
  CK --> MW["/api/*   authMiddleware"]
  MW --> R2["/api/metrics"]
  MW --> R3["/api/files"]
  MW --> R4["/api/docker/compose   mounted first (with /stacks alias)"]
  MW --> R5["/api/docker"]
  CK --> ST["express.static ../dashboard/dist"]
  ST --> SPA["GET /{*path} → index.html"]

  class IN,UPG in
  class WSS,EXEC,HOST ws
  class R1,HL,NET pub
  class MW,R2,R3,R4,R5 prot
  class ST,SPA spa
```

Mount order is load-bearing:

| Order | Mount | Why it is there |
|------:|-------|-----------------|
| 1 | `express.json` + `cookie-parser` | Body + `req.cookies.token` |
| 2 | `/api/auth` | Login/logout/me verification (`/me` validates session cookie) |
| 3 | `GET /api/health` | Public liveness probe with CORS `*` & Private Network Access (PNA) |
| 4 | `/api/network` | Public local IP discovery for split-horizon LAN switching |
| 5 | `/api` + `authMiddleware` | Everything else under `/api` requires valid JWT |
| 6 | `/api/docker/compose` **before** `/api/docker` | Otherwise `:id` on docker would swallow `compose` (legacy `/api/docker/stacks` aliased) |
| 7 | `/api/docker`, `/api/files`, `/api/metrics` | Authenticated feature routers |
| 8 | `express.static(dashboard/dist)` | Built SPA assets |
| 9 | `GET /{*path}` → `index.html` | React Router deep links (`/docker`, `/files`, …) |

### 4.2 Auth

Single shared passcode. One JWT. No users table.

```mermaid
sequenceDiagram
  autonumber
  actor U as Browser
  participant L as POST /api/auth/login
  participant M as authMiddleware
  participant WS as WebSocket handler

  U->>L: { password }
  alt password === process.env.PASSWORD
    L-->>U: Set-Cookie: token  (httpOnly, secure, JWT 7d, payload {authorized:true})
  else
    L-->>U: 401 Invalid password
  end

  U->>M: any /api/*  (cookie auto-sent)
  M->>M: jwt.verify(token, JWT_SECRET)
  alt valid
    M-->>U: next()
  else missing / bad
    M-->>U: 401 Unauthorized
  end

  U->>WS: Upgrade + Cookie: token
  WS->>WS: cookie.parse + jwt.verify
  alt valid
    WS-->>U: PTY session
  else
    WS-->>U: socket close
  end
```

`httpOnly` keeps the token out of JS (XSS). `secure` dynamically respects the transport: set to `true` over HTTPS and `false` over plain HTTP LAN, so both remote tunnel and local IP sessions save cookies reliably.

`ProtectedRoute` does **not** parse the cookie in JS. It queries `GET /api/auth/me`. 200 means the server verified the cookie JWT; 401 sends the user to `/login`.

### 4.3 API surface

**Auth** (`routes/auth.js`)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/login` | Validates passcode, signs JWT, sets `token` cookie |
| GET | `/api/auth/me` | Validates active session token cookie (`{ authenticated: true }`) |
| POST | `/api/auth/logout` | `clearCookie('token')` |

**Health / network**

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | `{status:"ok"}`, public, CORS `*`, Private Network Access (PNA) header |
| GET | `/api/network/info` | First non-virtual IPv4 + port `3000` (public for LAN discovery) |

**Metrics** (`routes/metrics.js`)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/metrics` | SSE. `retry: 5000`. Body every 2s from `systeminformation` (`currentLoad`, `mem`, `fsSize`). Comment `: heartbeat` every 15s so Cloudflare does not idle-kill the stream. |

**Files** (`routes/file.js`) — sandbox `BASE_DIR = /home/rudra-unix`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/files` | List directory |
| GET | `/api/files/download` | Stream file |
| GET | `/api/files/view` | Inline preview (`mime-types`) |
| GET | `/api/files/drives` | `systeminformation` mounts |
| GET | `/api/files/search` | `child_process.spawn` |
| POST | `/api/files/upload` | `multer` to resolved dest |
| POST | `/api/files/copy` | |
| POST | `/api/files/folder` | mkdir |
| POST | `/api/files/file` | touch |
| PATCH | `/api/files/rename` | |
| PATCH | `/api/files/move` | `rename`, or `cp`+`rm` on `EXDEV` |
| DELETE | `/api/files/delete` | |

Guard is `path.resolve` then `startsWith(BASE_DIR)` (no trailing-slash variant).

**Docker containers / images** (`routes/docker.js`) — `dockerode` default socket

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/docker/containers` | `listContainers({all:true})` + `exposedRule` from ingress YAML |
| POST | `/api/docker/containers/create` | image, name, env, ports, volumes, restartPolicy; then start |
| POST | `/api/docker/containers/:id/start` | 304 → 409 already running |
| POST | `/api/docker/containers/:id/stop` | stop + `removeIngressByPort` + reload |
| POST | `/api/docker/containers/:id/restart` | |
| DELETE | `/api/docker/containers/:id/delete` | remove + ingress cleanup; 409 if still running |
| GET | `/api/docker/containers/:id/stats` | SSE `container.stats({stream:true})` |
| GET | `/api/docker/containers/:id/inspect` | full inspect JSON |
| GET | `/api/docker/containers/:id/logs` | SSE follow, tail 200, timestamps, TTY demux |
| GET | `/api/docker/containers/:id/logs/download` | attachment |
| POST | `/api/docker/containers/:id/expose` | `{subdomain}` → first HostPort → YAML → restart tunnel |
| POST | `/api/docker/containers/:id/unexpose` | `{subdomain}` → drop rule → restart |
| GET | `/api/docker/images` | |
| GET | `/api/docker/images/pull?image=` | SSE layer progress |
| DELETE | `/api/docker/images/:id` | 409 if in use |
| POST | `/api/docker/images/prune` | |

**Compose Projects** (`routes/compose.js`) — disk + native Docker Compose CLI

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/docker/compose` | folders in `~/.home-cloud/compose` ∪ compose-project labels (legacy `/api/docker/stacks` aliased) |
| GET | `/api/docker/compose/:name` | YAML + member containers |
| POST | `/api/docker/compose/deploy` | write YAML, `docker compose -p <name> up -d --remove-orphans`, SSE lines |
| POST | `/api/docker/compose/:name/start` | `docker compose -p <name> start` (with `up -d` fallback) |
| POST | `/api/docker/compose/:name/stop` | `docker compose -p <name> stop` (non-destructive) |
| DELETE | `/api/docker/compose/:name` | `docker compose -p <name> down -v --remove-orphans` + `rm -rf` compose dir |
| GET | `/api/docker/compose/:name/logs` | SSE `docker compose logs -f --tail=200` |

---

## 5. Dashboard internals

The dashboard is a single-page Web OS, not a multi-page admin site.

```mermaid
flowchart TB
  classDef route fill:#152238,stroke:#60a5fa,color:#e8eaed
  classDef shell fill:#1e1635,stroke:#c4b5fd,color:#e8eaed
  classDef app fill:#0d3d38,stroke:#14b8a6,color:#e8eaed

  RR["App.tsx  BrowserRouter"] --> PUB["/login (pre-login LAN detection)"]
  RR --> PR["ProtectedRoute → GET /api/auth/me"]
  PR --> D["/  /terminal  /metrics  /files  /docker<br/>all render Desktop"]

  D --> WS["pages/desktop.tsx"]
  WS --> OW["OSWindow × N<br/>z-index, drag, resize, min, max, close"]
  WS --> TB["Taskbar<br/>icons center · tray right"]
  WS --> ND["useNetworkDetector<br/>tray: LAN ip  or  Tunnel  or  Upgrading…"]

  OW --> A1["Activity Monitor"]
  OW --> A2["File Explorer"]
  OW --> A3["Terminal"]
  OW --> A4["Docker Manager"]

  A4 --> T1["Containers tab"]
  A4 --> T2["Images tab"]
  A4 --> T3["Compose tab"]
  T1 --> S1["Logs SSE"]
  T1 --> S2["Stats SSE"]
  T1 --> S3["Inspect REST"]
  T1 --> S4["Console WS exec"]
  T1 --> S5["Expose / Unexpose"]

  class RR,PUB,PR,D route
  class WS,OW,TB,ND shell
  class A1,A2,A3,A4,T1,T2,T3,S1,S2,S3,S4,S5 app
```

Deep links (`/docker`, `/files`, …) only decide which `OSWindow` opens. The shell is always `Desktop`. Each window is wrapped in an `ErrorBoundary` so one crash does not blank the desktop.

Transport choices on the client:

| Surface | Transport | Why |
|---------|-----------|-----|
| Login / files / docker actions | `fetch` / `axios` (cookies included, same origin) | Request/response |
| Metrics, container stats/logs, image pull, stack deploy/logs | `EventSource` | Server → client stream, auto-retry |
| Host terminal | `WebSocket` `//${host}/terminal` | Bidirectional bytes |
| Container console | `WebSocket` `//${host}/ws/docker/exec?containerId=` | Bidirectional + JSON `{type:"resize"}` |

---

## 6. Critical data flows

### 6.1 Host terminal

```
xterm.js keystroke
    → WebSocket  /terminal
    → sockets/terminal.js  jwt.verify
    → node-pty.write → bash
    → PTY onData → ws.send
    → xterm.write
```

A real PTY is mandatory. `child_process.spawn` makes `isatty()` false; vim, htop, and fzf then misbehave.

There is no client reconnect. A dropped tunnel requires reopening the window.

### 6.2 Metrics

```
systeminformation every 2s
    → res.write("data: "+JSON+"\n\n")
    → EventSource.onmessage
    → MeterBar + 60-point SparklineChart

every 15s: res.write(": heartbeat\n\n")
    → EventSource ignores  (SSE comment)
    → Cloudflare idle timer resets
```

SSE over long-poll HTTP because: proxies buffer ordinary responses, Cloudflare kills idle HTTP, and SSE already has framing + `retry:`.

### 6.3 Expose a container (control plane → data plane)

This is the glue between Docker and Cloudflare. There is **no** Cloudflare DNS API call in the running agent. The code writes YAML and restarts `cloudflared`. DNS for `*.home-cloud.live` is assumed to already point at the tunnel.

```mermaid
sequenceDiagram
  autonumber
  actor U as Docker Manager
  participant API as POST /api/docker/containers/:id/expose
  participant D as dockerode inspect
  participant Y as services/ingress.js
  participant T as tunnel.js
  participant CF as cloudflared

  U->>API: { subdomain: "jellyfin" }
  API->>D: NetworkSettings.Ports
  D-->>API: first HostPort  (e.g. 8096)
  alt no published port
    API-->>U: 400 Container does not have any mapped host ports
  else
    API->>Y: addIngressRule("jellyfin", 8096)
    Y->>Y: insert before catch-all in config.yml
    API->>T: reloadCloudflared() → restartTunnel()
    T->>CF: SIGTERM old child
    T->>CF: spawn new cloudflared
    CF-->>T: "Registered tunnel connection"
    API-->>U: { url: "https://jellyfin.home-cloud.live", hostPort }
  end
```

Container deletion (`DELETE /api/docker/containers/:id/delete`) walks published ports: `await removeIngressByPort(hostPort)` then reloads cloudflared. Temporary container `stop` intentionally leaves ingress rules intact so restarting the container preserves domain routing.

Ingress file shape the agent actually edits:

```yaml
tunnel: <uuid>
credentials-file: /home/rudra-unix/.cloudflared/<uuid>.json
ingress:
  - hostname: dash.home-cloud.live
    service: http://localhost:3000
  - hostname: jellyfin.home-cloud.live    # inserted by addIngressRule
    service: http://localhost:8096
  - service: http_status:404              # MUST stay last
```

`getIngressRules()` skips `dash.${CF_DOMAIN}` so the dashboard hostname is never treated as an "exposed app".

### 6.4 Compose project deploy

```
POST /api/docker/compose/deploy { name, yaml }
    → mkdir ~/.home-cloud/compose/<name>/
    → write docker-compose.yml
    → spawn: docker compose -f … -p <name> up -d --remove-orphans
    → each stdout/stderr chunk  →  SSE  data: {"text":"…"}
    → close: data: {"status":"success"|"failed","exitCode":N}
```

List state is derived, not stored: compose project label `com.docker.compose.project` plus whatever folders exist on disk → `running` / `partial` / `stopped` / `uncreated`.

### 6.5 LAN vs tunnel (client-side, not DNS)

V3 split-horizon DNS is not shipped. What is shipped is a **page-origin redirect**.

```mermaid
flowchart TD
  classDef q fill:#2a2110,stroke:#fbbf24,color:#e8eaed
  classDef ok fill:#12261a,stroke:#4ade80,color:#e8eaed
  classDef rem fill:#2a1a10,stroke:#fb923c,color:#e8eaed

  S["Login & Desktop mount useNetworkDetector"] --> H{"hostname is dotted IPv4<br/>or localhost?"}
  H -->|yes| LAN["isDirectLocal = true<br/>tray: LAN (192.168.x.x)<br/>stay, already on Wi-Fi"]
  H -->|no  dash.home-cloud.live| INFO["GET /api/network/info<br/>skip docker/veth/br-/tun/…"]
  INFO --> P["fetch http://&lt;lan-ip&gt;:3000/api/health<br/>AbortController 1500ms  mode:cors"]
  P -->|200| REDIR["isLocalLAN = true<br/>location = http://lan-ip:3000 + path"]
  P -->|timeout / fail| TUN["stay on tunnel<br/>tray: Tunnel"]

  class H,INFO,P q
  class LAN,REDIR ok
  class TUN rem
```

When the redirect succeeds, the browser talks to the Agent at gigabit LAN RTT and never hairpins through Cloudflare. When it fails (phone on 4G, or LAN IP unreachable), the Cloudflare path is unchanged. Pre-login detection runs on `login.tsx` to ensure users on home Wi-Fi are redirected directly to the LAN origin *before* signing in, avoiding double authentication.

---

## 7. Trust boundaries and isolation

```
Internet
   │  TLS at Cloudflare  ·  no open router ports
   ▼
Cloudflare Edge
   │  Host-based ingress  ·  dash vs app hostnames
   ▼
cloudflared  (unprivileged child, outbound only)
   │  localhost only
   ▼
Agent :3000
   │  JWT cookie on /api/* and both WS handlers
   │  file sandbox BASE_DIR
   │  docker group → docker.sock   ←  this is root-equivalent
   ▼
Docker Engine
   │  per-container FS, PortBindings, compose project labels
   ▼
App containers   (data plane, own origin)
```

Implications:

- Anyone with the passcode has a host shell (`node-pty` as the Agent's user) and Docker (effectively host root). This is intentional for a single-owner spare PC.
- File routes cannot leave `/home/rudra-unix` by design, but the terminal can.
- Each exposed app is a separate origin (`jellyfin.home-cloud.live` vs `dash.home-cloud.live`), so cookies and storage do not leak across apps.
- Restarting the tunnel to apply ingress drops in-flight SSE/WS on `dash` for a moment. That is the current reload strategy.

---

## 8. Key decisions (as built)

| Decision | Rationale |
|----------|-----------|
| Cloudflare Tunnel, not a VPS or port-forward | CGNAT. The PC can only dial out. |
| One `cloudflared`, many hostnames | One process, one config, Host-header routing. |
| Docker for apps, Cloudflare for reachability | Lifecycle ≠ ingress. Agent orchestrates both. |
| Apps in new tabs, never iframe | Cross-origin `X-Frame-Options`. Control plane vs data plane. |
| Single port 3000 for HTTP + WS | One ingress target. `ws` hijacks `upgrade`. |
| SSE for metrics/logs/pull/deploy, WS for shells | One-way stream vs bidirectional PTY. |
| JWT in `httpOnly; secure` cookie | Auto-sent on XHR and WS handshake. Not readable by JS. |
| CommonJS agent | `node-pty` / `dockerode` native `.node` bindings want `require()`. |
| `restartTunnel()` instead of SIGHUP | What `services/ingress.js` actually calls today. |
| No Cloudflare DNS API in the agent | Expose only mutates local YAML. Wildcard/CNAME is out-of-band. |
| Client LAN probe + redirect, not split-horizon DNS | Works without a local DNS server. 1.5s fail-open to tunnel. |
| pnpm workspaces + concurrently | Two packages. No Turborepo. |
| Custom Docker UI, not Portainer iframe | Same origin, same auth, same windowing shell. |

---

## 9. What is not in this diagram

These exist in `docs/implementation/` as future work, not as running processes:

| Item | Status |
|------|--------|
| App Store / one-click catalog | Not built |
| noVNC / remote desktop | Not built |
| Cloudflare REST CNAME create on expose | Documented in learn notes, **not** in `ingress.js` |
| SIGHUP zero-downtime reload | Roadmap claim; code respawns the process |
| Multi-user / RBAC | Single passcode |
| Volume backup / watchdog / live `docker update` quotas | V3 |
| `*.homecloud.app` central SaaS | V4 |
| Vite dev proxy | Configured in `vite.config.ts` (proxies `/api`, `/terminal`, `/ws` to `:3000`) |

Known debts that affect the picture: hardcoded `:3000`, hardcoded `BASE_DIR`, hardcoded cloudflared config path in `tunnel.js` vs `HOME`-relative path in `ingress.js`. (Resolved debts: terminal WS now features decoupled persistent PTY sessions with 5MB scrollback replay and auto-reconnect, and `/api/health` is a public CORS/PNA endpoint).

---

## 10. How to read this against the code

Start at `agent/index.js`. That file is the entire control-plane process: middleware order, router mounts, WebSocket demux, static SPA, tunnel boot. Then:

1. `tunnel.js` + `services/ingress.js` — how the machine becomes reachable.
2. `routes/*.js` — what the dashboard can do.
3. `sockets/*.js` — the two PTY paths.
4. `dashboard/src/App.tsx` → `pages/desktop.tsx` — the only UI shell.
5. `hooks/useNetworkDetector.ts` — the LAN shortcut around the tunnel.
