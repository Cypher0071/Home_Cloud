# Home Cloud — V3 Hardware Deployment & Standalone Server Roadmap

Historical note: a Cloudflare DNS API client and `SIGHUP` reload were **not shipped**. Ingress writes local YAML and restarts `cloudflared`.

This document outlines the architectural enhancements, performance optimizations, and deployment hardening completed and planned for **V3** to transform Home Cloud into a production-ready, standalone personal server running 24/7 on a spare PC.

---

## 🎯 V3 Milestones & Checkpoints

### Phase 1: Smart Network Switcher & Split-Horizon DNS (LAN vs. Remote Detection) ⚡ ✅ *COMPLETED*

This feature intelligently routes user traffic based on client location to maximize speed and eliminate bandwidth bottlenecks.

* [x] **Local Network Detection Engine:** Implemented a client-side network detector in the dashboard (`useNetworkDetector.ts`) that performs a micro-ping check to `/api/health` with Private Network Access headers to verify whether the client device is on the same Local Area Network (LAN/Wi-Fi) as the server.
* [x] **Automatic Route Selection:**
  * **On Local Network (LAN):** Automatically offers direct routing to the host's local IP and port (`http://192.168.x.x:3000`) for instant `< 2ms` latency and 1Gbps local Wi-Fi speeds (crucial for 4K streaming and large file transfers).
  * **On Remote Network (External):** Transparently routes traffic through the Cloudflare HTTPS Tunnel subdomain (`https://dash.home-cloud.live`).
* [x] **Dual-Link UI Action Toggle:** Added dual-action triggers in the container list displaying both the fast **Direct Local LAN Link** (`:port`) and the secure **Remote Tunnel Link** (`.home-cloud.live`).
* [x] **Taskbar Status & Upgrade Badge:** Integrated a real-time network indicator in the desktop system tray showing connection mode (Direct LAN vs. Tunnel) with one-click instant LAN redirection.

---

### Phase 2: Dashboard Performance & On-Demand Code-Splitting ⚡ ✅ *COMPLETED*

This feature eliminates monolithic bundle bloat, ensuring instantaneous initial loads on mobile devices and slower remote network connections.

* [x] **Route-Level Code Splitting:** Implemented `React.lazy()` for `/login` and `/` (`Desktop`) with `<PageLoader>` fallback, ensuring unauthenticated visitors never download desktop or window application code.
* [x] **Window-Level Dynamic Imports:** Centralized dynamic loaders in `windowAppRegistry.ts` for all desktop applications (`DockerApp`, `FileExplorer`, `TerminalApp`, `SystemMonitorApp`), cutting the initial desktop entry chunk from 950 kB down to 49 kB (-95% reduction).
* [x] **Docker Console Isolation:** Lazily isolated `ContainerConsoleTab` inside `DockerApp` so that `@xterm/xterm` (341 kB) only loads when the container console tab is actively clicked.
* [x] **Zero-Layout-Shift Shimmer Skeletons:** Created dark-theme shimmer loading skeletons (`WindowSkeleton.tsx`) matching exact window body dimensions for instant window opening.
* [x] **Network Resilience & Retry Cache-Busting:** Implemented `WindowErrorBoundary.tsx` and `retryDynamicImport` with exponential backoff and cache-key busting (`${id}@${retryVersion}`) to recover from transient network drops without full page reloads.
* [x] **Rolldown Chunk Grouping:** Configured native `output.codeSplitting.groups` in `vite.config.ts` for vendor libraries (`vendor-react`, `vendor-lucide`, `vendor-xterm`, `vendor-yaml`, `vendor-prism`, `vendor-axios`).

---

### Phase 3: Persistent Sessions & State Resumption ("Resume Session") 🖥️ ✅ *COMPLETED*

This feature decouples the user's interactive sessions from transient network connections, ensuring long-running tasks survive laptop sleep, device switching, or browser restarts.

* [x] **Decoupled Backend PTY Daemon:** Refactored `agent/sockets/terminal.js` with `TerminalSession` and `TerminalBuffer` (5MB ring buffer) so that closing a browser tab, reloading the page, or experiencing a network drop keeps the underlying `bash`/`zsh` process alive in the background.
* [x] **Seamless Terminal Re-attachment & Auto-Reconnect:** In `TerminalApp.tsx`, terminal sessions auto-reconnect with exponential backoff on disconnects, re-attach to the running backend PTY session by `sessionId`, replay recent terminal output buffer, and synchronize terminal geometry (`SIGWINCH`).

---

### Phase 4: Host Daemonization, Boot Hardening & Spare PC Setup 🚀

This phase focuses on the low-level system engineering and daemonization required to run Home Cloud autonomously 24/7 on a physical spare PC, behaving like an always-on personal VM / server.

* [x] **Systemd Service Architecture (`home-cloud.service`):**
  * Production-grade systemd service unit template (`home-cloud.service.template`) managing both the backend Node.js Agent and the built Dashboard.
  * Auto-start on system boot (`WantedBy=multi-user.target`) with process supervisor self-recovery (`Restart=always`, `RestartSec=5s`) and `KillMode=mixed`.
  * Non-root security sandboxing with supplementary `docker` group and resource boundaries.
* [x] **Boot-Time Network & Tunnel Resilience: ✅**
  * Asynchronous, non-blocking tunnel startup with exponential backoff retry loop (`startTunnelWithRetry`) ensuring local LAN HTTP access (`:3000`) is instantly available on boot.
  * Resolved Tunnel recycling race condition in `agent/tunnel.js` by awaiting process exit with a 3000ms `SIGKILL` escalation fallback.
  * Graceful shutdown signal trapping (`SIGTERM`, `SIGINT`) in `agent/index.js` cleanly draining HTTP connections, closing WebSockets, terminating active node-pty terminal sessions (`closeAllSessions()`), and stopping `cloudflared`.
* [x] **Spare PC Setup Script (`setup.sh`):**
  * Automated host configuration script. Node.js `>= 22.13` and Docker must already be installed. pnpm `11.28.8` is installed with corepack. `cloudflared` is optional and downloaded only at a pinned release after sha256 verification. The script writes `.env` and enables the systemd unit as the install user, not root.

---

## 📊 Complete Industry Feature Comparison

| Feature Capability | **Home Cloud** | Portainer CE/EE | Umbrel OS | CasaOS | Unraid / Synology DSM |
|---|---|---|---|---|---|
| **Native Desktop Windowing UI** | ✅ *(Pure SPA, zero iframe/extra port)* | ❌ *(Single-app web UI)* | ❌ *(Fixed web grid)* | ❌ *(Fixed web grid)* | ❌ *(Web admin dashboard)* |
| **Container Lifecycle & Telemetry (SSE)** | ✅ *(Real-time raw metrics)* | ✅ *(Polling)* | ❌ | ✅ | ✅ |
| **Interactive Container Console (`docker exec`)** | ✅ *(WebSockets + PTY + `/bin/sh` fallback)* | ✅ | ❌ | ❌ | ❌ *(Requires SSH)* |
| **Live Log Streaming & Attachment Download** | ✅ *(SSE stream + `.log` attachment)* | ✅ | ❌ *(Static view)* | ✅ *(Static view)* | ✅ |
| **Image Management (Layer SSE Pull/Prune)** | ✅ *(Layer-by-layer progress bar)* | ✅ | ❌ | ✅ | ✅ |
| **Custom Container Creation Modal** | ✅ *(Ports, Envs, Mounts, Restart policy)* | ✅ | ❌ | ✅ | ✅ |
| **Cloudflare Ingress Autowiring** | ✅ *(writes local ingress YAML and restarts cloudflared; DNS API and `SIGHUP` reload were not shipped)* | ❌ *(Manual proxy)* | ❌ *(Manual proxy)* | ❌ *(Manual proxy)* | ❌ *(Manual proxy)* |
| **Multi-Container Compose Projects (`docker-compose`)** | ✅ *(V2: Native compose CLI + 2-way sync)* | ✅ | ❌ | ✅ *(Partial)* | ✅ |
| **Smart Split-Horizon DNS (LAN vs Remote)** | ✅ *(V3: `<2ms` LAN vs Remote fallback)* | ❌ | ❌ | ❌ | ❌ *(Requires custom DNS server)* |
| **Persistent Sessions ("Resume Session")** | ✅ *(V3: Headless PTY + Replay Buffer)* | ❌ | ❌ | ❌ | ❌ |
| **Host Daemonization & Boot Hardening** | ✅ *(V3: Systemd unit + resilient boot loop)* | ❌ *(Docker only)* | ✅ | ✅ | ✅ |
| **Crash Watchdog & Webhook Alerts** | ⏳ *(V4: Discord / Telegram notifications)* | ✅ *(Paid EE only)* | ❌ | ❌ | ✅ |
| **Simple Automated Volume & DB Backups** | ⏳ *(V4: `.tar.gz` + DB dumps + Cron)* | ❌ *(Requires extension)* | ❌ | ❌ *(Requires third-party app)* | ✅ |
| **Desktop Window Layout State Persistence** | ⏳ *(V4: Window coordinates & active apps)* | ❌ | ❌ | ❌ | ❌ |
