# Home Cloud - Technical Debt & Tradeoffs

This document outlines the current technical limitations, security tradeoffs, operational gaps, and implementation shortcuts in the Home Cloud codebase.

---

## ⚡ Performance & Architecture Gaps

### 1. Tunnel Process Recycling Race Condition (Resolved ✅)
* **Status**: Resolved in V3 Phase 4, Step 1.
* **Resolution**: Implemented clean, asynchronous process termination and recycling in `agent/tunnel.js`. When starting, restarting, or stopping the tunnel, existing `activeChild` processes are sent `SIGTERM` and awaited on `'close'` with a 3000ms `SIGKILL` escalation fallback before spawning any new process. Added graceful shutdown signal handling (`SIGTERM`/`SIGINT`), HTTP connection draining, WebSocket and PTY cleanup (`closeAllSessions()`), and an exponential backoff tunnel retry loop (2s to 30s) for boot-time network resilience.

### 2. Uncached Filesystem Drive Metrics (Resolved ✅)
* **Status**: Resolved.
* **Resolution**: Implemented in-memory TTL caching (10s) and in-flight promise request coalescing in `agent/routes/file.js` via `getFilteredDrives()`. Rapid folder navigation in File Explorer now returns cached filesystem drive metadata instantaneously with zero repeated `df` system shell calls or disk I/O overhead. Verified with automated test suite in `agent/tests/verify_drives_cache.mjs`.

---

## 🚨 Code Quality & Test Suite Regressions

### 3. Frontend ESLint Static Analysis Violations
* **Debt**: Running `pnpm --filter dashboard lint` fails with 46 problems (45 errors, 1 warning).
* **Details**:
  * In `dashboard/src/pages/files.tsx`: Direct synchronous `setState` calls inside `useEffect` (`loadDirectory(currentPath)` and `setSearchResults([])`) violate React 19 compiler rules (`react-hooks/set-state-in-effect`), creating cascading re-renders and potential performance degradation.
  * In `dashboard/src/pages/files.tsx`: Multiple instances of `@typescript-eslint/no-explicit-any` (lines 551, 933, 1020, 1066) bypass TypeScript's type safety.
  * In `dashboard/src/pages/files.tsx`: Missing hook dependencies in `useEffect` for keyboard shortcuts (`handleCopy`, `handleCut`, `handlePaste` triggering `react-hooks/exhaustive-deps`).
* **Impact**: Fails automated CI/CD lint checks and introduces rendering instability.

### 4. Web Terminal E2E Test Suite Regressions (8 Failing Tests)
* **Debt**: The test runner `.agents/tests/terminal_e2e.test.mjs` fails 8 out of 93 automated test cases.
* **Details**:
  * Failing tests:
    1. `T1.28`: Clear button click invokes `term.clear()` and `term.focus()`
    2. `T1.29`: Reconnect button click writes notification banner, focuses term, and executes `connect()`
    3. `T1.40`: Proper React 19 type safety with typed `useRef` and `useState` definitions
    4. `T2.24`: Status transitions to "disconnected" inside `socket.onerror` handler
    5. `T2.38`: WebSocket endpoint targets `/terminal` path
    6. `T3.1`: Font loading + xterm fit interaction ensures refit when JetBrains Mono is ready
    7. `T3.4`: Toolbar Clear action clears xterm buffer and immediately restores terminal focus
    8. `T3.5`: Container resizing triggers `ResizeObserver` and `FitAddon` calculation protected by try/catch
  * **Root Cause**: Recent mobile optimization and soft-key toolbar commits (`738cd9f` & `5383e12`) refactored `dashboard/src/components/apps/TerminalApp.tsx` (introducing `SESSION_ID = 'term_main'`, soft keys, and `visualViewport` event handling), causing the component's internal structure to diverge from static test regex expectations.

### 5. Dead & Hardcoded Standalone Terminal Prototype
* **Debt**: `dashboard/src/pages/terminal.tsx` contains an obsolete 34-line prototype component.
* **Details**:
  * Hardcodes `wss://home-cloud.live/terminal` directly, breaking compatibility with custom domains and LAN IP addresses.
  * Lacks session resumption, error boundaries, soft keys, reconnection logic, and dynamic fitting.
  * It is dead code: `App.tsx` and `desktop.tsx` route to `components/apps/TerminalApp.tsx`.

---

## 🔒 Security, Authentication & Privilege Boundary Gaps

### 6. Plaintext Password Comparison & Zero Login Rate Limiting
* **Debt**: In `agent/routes/auth.js`, the passcode check uses direct string equality: `process.env.PASSWORD === req.body.password`.
* **Tradeoff / Risk**:
  * Vulnerable to timing attacks compared to constant-time comparisons (`crypto.timingSafeEqual`).
  * The password is not hashed with modern key derivation functions (e.g. Argon2id or bcrypt).
  * `POST /api/auth/login` lacks rate limiting, brute-force locking, or exponential delay backoff. If exposed without Cloudflare WAF rate limiting, the endpoint is vulnerable to automated credential stuffing.

### 7. Docker Compose Privilege Escalation vs Container Bind Mount Jail Mismatch
* **Debt**: Single container creation (`agent/routes/docker.js`) and Compose deployments (`agent/routes/compose.js`) have conflicting security boundaries.
* **Details**:
  * Single-container creation strictly jails host bind mounts within `BASE_DIR` using realpath canonicalization (`jailPath()` in `agent/paths.js`).
  * Compose project deployment accepts arbitrary `docker-compose.yml` payloads via `POST /api/docker/compose/deploy` and executes `docker compose up -d`. Compose files can declare bind mounts to `/`, `/etc`, or `/var/run/docker.sock`.
  * **Impact**: The filesystem jail on single containers is bypassed by any user deploying a Compose stack.

### 8. Single-Tenant Authentication & Unrevocable 7-Day JWTs
* **Debt**: Authentication relies on a single shared secret issuing 7-day JWTs (`expiresIn: '7d'`) in cookies.
* **Tradeoff**:
  * Multi-user tenancy, audit logs per user, and role-based access control (RBAC) do not exist.
  * JWTs lack a server-side revocation list or session blacklist. If a token is compromised, it cannot be revoked prematurely without invalidating all sessions by changing `process.env.JWT_SECRET` and restarting the agent.

### 9. Hardcoded Security Passcode Configuration
* **Debt**: The security passcode is loaded statically from environment variables (`process.env.PASSWORD`) on the agent.
* **Tradeoff**: There is no client-side UI or API endpoint to change the security passcode dynamically. Password updates require manual editing of the `.env` file on the spare PC and restarting the agent.

### 10. Hardcoded Networking & Service Ports
* **Debt**: The agent port `3000` is hardcoded across scripts and configurations.
* **Tradeoff**: Users cannot dynamically re-bind the agent to alternative local ports without modifying the startup script and environment configurations.

---

## ⚡ Operational Architecture Gaps

### 11. Tunnel Process Restart Drops In-Flight Streams on Ingress Changes
* **Debt**: In `agent/services/ingress.js`, modifying ingress rules (exposing or unexposing a container) triggers `restartTunnel()`.
* **Details**:
  * `restartTunnel()` sends `SIGTERM` to `cloudflared` and spawns a new child process.
  * While this safely reloads `~/.cloudflared/config.yml`, it drops all active TCP/HTTP/WS connections over the tunnel for several seconds.
  * Active terminal WebSocket sessions, container exec streams, and SSE metrics/logs temporarily disconnect until client reconnection logic reconnects.

---

## ⏳ Deferred Roadmap & Feature Milestones

### 12. Settings App Scope Limitation (Wallpaper / Personalization Only)
* **Debt**: The uncommitted `dashboard/src/components/apps/SettingsApp.tsx` and accompanying files (`useWallpaper.ts`, `wallpaper.ts`) only implement browser-local wallpaper personalization stored in IndexedDB.
* **Tradeoff**: The app does not provide actual system-level settings (server network diagnostics, password updates, port management, drive formatting, or power management).

### 13. Passkey Authentication (WebAuthn / FIDO2) Not Implemented
* **Debt**: Listed as pending in `todo.md` (`- [ ] we need to add passkey based login`), but no WebAuthn or FIDO2 implementation currently exists in `agent/routes/auth.js` or `dashboard/src/pages/login.tsx`.
* **Tradeoff**: Authentication remains completely reliant on a single password.

### 14. Desktop Window Layout State Persistence (Deferred to V4 Roadmap Milestone)
* **Debt**: Active open windows, positions, and coordinates are held in transient React state in `desktop.tsx` and reset upon browser refresh.
* **Tradeoff**: Refreshing the browser or logging in from another device opens a blank desktop shell rather than restoring the user's active window layout.

### 15. File Explorer Usability & Navigation (Deferred)
* **Debt**: Keyboard navigation (Arrow keys, Enter to open, Delete/Backspace to delete) is not implemented.
* **Tradeoff**: Users must perform all navigation and operations via mouse actions, limiting efficiency.

### 16. Grid / Tiles View Toggle (Deferred)
* **Debt**: The file list is locked to the tabular list row layout.
* **Tradeoff**: Alternate visual layouts (such as grid or tiles view) are not implemented, making browsing visual media (like images) less convenient.

### 17. Details Info Pane (Deferred)
* **Debt**: The side info pane for displaying file details, large previews, and extended metadata is not rendered.
* **Tradeoff**: Users cannot inspect detailed file properties without viewing or opening the file.

---

## 🌐 Cloudflare Tunnel Platform Limits

### 18. 100 MB Upload Cap Through the Tunnel
* **Debt**: Every request to `dash.<domain>` goes through Cloudflare's proxy, which caps the request body at **100 MB on the Free and Pro plans** (200 MB on Business). `POST /api/files/upload` in `agent/routes/file.js` sends the whole file as one `multer` request with no chunking, so any upload over 100 MB from a remote network fails with `413 Request Entity Too Large`.
* **Tradeoff**: Large uploads only work on the direct LAN link (split-horizon mode), not remotely.
* **Possible fix**: Chunked/resumable uploads (each part under 100 MB, reassembled on the agent, e.g. the tus protocol), and auto-prefer the LAN link for big files.
* **Source**: https://developers.cloudflare.com/cache/concepts/default-cache-behavior/ (Upload limits)

### 19. Video Streaming Restriction on Cloudflare's CDN
* **Debt**: Cloudflare's Service-Specific Terms say that on Free, Pro, and Business plans, video and other large files must be served through paid services (Stream, Images, R2, Developer Platform). Proxying media (e.g. a Jellyfin container exposed via `jellyfin.<domain>`) through the tunnel risks Cloudflare limiting or disabling access for that hostname.
* **Tradeoff**: The auto-exposed container subdomains should not be pitched or used for media streaming over the tunnel. Streaming is fine on the LAN link.
* **Possible fix**: Warn in the Expose UI when exposing known media apps (Jellyfin, Plex, Immich), document LAN-only streaming, and later add an alternative remote-access option (e.g. Tailscale/WireGuard or a self-hosted tunnel like Pangolin) that isn't bound by the CDN terms.
* **Source**: https://www.cloudflare.com/service-specific-terms-application-services/ (Content Delivery Network, Free/Pro/Business)

### 20. Non-SSE Responses Are Buffered by the Tunnel
* **Debt**: `cloudflared` buffers proxied responses unless the origin sends `Content-Type: text/event-stream`. Any future live-output endpoint that isn't SSE (e.g. chunked plain-text log streams or large file downloads with progress) will appear frozen until the response completes.
* **Tradeoff**: Live features must use SSE or WebSockets (as metrics, compose deploy logs, and the terminal already do).
* **Source**: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/