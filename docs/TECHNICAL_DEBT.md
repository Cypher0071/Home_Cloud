# Home Cloud - Technical Debt & Tradeoffs

This document tracks active technical debt, architectural tradeoffs, and deferred enhancements in the Home Cloud codebase.

---

## 🔒 Security & Privilege Boundaries

### 1. Docker Compose Privilege Escalation vs Container Scope
* **Debt**: Single-container creation strictly validates host bind mounts within the allowed storage scope (`isInsideAllowedScope()` in `agent/paths.js`). In contrast, Compose deployments (`POST /api/docker/compose/deploy` in `agent/routes/compose.js`) accept arbitrary YAML files and execute `docker compose up -d`.
* **Impact**: Compose files can declare bind mounts to system directories (`/`, `/etc`) or the host Docker socket (`/var/run/docker.sock`), bypassing the single-container filesystem jail.
* **Target Fix**: Add AST/YAML parsing and policy validation for Compose files prior to execution to enforce storage scope and prevent unauthorized socket mounting.

### 2. Listen port
* **Resolved**: The agent listens on `process.env.PORT` (default `3000`). The port is not hardcoded, and changing it does not require editing process source. Set `PORT` in `agent/.env`.

---

## 📁 File Explorer & Storage

### 3. File Search Host Dependency & Directory Context
* **Debt**:
  - `GET /api/files/search` directly spawns `fdfind`/`fd` piped to `fzf`. Searching fails on minimal Linux or containerized environments lacking these binaries.
  - The frontend (`dashboard/src/pages/files.tsx`) replaces the table view but does not display parent directory paths for matched files, making it difficult to identify file locations in deep folder structures.
  - Keyboard shortcuts (`Ctrl+F` to search, `Esc` to clear) and match count badges are missing.
* **Target Fix**: Implement an in-process Node.js recursive file search stream with optional `fd` acceleration, and update the search UI with directory breadcrumbs and keyboard controls.

### 4. 100 MB Remote Upload Cap (Cloudflare Tunnel Limit)
* **Debt**: Remote uploads through Cloudflare Tunnel (`dash.<domain>`) are subject to Cloudflare's 100 MB request body limit on Free and Pro tiers. `POST /api/files/upload` currently performs single unchunked multipart uploads.
* **Tradeoff**: Uploads over 100 MB fail remotely with HTTP 413. Direct local LAN transfers bypass Cloudflare and are unrestricted.
* **Target Fix**: Implement resumable client-side chunked slicing (50 MB chunks or `tus` protocol) with server-side assembly.

### 5. File Explorer Navigation & Layout Controls
* **Debt**:
  - Locked to tabular list view (no grid or thumbnail tile view for photos/media).
  - No side details inspector pane for extended metadata and large file previews.
  - Keyboard navigation (arrow keys, Enter to open, Delete to remove) is not implemented.

---

## ⚡ Operational & Network Architecture

### 6. Tunnel Process Restart Drops In-Flight Streams on Ingress Changes
* **Debt**: Updating container ingress rules (`agent/services/ingress.js`) reloads Cloudflare tunnel configuration by terminating and restarting the `cloudflared` process.
* **Impact**: Existing TCP/HTTP/WS sessions (active terminal shells, container log streams, SSE metrics) briefly disconnect until client auto-reconnection kicks in.

### 7. Tunnel Buffering on Non-SSE Chunked Streams
* **Debt**: `cloudflared` buffers proxied HTTP responses unless explicitly using `Content-Type: text/event-stream` or WebSockets. Unbuffered streaming endpoints must adhere to SSE or WebSocket protocols.

---

## 🖥️ Desktop Shell & Host Controls

### 8. Host Power Management & System Diagnostics
* **Debt**: Host-level actions (system reboot, shutdown) and advanced host networking interface diagnostics are deferred.
