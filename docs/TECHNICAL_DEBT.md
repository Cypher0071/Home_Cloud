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

### 3. Frontend ESLint Static Analysis Violations (Resolved ✅)
* **Status**: Resolved.
* **Resolution**: Refactored `dashboard/src/pages/files.tsx` and `dashboard/src/components/apps/DockerApp.tsx` along with `ContainerConsoleTab.tsx` and `useNetworkDetector.ts`. Eliminated all synchronous `setState` in `useEffect` violations via deferred updates (`setTimeout(..., 0)`), resolved all missing `useCallback` dependencies in keyboard shortcut listeners, defined strict TypeScript interfaces (`BackendFileEntry`, `DockerRawStats`, `DockerInspectData`) replacing explicit `any` usages, and safely typed `catch` blocks with `unknown`. Verified `pnpm --filter dashboard lint` and `pnpm --filter dashboard build` exit with 0 errors.

### 4. Web Terminal E2E Test Suite Regressions (Resolved ✅)
* **Status**: Resolved.
* **Resolution**: Updated the 8 obsolete test assertions in `.agents/tests/terminal_e2e.test.mjs` (`T1.28`, `T1.29`, `T1.40`, `T2.24`, `T2.38`, `T3.1`, `T3.4`, `T3.5`) to align with `TerminalApp.tsx`'s production implementation (shell-driven Ctrl+L screen clear, `SESSION_ID` query param, `ConnectionStatus` type alias, delegation to `onclose`, and unified `syncDimensions()` callback). All 93 test cases now pass (100% pass rate).

### 5. Dead & Hardcoded Standalone Terminal Prototype (Resolved ✅)
* **Status**: Resolved.
* **Resolution**: Deleted obsolete prototype file `dashboard/src/pages/terminal.tsx` that contained a 34-line standalone component hardcoding `wss://home-cloud.live/terminal`. Verified that `/terminal` route in `dashboard/src/App.tsx` routes directly to the desktop shell containing the production `TerminalApp.tsx` component with JetBrains Mono font loading, reconnection banners, session persistence, and mobile virtual viewport support.

---

## 🔐 Security, Authentication & Privilege Boundary Gaps

### 6. Plaintext Password Comparison & Zero Login Rate Limiting (Resolved ✅)
* **Status**: Resolved.
* **Resolution**: Replaced direct string equality with constant-time SHA-256 buffer comparison (`crypto.timingSafeEqual`) in [`agent/routes/auth.js`](../agent/routes/auth.js) to eliminate timing attack vectors. Implemented an in-memory sliding-window rate limiter on `/api/auth/login` enforcing a 5-failed-attempts limit per minute with a 5-minute IP lockout, proxy-aware IP detection (`cf-connecting-ip`, `x-forwarded-for`), and standard HTTP `429 Too Many Requests` + `Retry-After` response headers. Verified with automated test suite in [`agent/tests/verify_auth.mjs`](../agent/tests/verify_auth.mjs).

### 7. Docker Compose Privilege Escalation vs Container Bind Mount Jail Mismatch
* **Debt**: Single container creation (`agent/routes/docker.js`) and Compose deployments (`agent/routes/compose.js`) have conflicting security boundaries.
* **Details**:
  * Single-container creation strictly jails host bind mounts within allowed storage scope using realpath canonicalization (`isInsideAllowedScope()` in `agent/paths.js`).
  * Compose project deployment accepts arbitrary `docker-compose.yml` payloads via `POST /api/docker/compose/deploy` and executes `docker compose up -d`. Compose files can declare bind mounts to `/`, `/etc`, or `/var/run/docker.sock`.
  * **Impact**: The filesystem jail on single containers is bypassed by any user deploying a Compose stack.

### 8. Single-Tenant Authentication & Unrevocable 7-Day JWTs (Partially Resolved ✅)
* **Status**: Partially Resolved.
* **Resolution**: Token revocation and server-side session invalidation have been fully implemented via persistent `sessionEpoch` tracking in `agent/services/preferences.js`, verified across HTTP middleware and WebSocket handlers (`POST /api/auth/logout-all`, verified in `agent/tests/verify_session_revocation.mjs`).
* **Remaining Debt**: Multi-user tenancy, audit logs per user, and role-based access control (RBAC) do not exist (single-admin security model).

### 9. Hardcoded Security Passcode Configuration (Resolved ✅)
* **Status**: Resolved in P1 Item 4.
* **Resolution**: Implemented dynamic passcode management endpoint `POST /api/settings/password` with constant-time verification, atomic `0o600` `.env` updates, automatic cross-device session revocation via epoch increment, and a dedicated UI management card in SettingsApp. Verified in `agent/tests/verify_password_settings.mjs`.

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

### 12. Settings App Scope Limitation (Partially Resolved ✅)
* **Status**: Partially Resolved.
* **Resolution**: `SettingsApp.tsx` has been expanded beyond browser-local wallpapers to include system-level controls: Storage Scope & System Access (`allowSystemRoot`), Session Revocation / Token Epoch (`/api/auth/logout-all`), and Master Passcode Management (`POST /api/settings/password`).
* **Remaining Debt**: Server power management (reboot/shutdown), port management, and advanced host networking diagnostics remain deferred.

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

### 18. 100 MB Upload Cap Through the Tunnel & Resumable Chunked Uploads (Deferred to Final Phase)
* **Debt**: Every request to `dash.<domain>` goes through Cloudflare's proxy, which caps the request body at **100 MB on the Free and Pro plans** (200 MB on Business). `POST /api/files/upload` in `agent/routes/file.js` sends the whole file as a single unchunked `multer` request with no chunking, so any upload over 100 MB from a remote network fails with `413 Request Entity Too Large`.
* **Resolution Priority**: **Deferred to the very last milestone**. Direct LAN access (split-horizon DNS / local micro-ping) already bypasses the Cloudflare proxy entirely, enabling unrestricted gigabyte-scale transfers on local networks. Remote chunked uploading (`tus` protocol or 50MB client-side chunk slicing + backend assembly) will be tackled as the final feature addition once core stability and search features are complete.
* **Tradeoff**: Remote uploads via tunnel remain limited to <= 100 MB until chunking is implemented. Local LAN access is unaffected.
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

### 21. Cross-Device Settings Persistence & Server-Side Preferences Sync (Resolved ✅)
* **Status**: Resolved in P2 Item 2.
* **Resolution**: Implemented persistent server-side user preferences and custom wallpaper asset storage in the Node.js agent:
  - Extended `agent/services/preferences.js` with `personalization: { presetId, fit, hasCustomWallpaper, customWallpaperExt }` stored atomically on disk in `~/.config/home-cloud/preferences.json`.
  - Added REST endpoints `GET/PUT /api/settings/preferences` and `POST/GET/DELETE /api/settings/wallpaper` with 15MB file size limit, strict MIME type validation (`image/jpeg`, `image/png`, `image/webp`, `image/avif`), automatic old file cleanup, and static HTTP caching (`Cache-Control: public, max-age=86400`).
  - Upgraded frontend `dashboard/src/hooks/useWallpaper.ts` to provide 0ms instant initial paint via optimistic local cache, background synchronization with server on mount, and real-time cross-tab / cross-view window event bus (`homecloud:wallpaper-change`).
  - Verified with comprehensive test suite in `agent/tests/verify_personalization_settings.mjs` (all suites passing).

### 22. File Explorer Search Pipeline & UI Deficiencies
* **Debt**: The current File Explorer search implementation has significant backend fragility and frontend UX gaps:
  1. **Host CLI Dependency & Missing Fallback**: `GET /api/files/search` in `agent/routes/file.js` directly spawns `fdfind` piped to `fzf`. If either CLI binary is absent (common on standard distributions where the binary is `fd` instead of `fdfind`, or minimal server/Docker installations without `fzf`), file search operations fail with 500 errors.
  2. **Storage Scope Compatibility Gap**: The search endpoint currently verifies paths using legacy `isInsideBase(currentDir)` instead of the modern `isInsideAllowedScope(currentDir)`. Consequently, searching within mounted storage pools (`/mnt/*`, `/media/*`, `/srv/*`) or in Full System Root Access mode (`/`) is rejected with HTTP `403 Access denied`.
  3. **Frontend Search UX & Missing Directory Context**:
     - In `dashboard/src/pages/files.tsx`, search results replace the current directory table but do not display the parent directory or relative path for matching files, making it impossible for users to discern where matching files reside in nested folders.
     - Lack of search scope indicators (e.g. indicating whether search is scoped strictly to the current folder or recurses through the entire storage pool/system).
     - No keyboard productivity shortcuts (e.g. `Ctrl+F` or `/` to focus search, `Esc` to clear search).
     - Missing match count badges, substring highlighting, and debounced loading skeletons.
* **Tradeoff**: File searching is brittle across different Linux environments, cannot search multi-drive storage pools or system root paths, and provides poor feedback for deep folder hierarchies.
* **Target Fix**:
  - Replace fragile CLI pipe with a robust Node.js recursive filesystem search stream (with optional detected `fd`/`find` acceleration).
  - Modernize authorization to use `isInsideAllowedScope()`.
  - Overhaul File Explorer UI: add parent directory path chips to search result items, search scope selector, match count, keyboard shortcuts, and smooth loading transitions.
