# Home Cloud - Technical Debt & Tradeoffs

This document tracks active technical debt and deliberate tradeoffs in the Home Cloud codebase.
Planned features live in [`future_roadmap.md`](future_roadmap.md), and rules every new endpoint
must follow live in [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md).

---

## 🔒 Accepted Tradeoffs

### 1. Compose deploys are not limited to the storage scope
* **What**: Single-container create checks host bind mounts against the allowed storage scope (`isInsideAllowedScope()` in `agent/paths.js`). Compose deploys (`POST /api/docker/compose/deploy` in `agent/routes/compose.js`) pass the YAML to `docker compose up -d` as written, so a Compose file can mount `/`, `/etc`, or the Docker socket.
* **Why it stays**: The scope check is a guard against clicking the wrong folder, not a security boundary. Anyone signed in to the dashboard already has a host shell and the Docker socket, which is root-equivalent. The [threat model](../landing/src/content/docs/docs/security/threat-model.md) says so. A Compose policy engine would add complexity without protecting against the signed-in owner.
* **Mitigation**: The deploy dialog warns, without blocking, when the YAML mounts the Docker socket or a system path, runs privileged, uses the host network or PID namespace, maps devices, or adds powerful capabilities (`dashboard/src/utils/composeRisk.ts`).

---

## 📁 File Explorer & Storage

### 2. 100 MB Remote Upload Cap (Cloudflare Tunnel Limit)
* **Debt**: Remote uploads through Cloudflare Tunnel (`dash.<domain>`) are subject to Cloudflare's 100 MB request body limit on Free and Pro plans. `POST /api/files/upload` performs a single unchunked multipart upload (multer, 2 GiB limit).
* **Tradeoff**: Uploads over 100 MB fail remotely with HTTP 413. Transfers over the LAN address bypass Cloudflare and are not affected.
* **Target Fix**: Chunked uploads (50 MB pieces, an upload id, a temp file, and an atomic rename on completion). Until then, show a clear "use the LAN address for files over 100 MB" message on a 413.

---

## ⚡ Operational & Network Architecture

### 3. Tunnel Process Restart Drops In-Flight Streams on Ingress Changes
* **Debt**: Exposing or unexposing a container (`agent/services/ingress.js`) applies the new ingress rules by restarting the `cloudflared` process, not by reloading its config.
* **Impact**: Remote connections drop for a moment. Host terminals reattach to their running session and replay scrollback, and metrics streams reconnect on their own, so the visible effect is small. Other open streams, such as container logs and the container console, may need to be reopened.

---

## 🖥️ Desktop Shell & Host Controls

### 4. Host Power Management & System Diagnostics
* **Debt**: Host-level actions (reboot, shutdown) and network interface diagnostics are not built. Use the terminal for now.
