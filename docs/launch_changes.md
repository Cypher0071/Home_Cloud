# Home Cloud — Open-Source Launch Roadmap & Pre-Release Checklist

This document catalogs all prerequisite architectural fixes, security hardening, feature completions, test suite stabilizations, and repository polishing required before making **Home Cloud** publicly accessible as an open-source project on GitHub.

---

## 📊 Release Readiness Scorecard

| Category | Status | Blocking Severity | Key Issues / Gaps |
| :--- | :---: | :---: | :--- |
| **P0: Public Release Blockers** | 🟡 6/7 Resolved | **CRITICAL** | Only 1 remaining: Doc username sanitization. *(License ✅, Rate Limiter ✅, Network Leak ✅, Dead Terminal ✅, ESLint ✅, Test Suites ✅)* |
| **P1: Security & Privilege Boundaries** | 🔴 0/5 Resolved | **HIGH** | Passkey (WebAuthn) login, Compose jail bypass, unrevocable 7-day JWTs, static `.env` passcode, 100MB tunnel upload cap. |
| **P2: Essential V4 & Tech Debt Milestones** | 🔴 0/6 Resolved | **MEDIUM** | Auto-update engine, cross-device settings persistence, desktop window state restoration, crash watchdog, file explorer keyboard nav. |
| **P3: Open-Source Polish & Governance** | 🔴 0/4 Resolved | **LOW** | 1-line curl installer, modernized `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, GitHub Actions CI. |

---

## 📋 Master Launch Checklist

### P0: Public Release Blockers (Hard Gates)
- [x] **1. Open-Source License Applied** (Apache License 2.0)
- [x] **2. Constant-Time Authentication & Login Rate Limiting**
- [x] **3. Patch Unauthenticated Host Information Disclosure**
- [x] **4. Remove Dead & Hardcoded Standalone Terminal Prototype**
- [x] **5. Fix 46 ESLint Violations in Frontend**
- [x] **6. Stabilize Automated Test Suites**
- [ ] **7. Sanitize Hardcoded Usernames & Example Domains in Docs**

### P1: Security & Privilege Boundary Hardening
- [ ] **1. Passkey / WebAuthn (FIDO2) Authentication Support**
- [ ] **2. Docker Compose Privilege Escalation Protection**
- [ ] **3. Server-Side Session Revocation & Token Epoch**
- [ ] **4. Dynamic Passcode Management UI & Endpoint**
- [ ] **5. Resumable Chunked File Uploads (100MB Cloudflare Tunnel Cap)**

### P2: Essential V4 & Tech Debt Feature Additions
- [ ] **1. One-Click Auto-Update Engine & Release Pipeline**
- [ ] **2. Cross-Device Settings & Personalization Persistence**
- [ ] **3. Desktop Window Layout State Persistence**
- [ ] **4. Container Crash Watchdog & Webhooks**
- [ ] **5. Automated Volume & Database Backups**
- [ ] **6. File Explorer Usability Upgrades**

### P3: Open-Source Distribution, Packaging & Developer Experience
- [ ] **1. 1-Command Automated Installer (`curl | bash`)**
- [ ] **2. Comprehensive `README.md` Revamp**
- [ ] **3. Open-Source Community Guidelines & Templates**
- [ ] **4. GitHub Actions CI/CD Pipeline**

---

## 🚨 Priority 0: Public Release Blockers (Hard Gates)

These items **must** be resolved before the repository visibility is changed to public. Neglecting any of these risks legal ambiguity, immediate credential vulnerability, or severe user onboarding failure.

- [x] **1. Open-Source License Applied (Resolved ✅)**
- [x] **2. Constant-Time Authentication & Login Rate Limiting (Resolved ✅)**
- [x] **3. Patch Unauthenticated Host Information Disclosure (Resolved ✅)**
- [x] **4. Remove Dead & Hardcoded Standalone Terminal Prototype (Resolved ✅)**
- [x] **5. Fix 46 ESLint Violations in Frontend (Resolved ✅)**
- [x] **6. Stabilize Automated Test Suites (Resolved ✅)**
- [ ] **7. Sanitize Hardcoded Usernames & Example Domains in Docs**

### 1. Open-Source License Applied (Resolved ✅)
* **Status**: [x] Resolved (Apache License, Version 2.0).
* **Verification**:
  * Verified [`LICENSE`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/LICENSE) exists in root with full Apache 2.0 terms and `Copyright 2026 Rudra Agrawal (Cypher0071)`.
  * Verified consistent SPDX identifier `"license": "Apache-2.0"` in root [`package.json`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/package.json#L13) and [`agent/package.json`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/agent/package.json#L12).
  * Tested and validated on both `Cypher-0071/siren` and `main` branches.

---

### 2. Constant-Time Authentication & Login Rate Limiting (Resolved ✅)
* **Status**: [x] Resolved.
* **Resolution**:
  * Implemented constant-time password comparison in [`agent/routes/auth.js`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/agent/routes/auth.js) using `crypto.timingSafeEqual` with SHA-256 pre-hashed buffers. Eliminates string comparison timing attacks and variable-length buffer exceptions.
  * Implemented an in-memory sliding window rate limiter and brute-force lockout:
    * 5 failed attempts within 60 seconds triggers a 5-minute temporary IP lockout.
    * Returns HTTP `429 Too Many Requests` with standard `Retry-After` header and remaining lockout seconds.
    * Extracts client IP accurately across reverse proxies and Cloudflare Tunnels (`cf-connecting-ip`, `x-forwarded-for`, `req.ip`).
    * Resets failed attempt counter immediately upon successful password authentication.
    * Unref'd background garbage collector evicts expired records every 5 minutes.
* **Verification**:
  * Validated with automated test suite in [`agent/tests/verify_auth.mjs`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/agent/tests/verify_auth.mjs). Verified exact match, character mismatch, length variance, non-string guards, multi-attempt lockout, retry headers, IP isolation, and post-login counter clearance.

---

### 3. Patch Unauthenticated Host Information Disclosure (Resolved ✅)
* **Status**: [x] Resolved.
* **Resolution**:
  * Moved `app.use("/api/network", require("./routes/network"))` after `app.use("/api", authMiddleware)` in [`agent/index.js`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/agent/index.js), ensuring `/api/network/info` and `/api/network/tunnel` strictly require an authenticated JWT cookie.
  * Implemented public, sanitized [`/api/ping`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/agent/index.js#L62-L73) endpoint with CORS (`Access-Control-Allow-Origin: *`) and W3C Private Network Access (`Access-Control-Allow-Private-Network: true`) returning strictly `{ status: "ok" }`.
  * Sanitized public `/api/health` to remove `tunnel` status leakage.
  * Enhanced [`dashboard/src/hooks/useNetworkDetector.ts`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/dashboard/src/hooks/useNetworkDetector.ts) to micro-ping `/api/ping`, support `localStorage` caching for returning users to enable pre-login LAN switching without credential loss, and export `resetNetworkDetectorCache()` to avoid in-memory singleton cache poisoning upon login.
  * Created automated test suite [`agent/tests/verify_network_security.mjs`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/agent/tests/verify_network_security.mjs) verifying unauthenticated blocking, PNA preflights, and authenticated access across 8 test cases.

---

### 4. Remove Dead & Hardcoded Standalone Terminal Prototype (Resolved ✅)
* **Status**: [x] Resolved.
* **Resolution**:
  * Deleted obsolete prototype file `dashboard/src/pages/terminal.tsx` which previously hardcoded `wss://home-cloud.live/terminal`.
  * Verified that routing in [`dashboard/src/App.tsx`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/dashboard/src/App.tsx) points `/terminal` directly to the production desktop workspace (`<ProtectedRoute><Desktop /></ProtectedRoute>`), which renders the full-featured [`TerminalApp`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/dashboard/src/components/apps/TerminalApp.tsx).
  * Verified frontend build via `pnpm --filter dashboard build` builds cleanly with 0 errors.

---

### 5. Fix 46 ESLint Violations in Frontend (Resolved ✅)
* **Status**: [x] Resolved.
* **Resolution**:
  * Refactored [`dashboard/src/pages/files.tsx`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/dashboard/src/pages/files.tsx):
    * Unexported helper `fetchDrives` to satisfy Vite fast-refresh rules.
    * Replaced all explicit `any` usages with typed interfaces (`BackendFileEntry`, `ApiResponseFiles`) and type-safe `catch (err: unknown)` handlers guarded with `axios.isAxiosError`.
    * Resolved React 19 `react-hooks/set-state-in-effect` violations by deferring synchronous effect updates out of the effect body via `setTimeout(..., 0)`.
    * Wrapped `handleCopy`, `handleCut`, and `handlePaste` in `useCallback` to satisfy `react-hooks/exhaustive-deps`.
  * Refactored [`dashboard/src/components/apps/DockerApp.tsx`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/dashboard/src/components/apps/DockerApp.tsx):
    * Added strict interfaces `DockerRawStats` and `DockerInspectData` to eliminate 25 `@typescript-eslint/no-explicit-any` errors in stats calculations, inspect data display, and error handlers.
    * Resolved 5 React 19 `react-hooks/set-state-in-effect` violations in highlight indexing, compose logs, polling, tab switching, and container logs streaming.
  * Refactored [`dashboard/src/components/apps/ContainerConsoleTab.tsx`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/dashboard/src/components/apps/ContainerConsoleTab.tsx) and [`dashboard/src/hooks/useNetworkDetector.ts`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/dashboard/src/hooks/useNetworkDetector.ts) to clean up unused catch bindings and synchronous effect state updates.
  * Verified: `pnpm --filter dashboard lint` and `pnpm --filter dashboard build` both pass cleanly with 0 errors and 0 warnings.

---

### 6. Stabilize Automated Test Suites (Resolved ✅)
* **Status**: [x] Resolved.
* **Resolution**:
  * Modernized test assertions in [`.agents/tests/terminal_e2e.test.mjs`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/.agents/tests/terminal_e2e.test.mjs) to match the production `TerminalApp.tsx` implementation:
    * `T1.28` & `T3.4`: Assert that toolbar Clear button sends `\x0c` (Ctrl+L) over socket for shell prompt redraw and retains terminal focus.
    * `T1.29`: Assert that Reconnect button updates status to connecting, invokes `connectSocket(term)`, and focuses terminal.
    * `T1.40`: Assert proper React 19 type safety with `ConnectionStatus` type alias.
    * `T2.24`: Assert that `socket.onerror` delegates retry/status to `socket.onclose`.
    * `T2.38`: Assert WebSocket endpoint targets `/terminal?sessionId=${encodeURIComponent(SESSION_ID)}`.
    * `T3.1` & `T3.5`: Assert font loading and ResizeObserver trigger `syncDimensions()` protected by try/catch for PTY fit and col/row synchronization.
  * Added unified `pnpm test` script in root [`package.json`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/package.json) running all 3 verification tiers (`test:dashboard`, `test:agent`, `test:e2e`).
  * Verified: All 93 terminal E2E tests pass (100%), and `pnpm test` exits cleanly with code 0 across all suites.

---

### 7. Sanitize Hardcoded Usernames & Example Domains in Docs
* **Status**: [ ] Pending.
* **Problem**: Documentation examples in [`docs/SYSTEM_DESIGN.md`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/SYSTEM_DESIGN.md) and [`docs/CONTEXT.md`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/CONTEXT.md) refer to `/home/rudra-unix/` and personal Cloudflare account UUIDs (`43a28f80-...`).
* **Required Action**:
  * Replace personal usernames with standard placeholders (`/home/<user>/` or `$HOME`).
  * Replace specific Cloudflare tunnel UUIDs with generic `<tunnel-id>` placeholders.

---

## 🔒 Priority 1: Security & Privilege Boundary Hardening

Production-grade self-hosted tools must withstand exposure to the open internet. The following security upgrades prevent host takeover and data leakage.

- [ ] **1. Passkey / WebAuthn (FIDO2) Authentication Support**
- [ ] **2. Docker Compose Privilege Escalation Protection**
- [ ] **3. Server-Side Session Revocation & Token Epoch**
- [ ] **4. Dynamic Passcode Management UI & Endpoint**
- [ ] **5. Resumable Chunked File Uploads (100MB Cloudflare Tunnel Cap)**

### 1. Passkey / WebAuthn (FIDO2) Authentication Support
* **Status**: [ ] Pending.
* **Source**: [`todo.md`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/todo.md#L4) & [`docs/TECHNICAL_DEBT.md:L101`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/TECHNICAL_DEBT.md#L101)
* **Goal**: Enable hardware keys (YubiKey), Touch ID, Face ID, and Windows Hello via WebAuthn.
* **Architecture**:
  * Implement `@simplewebauthn/server` in `agent/routes/auth.js` (`/api/auth/webauthn/register-options`, `/api/auth/webauthn/verify-registration`, `/api/auth/webauthn/login-options`, `/api/auth/webauthn/verify-authentication`).
  * Implement `@simplewebauthn/browser` in `dashboard/src/pages/login.tsx`.
  * Store credentials in host storage (`~/.config/home-cloud/webauthn.json`).
  * Maintain password login as a fallback.

---

### 2. Docker Compose Privilege Escalation Protection
* **Status**: [ ] Pending.
* **Source**: [`docs/TECHNICAL_DEBT.md:L61`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/TECHNICAL_DEBT.md#L61)
* **Goal**: Prevent bypass of the single-container filesystem jail via Compose deployments.
* **Architecture**:
  * While single-container creation in [`agent/routes/docker.js`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/agent/routes/docker.js) validates and jails paths within `BASE_DIR`, Compose stacks (`agent/routes/compose.js`) execute raw YAML that can bind-mount `/`, `/etc/shadow`, or `/var/run/docker.sock`.
  * Add a Compose parser/pre-flight validator that checks volume declarations.
  * If a Compose file attempts to bind mount directories outside `BASE_DIR`, require explicit user confirmation or flag high-privilege operations in the UI.

---

### 3. Server-Side Session Revocation & Token Epoch
* **Status**: [ ] Pending.
* **Source**: [`docs/TECHNICAL_DEBT.md:L68`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/TECHNICAL_DEBT.md#L68)
* **Goal**: Immediate invalidation of JWT cookies on logout or passcode change.
* **Architecture**:
  * Currently, JWTs are signed with a 7-day expiration and cannot be revoked without changing `JWT_SECRET` and restarting the process.
  * Introduce a lightweight `session_epoch` integer or token blacklist persisted in agent memory / local config file.
  * When the user clicks **Logout** or changes their passcode, increment the epoch so all previous tokens fail verification immediately.

---

### 4. Dynamic Passcode Management UI & Endpoint
* **Status**: [ ] Pending.
* **Source**: [`docs/TECHNICAL_DEBT.md:L74`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/TECHNICAL_DEBT.md#L74)
* **Goal**: Allow users to change their master passcode from the dashboard rather than requiring terminal SSH to edit `agent/.env`.
* **Architecture**:
  * Endpoint `POST /api/settings/password` requiring current password + new password.
  * Safe in-place update of `agent/.env` (retaining comments and formatting) with immediate session revocation.

---

### 5. Resumable Chunked File Uploads (100MB Cloudflare Tunnel Cap)
* **Status**: [ ] Pending.
* **Source**: [`docs/TECHNICAL_DEBT.md:L125`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/TECHNICAL_DEBT.md#L125)
* **Goal**: Enable uploading files >100MB over remote Cloudflare Tunnels without triggering HTTP `413 Request Entity Too Large`.
* **Architecture**:
  * Cloudflare Free and Pro tunnels strictly enforce a 100MB request body limit.
  * Implement client-side slicing into 50MB chunks in File Explorer (`dashboard/src/pages/files.tsx`).
  * Implement chunk assembly endpoints (`POST /api/files/upload/chunk` and `POST /api/files/upload/complete`) using streaming append or temporary chunk caches on the agent.

---

## ⚡ Priority 2: Essential V4 & Tech Debt Feature Additions

Features that must ship for the 1.0 release to deliver a complete, resilient self-hosted operating experience.

- [ ] **1. One-Click Auto-Update Engine & Release Pipeline**
- [ ] **2. Cross-Device Settings & Personalization Persistence**
- [ ] **3. Desktop Window Layout State Persistence**
- [ ] **4. Container Crash Watchdog & Webhooks**
- [ ] **5. Automated Volume & Database Backups**
- [ ] **6. File Explorer Usability Upgrades**

### 1. One-Click Auto-Update Engine & Release Pipeline
* **Status**: [ ] Pending.
* **Source**: [`docs/implementation/v4_roadmap.md:L50`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/implementation/v4_roadmap.md#L50)
* **Goal**: Enable non-technical users to update Home Cloud with a single click.
* **Architecture**:
  * Backend polling service checking GitHub Releases (`GET https://api.github.com/repos/Cypher0071/home_cloud/releases/latest`).
  * Update runner executing:
    1. Git fetch and checkout of verified release tag.
    2. `pnpm install --frozen-lockfile`.
    3. `pnpm --filter dashboard build`.
    4. Service reload via `systemctl restart home-cloud`.
  * Auto-rollback if post-update health check fails within 30 seconds.
  * Dashboard notification badge and release notes preview modal.

---

### 2. Cross-Device Settings & Personalization Persistence
* **Status**: [ ] Pending.
* **Source**: [`docs/TECHNICAL_DEBT.md:L142`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/TECHNICAL_DEBT.md#L142)
* **Goal**: Synchronize wallpaper, theme, fit mode, and dock preferences across all user devices.
* **Architecture**:
  * Endpoint `GET/PUT /api/settings/preferences` backed by host-side JSON storage (`~/.config/home-cloud/preferences.json`).
  * Asset endpoint `POST /api/settings/wallpaper` to store custom wallpaper images on the host server.
  * Update frontend hooks (`useWallpaper.ts`) to use optimistic UI updates with background server synchronization.

---

### 3. Desktop Window Layout State Persistence
* **Status**: [ ] Pending.
* **Source**: [`docs/implementation/v4_roadmap.md:L39`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/implementation/v4_roadmap.md#L39)
* **Goal**: Restore open window positions (`x`, `y`), dimensions (`width`, `height`), and z-indices across browser reloads.
* **Architecture**:
  * Save open window state to browser `localStorage` on window move/resize with debounce.
  * Restore window positions and active states upon dashboard re-entry.

---

### 4. Container Crash Watchdog & Webhooks
* **Status**: [ ] Pending.
* **Source**: [`docs/implementation/v4_roadmap.md:L9`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/implementation/v4_roadmap.md#L9)
* **Goal**: Automatic notifications if a Docker service crashes or enters a restart loop.
* **Architecture**:
  * Node.js agent monitors Docker events via `docker.getEvents()`.
  * Detect non-zero container exit codes, unhealthy states, and OOM kills.
  * Dispatch alert cards to Telegram and Discord webhooks with container name, status, and trailing log lines.

---

### 5. Automated Volume & Database Backups
* **Status**: [ ] Pending.
* **Source**: [`docs/implementation/v4_roadmap.md:L25`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/implementation/v4_roadmap.md#L25)
* **Goal**: Protect user container data with zero terminal complexity.
* **Architecture**:
  * Snapshot Docker named volumes and container bind mounts into `.tar.gz` archives.
  * Configurable backup schedules (daily/weekly) with automatic retention rotation.
  * Dashboard panel to list, trigger, and download backup archives.

---

### 6. File Explorer Usability Upgrades
* **Status**: [ ] Pending.
* **Source**: [`docs/TECHNICAL_DEBT.md:L109-L121`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/docs/TECHNICAL_DEBT.md#L109-L121)
* **Goal**: Bring File Explorer up to desktop parity.
* **Architecture**:
  * Keyboard navigation: Arrow keys to navigate items, `Enter` to open, `Delete` / `Backspace` to delete, `F2` to rename.
  * Layout Switcher: Toggle between Tabular List view and Grid/Tiles view (ideal for image directories).
  * Details Sidebar: Collapsible pane displaying file metadata, mime type, permissions, and image preview.

---

## 📦 Priority 3: Open-Source Distribution, Packaging & Developer Experience

Final polish required for public GitHub launch, contributor attraction, and friction-free user onboarding.

- [ ] **1. 1-Command Automated Installer (`curl | bash`)**
- [ ] **2. Comprehensive `README.md` Revamp**
- [ ] **3. Open-Source Community Guidelines & Templates**
- [ ] **4. GitHub Actions CI/CD Pipeline**

### 1. 1-Command Automated Installer (`curl | bash`)
* **Status**: [ ] Pending.
* **Goal**: Seamless onboarding for fresh Linux servers.
* **Architecture**:
  * Ensure [`setup.sh`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/setup.sh) can be invoked via:
    ```bash
    curl -fsSL https://raw.githubusercontent.com/Cypher0071/home_cloud/main/setup.sh | bash
    ```
  * Verify automated dependency resolution across Ubuntu, Debian 12, Fedora, and Arch Linux.
  * Provide non-interactive flags (e.g. `--domain example.com --tunnel my-tunnel --password mypass`).

---

### 2. Comprehensive `README.md` Revamp
* **Status**: [ ] Pending.
* **Target File**: [`README.md`](file:///home/rudra-unix/orca/workspaces/home_cloud/siren/README.md)
* **Required Content**:
  * Hero banner, badge bar (CI, License, Node 20+, Docker).
  * High-level architectural diagram (Browser -> Cloudflare Tunnel -> Agent -> Docker/Terminal/Files).
  * Quickstart guide (1-command setup vs manual Docker/Node run).
  * Security model & threat boundary explanation (single-user model, CGNAT traversal).
  * High-res screenshot showcase (Desktop environment, Docker store, Web terminal, File explorer).

---

### 3. Open-Source Community Guidelines & Templates
* **Status**: [ ] Pending.
* **Target Files**:
  * `CONTRIBUTING.md` — Guide for local setup, PR workflows, code style, and testing requirements.
  * `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1.
  * `SECURITY.md` — Responsible disclosure policy and reporting process.
  * `.github/ISSUE_TEMPLATE/` — Structured templates for Bug Reports and Feature Requests.
  * `.github/PULL_REQUEST_TEMPLATE.md` — Checklist for PR authors.

---

### 4. GitHub Actions CI/CD Pipeline
* **Status**: [ ] Pending.
* **Target File**: `.github/workflows/ci.yml`
* **Automated Checks**:
  * Monorepo linting (`pnpm run lint`).
  * TypeScript typecheck (`tsc -b`).
  * Production frontend build verification (`pnpm --filter dashboard build`).
  * Automated backend test suite execution (`pnpm test`).

---

## 🎯 Step-by-Step Execution Plan

```mermaid
flowchart TD
    subgraph P0["P0: Public Release Blockers"]
        L["[x] Apache 2.0 License (Resolved ✅)"]
        A["[x] Constant-Time Auth & Rate Limit (Resolved ✅)"]
        N["[x] Patch Network Info Leak (Resolved ✅)"]
        T["[x] Terminal Prototype Removed (Resolved ✅)"]
        E["[x] Fix 46 ESLint Errors (Resolved ✅)"]
        TS["[x] Stabilize Test Suites (Resolved ✅)"]
        S["[ ] Sanitize Usernames in Docs"]
    end

    subgraph P1["P1: Security Hardening"]
        W["[ ] WebAuthn Passkey Auth"]
        J["[ ] Compose Jail Policy"]
        R["[ ] Session Revocation"]
        P["[ ] Dynamic Passcode UI"]
        U["[ ] 100MB Chunked Uploads"]
    end

    subgraph P2["P2: Essential V4 & Tech Debt"]
        AU["[ ] Auto-Update Engine"]
        SP["[ ] Cross-Device Settings"]
        WP["[ ] Desktop Window Persistence"]
        CW["[ ] Crash Watchdog"]
        BK["[ ] Volume Backups"]
        FE["[ ] File Explorer Usability"]
    end

    subgraph P3["P3: Open-Source Launch"]
        RM["[ ] Revamped README"]
        ST["[ ] setup.sh 1-Liner Polish"]
        GH["[ ] Community Docs & CI Pipeline"]
        REL["[ ] v1.0.0 Release Tag"]
    end

    P0 --> P1
    P1 --> P2
    P2 --> P3
```

### Execution Phases:
1. **Phase 1 (P0)**: Fix immediate blockers ([x] License, [x] Rate Limiter, [x] Host Leak, [x] Terminal Prototype, [x] ESLint, [x] Test Suites, [ ] Doc Username Sanitization).
2. **Phase 2 (P1)**: Implement passkey authentication, server session revocation, and 100MB chunked uploads.
3. **Phase 3 (P2)**: Implement Auto-Update Engine (V4 Phase 4), cross-device settings persistence, and desktop window state persistence.
4. **Phase 4 (P3)**: Polish `README.md`, installer script, community templates, and publish v1.0.0 release.
