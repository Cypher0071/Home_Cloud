# Home Cloud: Needs-Validation Leads, run-2

These leads are grounded in the source, but the fact that decides each one lies outside the repository or the local sandbox. They are **not** confirmed vulnerabilities and carry no severity. Each was re-checked in run-2 by a Phase-3 verifier and a separate Phase-5 verifier. Resolve them with the bounded local step or the owner-side check below. Do not send probe traffic to the live deployment.

## Dashboard redirects from HTTPS to http://<stored LAN IP> after any 200 from an unauthenticated ping, with no check of server identity

- **Fingerprint:** `home-cloud/dashboard/lan-redirect-unauthenticated-ping`

When the dashboard is loaded from a non-local hostname (for example https://dash.<domain>, including the pre-auth /login page), useNetworkDetector reads the LAN IP and port. These come from the authenticated /api/network/info call or, before login, from localStorage. It then fetches http://<ip>:<port>/api/ping (falling back to /api/health) and, if either returns any 2xx response, sets window.location.href to http://<ip>:<port><path><search>. Nothing checks that the responder is the Home Cloud agent: no nonce, no signed token, no response-body check. Suppose the owner has previously stored a private LAN IP and later opens the HTTPS dashboard on another network where an attacker holds that same private address (for example 192.168.1.50 on public Wi-Fi) and answers 200 with Access-Control-Allow-Origin: *. The owner is then sent from the TLS origin to an attacker-served plaintext page at the same path, such as /login, which enables a credential-phishing page under a familiar URL shape. Even on the real LAN, the switch moves the session cookie and password entry from HTTPS to plaintext HTTP. In a bounded sandbox (Node fetch, no browser), the unmodified detection logic was reproduced: an impostor that returns 200 'not-home-cloud' caused href to be set to http://<impostor>/login. Whether a real browser allows the HTTPS page to make this http://<private-ip> fetch decides whether the issue is reachable, and that could not be observed.

**Claimed root cause:** runDetectionOnce (dashboard/src/hooks/useNetworkDetector.ts:130-165) treats any ok response from http://<localIp>:<localPort>/api/ping or /api/health as proof that the client is on the owner's LAN and talking to the owner's agent, then navigates the top-level window to that plaintext origin. The responder's identity is never bound to the HTTPS-authenticated server (for example a server-issued nonce or HMAC echoed by the LAN agent), and there is no user confirmation before downgrading from HTTPS to HTTP.

### Trace
- `entrypoint` `dashboard/src/pages/login.tsx:12` (Login): The pre-auth login page mounts useNetworkDetector on any hostname, including https://dash.<domain>.
- `propagation` `dashboard/src/hooks/useNetworkDetector.ts:64` (runDetectionOnce): When /api/network/info fails (pre-auth), localIp/localPort are taken from localStorage keys home-cloud:server_local_ip/port that an earlier authenticated session persisted (lines 76-79).
- `propagation` `dashboard/src/hooks/useNetworkDetector.ts:139` (runDetectionOnce): Cross-origin fetch to http://<localIp>:<localPort>/api/ping with mode cors and targetAddressSpace 'private'; the fallback to /api/health at line 147 has no targetAddressSpace.
- `sink` `dashboard/src/hooks/useNetworkDetector.ts:164` (runDetectionOnce): On any pingRes.ok (line 155), the top-level window navigates to http://<localIp>:<localPort><pathname><search> with no identity check on the responder.

### Evidence
- `dashboard/src/hooks/useNetworkDetector.ts:155`: The only acceptance condition is pingRes.ok; the response body and headers are never inspected.
- `agent/index.js:70`: The real /api/ping is unauthenticated, has ACAO *, and returns only {status:'ok'}, so it offers no identity proof the client could check.
- `docs/learn/split_horizon_dns_and_local_lan_switching.md:266`: The project's own doc says browsers' mixed-content rules may block an HTTPS page from fetching http://192.168.x; the detector then falls back to tunnel mode (line 269). This browser behaviour is the decisive unobserved fact.
- `docs/SYSTEM_DESIGN.md:573`: Documents the intended behaviour: when the ping succeeds, the browser is redirected to the LAN origin before sign-in.
- `agents/gv3/artifacts/result_1.txt:4`: Independent sandbox reproduction: an impostor returning 200 caused window.location.href to be set to http://127.0.0.1:<impostor>/login (Node fetch, no browser policy enforced).

### Blockers
- Whether current Chromium, Firefox and Safari let an https://dash.<domain> page complete a cors fetch to http://<private-ip>:<port>/api/ping. Plain mixed content blocks it; Chromium's Local Network Access exemption needs a supported targetAddressSpace value (the code passes 'private', not 'local') plus a user permission grant that persists per origin. No browser is available in the sandbox, and the source cannot settle this. If every browser blocks the fetch, the redirect never fires and there is no impact.
- Whether the owner's browser already holds a persisted Local Network Access grant for dash.<domain>. That grant is what would let the fetch succeed silently on a hostile network sharing the same private IP.

### Resolution plan
- **Local (bounded):** In a disposable browser profile on an isolated test network (no real deployment): serve the built dashboard over HTTPS at a test hostname with a locally trusted test CA. Seed localStorage home-cloud:server_local_ip=<test-host private IP> and server_local_port=3000. Run an impostor on that IP:3000 that returns 200 with Access-Control-Allow-Origin: * (and Access-Control-Allow-Private-Network: true) and a page body 'IMPOSTOR'. Open https://<test-host>/login in current Chrome, Firefox and Safari. Record whether the ping fetch is blocked (DevTools console mixed-content/LNA message) or succeeds, whether a Local Network Access prompt appears, and whether the tab ends at http://<ip>:3000/login showing IMPOSTOR. Repeat in Chrome after granting the LNA prompt once, with the impostor swapped in afterwards.
- **Owner-observed:** Owner check, no audit traffic: on the owner's normal browser, open https://dash.<domain>/login from the home LAN and see whether it auto-switches to http://<lan-ip>:3000 and whether a local-network permission prompt was ever granted for dash.<domain> (Chrome: Site settings > Local network access).

---

## Dashboard sends no X-Frame-Options or CSP frame-ancestors, so same-site sibling app subdomains can frame an authenticated dash.<domain> for clickjacking

- **Fingerprint:** `home-cloud/dashboard/missing-frame-ancestors-sibling-clickjacking`

The agent serves the SPA (static files and the /{*path} fallback) and all API responses with no X-Frame-Options or Content-Security-Policy frame-ancestors header. No helmet or equivalent is present in agent/. Ingress autowiring publishes the owner's containers at <sub>.<domain>, which are same-site with dash.<domain>. The session cookie is SameSite=Lax and host-only, and Lax cookies are sent on same-site iframe loads. So a page on any sibling subdomain, viewed as a top-level document, can frame https://dash.<domain>/settings (or /docker, /terminal) as the authenticated owner. Deep links open the matching window at fixed coordinates. Requests made by the framed dashboard come from its own origin, so originGuard accepts them. Single-click controls, such as the Full System Root Access switch that issues PUT /api/settings/storage, could then be clickjacked. Purely cross-site framers (an attacker's own domain) get no cookie because of SameSite=Lax, so the attack requires a lower-trust party that can serve HTML on a sibling subdomain.

**Claimed root cause:** agent/index.js sets no anti-framing response header (X-Frame-Options: DENY or CSP frame-ancestors 'none'/'self') on dashboard HTML. Framing protection for the root-equivalent control panel therefore depends only on SameSite=Lax, which does not separate dash.<domain> from same-site sibling app subdomains created by ingress autowiring.

### Trace
- `entrypoint` `dashboard/src/pages/desktop.tsx:28` (Desktop): Top-level dashboard page mounts inside an iframe on a same-site sibling subdomain.
- `propagation` `dashboard/src/pages/desktop.tsx:56` (getInitialDeepLink): The deep-link path opens the matching window (terminal/metrics/files/docker/settings) at fixed coordinates (settings at x=140,y=40, lines 129-137), so click targets are predictable inside a frame.
- `sink` `dashboard/src/components/apps/SettingsApp.tsx:849` (Storage scope switch): A single click calls handleToggleSystemRoot, which sends PUT /api/settings/storage {allowSystemRoot:true} (lines 230-238) from the dashboard origin with the ambient cookie.

### Evidence
- `agent/routes/auth.js:14`: The cookie is sameSite 'lax' and host-only (no domain attribute). Lax cookies are sent on same-site subresource/iframe requests from sibling <sub>.<domain> pages.
- `agent/index.js:64`: originGuard only compares Origin with Host. Requests from inside the framed dashboard carry the dashboard's own Origin and pass.
- `agents/gv3/artifacts/result_2.txt:1`: Verifier local run: GET /, /settings, /docker, /terminal, /login return 200 HTML with x-frame-options and content-security-policy both absent; PUT /api/settings/storage succeeds with cookie and matching dashboard origin.

### Blockers
- Whether any lower-trust party can serve attacker-controlled HTML/script as a top-level page on a sibling <sub>.<domain>, for example a compromised or untrusted container app, or an app that hosts user-uploaded HTML. This depends on which apps the owner exposes, which is deployment state outside source.
- Whether the Cloudflare zone adds X-Frame-Options/CSP frame-ancestors at the edge (Transform Rules / response header modification). That is not source-visible.
- Actual browser rendering and SameSite cookie attachment for a same-site iframe of dash.<domain> (including Firefox/Safari partitioning behaviour) could not be observed: no browser is available in the sandbox.

### Resolution plan
- **Local (bounded):** On an isolated test machine, run the agent with dummy PASSWORD/JWT secret behind a local HTTPS reverse proxy for dash.test.example and app.test.example (locally trusted test CA, hosts-file entries). Log in at dash.test.example in a disposable browser profile. Open https://app.test.example/frame.html containing <iframe src='https://dash.test.example/settings' style='opacity:0.5'>. Confirm the authenticated Settings window renders inside the frame, then click the storage switch and check GET /api/settings/storage for allowSystemRoot=true. Reset it afterwards.
- **Owner-observed:** Owner check, no audit traffic: run `curl -sI https://dash.<domain>/settings` and check for x-frame-options or content-security-policy frame-ancestors added by Cloudflare. List which exposed <sub>.<domain> apps serve content that someone other than the owner can author or upload.

---

## Public tunnel ingress rule can outlive the deleted container and route to whatever later binds its host port

- **Fingerprint:** `home-cloud/ingress/stale-rule-after-container-delete`

Expose creates a cloudflared ingress rule <sub>.<domain> -> http://localhost:<hostPort>. Deleting a single container only removes rules for ports read from info.NetworkSettings.Ports of a container that must already be stopped (remove() without force fails with 409 for running containers), and deleting a compose project never touches ingress at all. A leftover rule keeps publishing <sub>.<domain> to the internet, and the dashboard only shows rules matched to a current container's PublicPort, so the owner has no visible indication or removal path. Any later service on that host port (another owner service assumed private, or a port bound by a lower-trust local process or container) becomes publicly reachable under the owner's domain without the owner choosing to expose it.

**Claimed root cause:** Ingress cleanup is keyed on the runtime port map of a stopped container (agent/routes/docker.js:92-105) instead of on the recorded rule/container identity, and the compose DELETE route (agent/routes/compose.js:380-408) performs no ingress cleanup; rules are stored only as hostname -> localhost:port with no ownership link (agent/services/ingress.js:312-334).

### Trace
- `entrypoint` `agent/routes/docker.js:88` (DELETE /api/docker/containers/:id/delete): Owner deletes a (necessarily stopped) container.
- `propagation` `agent/routes/docker.js:95` (DELETE /containers/:id/delete): Cleanup iterates info.NetworkSettings.Ports from inspect; for exited containers this runtime map is expected to be empty, so no host port is found.
- `propagation` `agent/routes/compose.js:391` (DELETE /api/docker/compose/:name): compose down -v and folder removal with no call to removeIngressByPort/unexposeContainer (source-certain stale rule for exposed compose services).
- `sink` `agent/services/ingress.js:324` (_removeIngressByPortInternal): The only port-based cleanup, never reached when the port list is empty; the rule http://localhost:<port> stays in the tunnel config.

### Evidence
- `agent/routes/docker.js:93`: container.remove() without force; a running container yields 409 'Stop the container before deleting it' (:113-116), so cleanup always inspects a stopped container.
- `agent/routes/docker.js:449`: Expose itself derives hostPort from the same runtime NetworkSettings.Ports map, showing the rule is bound only to a port number.
- `agent/routes/docker.js:28`: Container list only surfaces a rule when a current container's PublicPort matches it, hiding orphaned rules.
- `agent/routes/docker.js:478`: Unexpose requires the owner to know the subdomain; no route lists orphaned ingress rules.
- `agents/gv3/artifacts/result_3.txt:2`: Verifier local simulation: exited container with null/empty Ports map and compose DELETE both leave ingress rules intact in cloudflared config.

### Blockers
- Whether the Docker Engine version in use returns an empty NetworkSettings.Ports map for an exited container (decisive for the single-container delete path); no Docker daemon is available in the sandbox.
- Whether, in the owner's deployment, any service or lower-trust process later binds a host port that still has an orphaned public rule (decisive for real exposure impact).

### Resolution plan
- **Local (bounded):** On a disposable Docker host with a dummy CF_DOMAIN and a scratch CF_CONFIG: run `docker run -d --name v3probe -p 18080:80 nginx`, call POST /api/docker/containers/v3probe/expose {"subdomain":"v3probe"} with cloudflared reload stubbed, `docker stop v3probe`, record `docker inspect v3probe --format '{{json .NetworkSettings.Ports}}'`, call DELETE /api/docker/containers/v3probe/delete, then check whether the scratch config still contains service http://localhost:18080. Repeat with a minimal compose project exposed the same way and DELETE /api/docker/compose/<name>.
- **Owner-observed:** Owner inspects ~/.cloudflared config.yml (without sharing credentials) and lists ingress hostnames whose http://localhost:<port> has no corresponding running container in `docker ps --format '{{.Ports}}'`; report count and ports only.

---

## Installer publishes host sshd at ssh.<domain> through Cloudflare Tunnel without creating any Cloudflare Access policy, and every tunnel client reaches sshd as 127.0.0.1

- **Fingerprint:** `home-cloud/setup/ssh-tunnel-ingress-without-access`

With tunnel setup enabled, setup.sh writes the cloudflared ingress rule ssh.<domain> -> ssh://localhost:22 and routes public DNS for ssh.<domain>. It never creates a Cloudflare Access application or policy, and it does not harden sshd_config. setup_openssh only installs/enables the distro sshd with default settings, which on Debian/Ubuntu allow password authentication. Unless the owner separately adds an Access policy, anyone on the internet running `cloudflared access ssh --hostname ssh.<domain>` reaches the host's sshd. That sshd sees every tunnel client as a loopback peer, so source-address protections no longer apply per client: fail2ban/sshguard bans of 127.0.0.1, which are usually in ignoreip, Match Address rules, and OpenSSH PerSourcePenalties/MaxStartups attribution either never trigger or penalise all tunnel users, including the owner, together. The UI and README describe this as secure 'Zero Trust' access, but nothing in source enforces an identity check before sshd.

**Claimed root cause:** setup.sh (2063-2072, 2102-2109) exposes ssh://localhost:22 on a public hostname via the tunnel. It never adds a Cloudflare Access application/policy, or service-token/identity requirement, in front of it, and never restricts sshd authentication. The tunnel makes all remote clients indistinguishable loopback peers to sshd.

### Trace
- `entrypoint` `setup.sh:2070` (Cloudflare tunnel config generation): Ingress rule hostname ssh.$CF_DOMAIN_VAL is written to ~/.cloudflared/config.yml.
- `propagation` `setup.sh:2103` (Cloudflare tunnel DNS routing): cloudflared tunnel route dns --overwrite-dns publishes ssh.<domain> as a public CNAME to the tunnel; no Access application/policy step follows.
- `sink` `setup.sh:2071` (Cloudflare tunnel config generation): Service ssh://localhost:22: cloudflared on the host connects to sshd from loopback for every remote tunnel client.

### Evidence
- `setup.sh:1048`: setup_openssh enables/installs the distro sshd and never touches sshd_config (no PasswordAuthentication/PermitRootLogin hardening) in lines 1033-1071.
- `setup.sh:2421`: The post-install instructions give only 'ProxyCommand cloudflared access ssh --hostname %h' and do not tell the owner to create an Access policy.
- `dashboard/src/components/apps/SettingsApp.tsx:1072`: The UI describes the path as connecting 'securely ... from anywhere in the world', implying protection that source does not configure.
- `agent/services/ingress.js:221`: ssh.<domain> is filtered out of the dashboard's exposed-app list, so the owner never sees this public ingress listed as exposed.

### Blockers
- Whether the owner's Cloudflare account has a Cloudflare Access application/policy covering ssh.<domain>. That is account-side configuration, not source-visible, and it decides whether unauthenticated internet clients reach sshd at all.
- The effective sshd authentication configuration on the deployed host: whether PasswordAuthentication or KbdInteractiveAuthentication is enabled, and the OpenSSH version/PerSourcePenalties settings. This decides whether reachability lets remote password guessing happen without per-source throttling.

### Resolution plan
- **Local (bounded):** In a disposable VM or container with no external network: install openssh-server with distro defaults, run `sshd -T | rg -i 'passwordauthentication|kbdinteractive|persourcepenalt|maxstartups'`, and make several failed logins from 127.0.0.1 to see how fail2ban (default ignoreip) and PerSourcePenalties attribute loopback-sourced failures. Do not use a real tunnel.
- **Owner-observed:** Owner check, no audit traffic: in Cloudflare Zero Trust dashboard > Access > Applications, confirm whether a self-hosted application covers ssh.<domain> with an identity policy. On the host, run `sudo sshd -T | rg -i 'passwordauthentication|kbdinteractiveauthentication|permitrootlogin'` and review `journalctl -u ssh` for authentication attempts from 127.0.0.1 that the owner did not make.

---

## Auto-updater falls back to non-frozen pnpm install on any frozen-lockfile failure

- **Fingerprint:** `home-cloud/updater/unfrozen-install-fallback`

applyUpdate checks out a release tag and runs `pnpm install --frozen-lockfile`; any failure (lockfile out of sync with manifests, lockfile/settings mismatch, transient error) is swallowed and a plain `pnpm install` runs, which may re-resolve semver ranges from the registry and rewrite the lockfile, after which the dashboard is built and the service restarted as the service user (docker group, root-equivalent). This removes the lockfile pin exactly when it diverges, letting a third-party npm publisher's newly published in-range version execute on the host. Whether that state is reachable depends on release-process facts outside the repository.

**Claimed root cause:** agent/services/updateManager.js:443-458 catches every frozen-install failure and retries without --frozen-lockfile instead of aborting and rolling back, so the reproducibility/integrity guarantee of the lockfile is dropped silently.

### Trace
- `entrypoint` `agent/services/updateManager.js:434` (applyUpdate): git checkout --detach <release tag> fetched from origin (owner-triggered update).
- `propagation` `agent/services/updateManager.js:444` (applyUpdate stage 4): pnpm install --frozen-lockfile; any error enters the catch.
- `propagation` `agent/services/updateManager.js:454` (applyUpdate stage 4 catch): Unconditional retry with plain pnpm install (registry re-resolution allowed).
- `sink` `agent/services/updateManager.js:486` (applyUpdate stage 6): Build then detached service restart runs the newly installed dependency code on the host.

### Evidence
- `agent/services/updateManager.js:448`: catch (_) discards the frozen-install error reason; no rollback to rollbackCommit on lockfile mismatch.
- `.github/workflows/ci.yml:4`: CI (which enforces --frozen-lockfile at :45/:72/:99) runs only on pushes to main/t3 branches and PRs, not on tag pushes, so a tag on an unchecked commit is not prevented by source-visible controls.
- `pnpm-lock.yaml:1`: lockfileVersion 9.0 pinned to pnpm 12.15.0 (packageManagerDependencies), so a host pnpm mismatch could also make the frozen install fail.
- `agents/hc/artifacts/result_2.txt:9`: Mocked runCommand run: frozen install failure followed by plain pnpm install, build and successful restart.
- `agents/gv1/artifacts/result_3.txt:9`: Verifier sandbox reproduction with mocked runCommand: pnpm install --frozen-lockfile failure is caught and falls back to plain pnpm install, building dashboard and restarting (lines 8-10, 16).

### Blockers
- Whether release tags on Cypher0071/Home_Cloud can point at commits whose pnpm-lock.yaml does not satisfy the manifests or pnpm settings (release-process fact; CI does not run on tags).
- Whether pnpm 12.15 non-frozen install in that state actually re-resolves to a newer registry version than the lockfile pin (needs registry access, unavailable offline).

### Resolution plan
- **Local (bounded):** In a disposable copy of the repo with a local verdaccio registry holding dummy package v3-probe@1.0.0 and 1.0.1: pin 1.0.0 in pnpm-lock.yaml, set the manifest to ^1.0.0 plus one unrelated manifest edit so the lockfile is out of sync, run applyUpdate with skipRestart and NODE_ENV=test pointing at that copy, and check whether node_modules/v3-probe resolves to 1.0.1.
- **Owner-observed:** Owner checks, for each published v* tag, whether `pnpm install --frozen-lockfile --lockfile-only` succeeds at that tag (CI or local clone, no updater run), and whether update logs on hosts ever show 'Retrying dependency install with pnpm install...'.

---

