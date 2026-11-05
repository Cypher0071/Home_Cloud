# Home Cloud security audit — run-5 (clean pass)

## 1. Run scope
- **Profile:** standard, full repository scope (`.`), no budget cap. 9 agent invocations, all Antigravity gemini-3.8-flash-high in auto mode:
  - 6 hunters: f1-f5 (wave 1) and g1 (wave 2, fresh owner of 3 units reopened by cr1)
  - 2 post-wave critics (cr1, cr2) and 1 distinct final-clean critic (cr3)
  - No Phase 3 or Phase 5 verifiers were needed: no candidate survived hunting.
  - Lead: Claude Opus 5.5 (ledger, sandbox, artifact promotion, validators, reports, and an independent re-run of the decisive hunter harnesses).
- **Source:** working tree of branch `t3/gather-thread-context` at base commit 0b56de6, plus uncommitted fix rounds 1, 2 and 3.
- **Execution:** sandboxed source-and-local-only (bwrap: no network, empty env, read-only target, scratch-only writes, prlimit, timeout). No deployed host, registry, Docker daemon or Cloudflare API was contacted.
- **Evidence rule:** re-running the repository's own regression tests did not count as an independent local check. Every hunter wrote its own harness wherever execution was feasible; units left source-only were reopened (cr1) and re-closed with local checks (g1).
- **Prior run:** run-4 had 1 confirmed record and 1 needs_validation record. Both were changed-source revalidation units; both fixes hold.
- **Deferred or out of scope:** none.

## 2. Security posture
No confirmed findings and no needs-validation leads.

All records from runs 2, 3 and 4 are fixed and were re-checked with sandboxed local evidence in this run:
- Session revocation reaches every live channel: terminal and container-exec WebSockets, all long-lived HTTP streams (metrics, container stats/logs, image pull, compose logs and deploy progress, update progress), and detached terminal sessions. A session from an older epoch cannot reattach a terminal. A running compose deploy finishes even when its viewer is revoked.
- Tunnel ingress rules are removed on container delete, stack delete, and compose redeploy whether the deploy succeeds, fails or is killed by a signal. Protected system rules are never removed.
- Image pull is POST-only with strict image-reference validation; cross-site and foreign-origin requests are rejected.
- Login rate limiting holds against `CF-Connecting-IP` rotation via a window-bounded aggregate peer budget.
- Password rotation revokes sessions before rewriting the credential (fail-closed).
- The LAN identity proof is refused to loopback and tunnel-forwarded clients.
- The installer takes the password from a file or stdin, publishes SSH ingress only with an installed key, installs a loopback key-only sshd drop-in and rolls it back if `sshd -t` fails.
- The updater installs only with `--frozen-lockfile` and rolls back on failure.

## 3. Confirmed findings
None.

## 4. Needs validation
None.

## 5. Hardening notes (non-findings)
- agent/index.js:23 accepts an upgrade for every path and only terminates unwanted paths in the connection event handler. Enforcing a path allowlist in the HTTP upgrade event handler would avoid full WebSocket handshake allocation for invalid paths.
- agent/middleware/origin.js:14-28 trusts x-forwarded-proto and prefers x-forwarded-host over Host for the Origin comparison. While browser preflight and host-only cookies prevent exploitation, a production reverse proxy deployment should ignore forwarded headers unless arriving from a configured trusted proxy CIDR.
- /api/health returns { status: 'ok', shuttingDown: isShuttingDown } and server responses carry X-Powered-By: Express. Disabling x-powered-by via app.disable('x-powered-by') reduces framework fingerprinting.
- Express default error responses include stack traces when NODE_ENV is not production. Ensuring a centralized JSON error handling middleware for /api prevents any accidental stack trace leakage on unhandled exceptions in non-production environments.
- Consider explicitly specifying algorithms: ["HS256"] in jwt.verify options across agent/middleware/auth.js and agent/sockets/* as defense-in-depth against speculative algorithm-confusion regressions.
- Consider monitoring terminal BUFFER_BYTES (5 MiB per active session) if running on heavily memory-constrained single-board computers.
- In agent/routes/file.js, fuzzy file search spawns fd and fzf child processes; both processes have active process cleanup handlers on error and close, but a hard wall-clock timeout would provide additional defense-in-depth against large directory scans.
- In agent/services/ingress.js, validateSubdomain normalizes uppercase input to lowercase per DNS standards; consider adding a lint rule to discourage mixed-case subdomain strings in configuration files.
- Consider adding explicit visual confirmation or a toast notification in the dashboard UI before initiating an automated top-level protocol downgrade redirect from HTTPS to HTTP on the local network.
- Consider implementing a strict Content Security Policy (CSP) header (e.g., restricting script-src, object-src, and base-uri) across both the dashboard and landing origins to provide defense-in-depth against client-side script execution.
- Consider including a timestamp or monotonic window in the LAN identity proof HMAC payload in addition to the random nonce to enforce a finite validity lifetime for issued challenge proofs.
- Consider adding a systemd service sandboxing configuration (e.g. ProtectSystem=strict, ProtectHome=read-only with explicit ReadWritePaths for agent/ and storage mount points) to home-cloud.service.template as defense-in-depth.
- Consider configuring a repository-wide .npmrc with "engine-strict=true" and "ignore-scripts=true" to enforce pnpm allowBuilds restrictions globally across any development or automated install context.
- Consider enhancing setup.sh to automatically provision a Cloudflare Access Service Token or policy definition for ssh.<domain> via Cloudflare API if tunnel management tokens are provided during setup.
- Consider adding Content-Security-Policy headers on file download responses if files with untrusted user-controlled HTML/SVG extensions can be served directly inline.
- Consider explicitly specifying algorithms: ["HS256"] in jwt.verify options across agent/middleware/auth.js and agent/sockets/* as defense-in-depth against speculative algorithm-confusion regressions.

## 6. Coverage
- **Ledger:** 35 units: 35 covered, 0 candidate, 0 blocked, 0 deferred, 0 out of scope.
- **Critic history:**
  - cr1 reopened 3 units (Docker streams, metrics SSE, network telemetry) that f2 had closed source-only; fresh owner g1 re-closed them with its own harnesses (revocation mid-stream and client disconnect). cr1 marked both run-4 records resolved.
  - cr2 found nothing.
  - The distinct final-clean critic cr3 found nothing.
- **Lead verification:** the lead re-ran 9 decisive hunter harnesses (f2, f3, g1, plus f1 earlier) inside the sandbox; all exited 0 with the claimed results. Hunter f1's output matched run-4 byte-for-byte; the lead confirmed this is deterministic output from f1's own harness, not copied evidence.
- **Excluded companions:** AI-AND-LLM, MEMORY-SAFETY-AND-BINARY, PROTOCOLS-RPC-AND-MESSAGING and DATA-ISOLATION-AND-LIFECYCLE, for the reasons in `architecture.md` section 8.
- **Limits:** a clean pass is not proof of absence. Live Docker, browser and Cloudflare behaviour were not observed; the sandbox mocks Docker and cloudflared.
