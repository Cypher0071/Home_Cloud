import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import WebSocket from "ws";

// Isolate test environment before loading agent modules
const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "home-cloud-stream-revocation-"));
const configDir = path.join(testTmpDir, ".config", "home-cloud");
fs.mkdirSync(configDir, { recursive: true });

process.env.HOME = testTmpDir;
process.env.XDG_CONFIG_HOME = path.join(testTmpDir, ".config");
process.env.HOME_CLOUD_CONFIG_DIR = configDir;
process.env.AGENT_ENV_FILE = path.join(testTmpDir, ".env");
process.env.CF_CONFIG = path.join(testTmpDir, ".cloudflared", "config.yml");
process.env.BASE_DIR = testTmpDir;

const JWT_SECRET = "stream-revocation-test-secret-32-chars-min";
const INITIAL_PASSWORD = "stream-revocation-password-123";
process.env.JWT_SECRET = JWT_SECRET;
process.env.PASSWORD = INITIAL_PASSWORD;

fs.writeFileSync(
	process.env.AGENT_ENV_FILE,
	`PASSWORD=${INITIAL_PASSWORD}\nJWT_SECRET=${JWT_SECRET}\n`,
	{ mode: 0o600, encoding: "utf8" }
);

const require = createRequire(import.meta.url);

// Stub Dockerode before routes/index are loaded
const Docker = require("dockerode");

let activeStatsStream = null;
let activeLogsStream = null;
let activePullStream = null;

Docker.prototype.getContainer = function (id) {
	return {
		stats: async ({ stream }) => {
			activeStatsStream = new PassThrough();
			return activeStatsStream;
		},
		inspect: async () => ({
			Id: id,
			Config: { Tty: true },
			NetworkSettings: { Ports: {} },
		}),
		logs: async (opts) => {
			activeLogsStream = new PassThrough();
			return activeLogsStream;
		},
	};
};

Docker.prototype.pull = async function (imageName) {
	activePullStream = new PassThrough();
	return activePullStream;
};

const dummyDocker = new Docker();
dummyDocker.modem.constructor.prototype.followProgress = function (stream, onFinished, onProgress) {
	if (typeof onProgress === "function") {
		onProgress({ status: "Downloading layer 1", progressDetail: { current: 10, total: 100 } });
	}
	if (stream && typeof stream.on === "function") {
		stream.on("close", () => {
			if (typeof onFinished === "function") {
				onFinished(new Error("Stream destroyed"));
			}
		});
	}
};

const preferences = require("../services/preferences.js");
const { server } = require("../index.js");
const terminal = require("../sockets/terminal.js");
const updateManager = require("../services/updateManager.js");

function extractCookieValue(setCookieHeader, name) {
	if (!setCookieHeader) return null;
	const match = new RegExp(`${name}=([^;]+)`).exec(setCookieHeader);
	return match ? match[1] : null;
}

function requestStream(options, postBody = null) {
	return new Promise((resolve, reject) => {
		const headers = { ...(options.headers || {}) };
		let bodyBuffer = null;
		if (postBody) {
			bodyBuffer = Buffer.isBuffer(postBody) ? postBody : Buffer.from(String(postBody));
			headers["Content-Length"] = String(bodyBuffer.length);
		}
		const req = http.request({ ...options, headers }, (res) => {
			resolve({ req, res });
		});
		req.on("error", reject);
		if (bodyBuffer) {
			req.write(bodyBuffer);
		}
		req.end();
	});
}

function waitForEnd(res, timeoutMs = 3000) {
	return new Promise((resolve, reject) => {
		if (res.readableEnded || res.destroyed) {
			return resolve();
		}
		const timer = setTimeout(() => {
			reject(new Error("Timeout waiting for response stream to end"));
		}, timeoutMs);
		res.on("data", () => {});
		res.on("end", () => {
			clearTimeout(timer);
			resolve();
		});
		res.on("close", () => {
			clearTimeout(timer);
			resolve();
		});
		res.resume();
	});
}

console.log("--- Running Stream & Terminal Session Revocation Verification Tests ---");

try {
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const baseUrl = `http://127.0.0.1:${address.port}`;

	// Helper to login and get fresh cookie token
	async function getSessionToken() {
		const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: baseUrl },
			body: JSON.stringify({ password: INITIAL_PASSWORD }),
		});
		assert.equal(loginRes.status, 200, "Login must succeed");
		const token = extractCookieValue(loginRes.headers.get("set-cookie"), "token");
		assert.ok(token, "Login must return token cookie");
		return token;
	}

	// [Test 1] GET /api/metrics stream ends on session revocation
	console.log("[Test 1] GET /api/metrics stream ends when session is revoked");
	const token1 = await getSessionToken();
	const { res: metricsRes } = await requestStream({
		hostname: "127.0.0.1",
		port: address.port,
		path: "/api/metrics",
		method: "GET",
		headers: {
			Cookie: `token=${token1}`,
			Origin: baseUrl,
		},
	});
	assert.equal(metricsRes.statusCode, 200);
	assert.match(metricsRes.headers["content-type"], /text\/event-stream/);

	const metricsEndPromise = waitForEnd(metricsRes);
	preferences.incrementSessionEpoch();
	await metricsEndPromise;
	console.log("  ✔ GET /api/metrics stream ended promptly upon epoch increment");

	// [Test 2] GET /api/docker/containers/:id/stats stream ends and cleans up on revocation
	console.log("[Test 2] GET /api/docker/containers/:id/stats stream ends and cleans up on revocation");
	const token2 = await getSessionToken();
	const { res: statsRes } = await requestStream({
		hostname: "127.0.0.1",
		port: address.port,
		path: "/api/docker/containers/test-box/stats",
		method: "GET",
		headers: {
			Cookie: `token=${token2}`,
			Origin: baseUrl,
		},
	});
	assert.equal(statsRes.statusCode, 200);
	assert.ok(activeStatsStream, "Docker stats stream must be created");
	assert.equal(activeStatsStream.destroyed, false);

	const statsEndPromise = waitForEnd(statsRes);
	preferences.incrementSessionEpoch();
	await statsEndPromise;
	assert.equal(activeStatsStream.destroyed, true, "Docker stats stream must be destroyed");
	console.log("  ✔ Docker stats stream and HTTP response terminated on session revocation");

	// [Test 3] GET /api/docker/containers/:id/logs stream ends and cleans up on revocation
	console.log("[Test 3] GET /api/docker/containers/:id/logs stream ends and cleans up on revocation");
	const token3 = await getSessionToken();
	const { res: logsRes } = await requestStream({
		hostname: "127.0.0.1",
		port: address.port,
		path: "/api/docker/containers/test-box/logs",
		method: "GET",
		headers: {
			Cookie: `token=${token3}`,
			Origin: baseUrl,
		},
	});
	assert.equal(logsRes.statusCode, 200);
	assert.ok(activeLogsStream, "Docker logs stream must be created");
	assert.equal(activeLogsStream.destroyed, false);

	const logsEndPromise = waitForEnd(logsRes);
	preferences.incrementSessionEpoch();
	await logsEndPromise;
	assert.equal(activeLogsStream.destroyed, true, "Docker logs stream must be destroyed");
	console.log("  ✔ Docker logs stream and HTTP response terminated on session revocation");

	// [Test 4] POST /api/docker/images/pull stream ends and cleans up on revocation
	console.log("[Test 4] POST /api/docker/images/pull stream ends and cleans up on revocation");
	const token4 = await getSessionToken();
	const { res: pullRes } = await requestStream({
		hostname: "127.0.0.1",
		port: address.port,
		path: "/api/docker/images/pull",
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: `token=${token4}`,
			Origin: baseUrl,
		},
	}, JSON.stringify({ image: "alpine:3.19" }));
	assert.equal(pullRes.statusCode, 200);
	assert.ok(activePullStream, "Docker pull stream must be created");
	assert.equal(activePullStream.destroyed, false);

	const pullEndPromise = waitForEnd(pullRes);
	preferences.incrementSessionEpoch();
	await pullEndPromise;
	assert.equal(activePullStream.destroyed, true, "Docker pull stream must be destroyed");
	console.log("  ✔ Docker pull stream and HTTP response terminated on session revocation");

	// [Test 5] GET /api/settings/update/progress stream ends on revocation
	console.log("[Test 5] GET /api/settings/update/progress stream ends and unregisters listener on revocation");
	const token5 = await getSessionToken();
	const prevListeners = updateManager.updateEmitter.listenerCount("progress");
	const { res: updateRes } = await requestStream({
		hostname: "127.0.0.1",
		port: address.port,
		path: "/api/settings/update/progress",
		method: "GET",
		headers: {
			Cookie: `token=${token5}`,
			Origin: baseUrl,
		},
	});
	assert.equal(updateRes.statusCode, 200);
	assert.equal(updateManager.updateEmitter.listenerCount("progress"), prevListeners + 1);

	const updateEndPromise = waitForEnd(updateRes);
	preferences.incrementSessionEpoch();
	await updateEndPromise;
	assert.equal(updateManager.updateEmitter.listenerCount("progress"), prevListeners, "updateEmitter progress listener must be removed");
	console.log("  ✔ Update progress SSE stream closed and listener removed on revocation");

	// [Test 6] Terminal sessions Map is emptied on revocation
	console.log("[Test 6] Terminal sessions Map is emptied on revocation");
	const currentEpoch6 = preferences.getSessionEpoch();
	const token6 = await getSessionToken();

	// Create a detached session
	const detachedSession = new terminal.TerminalSession("term_test_detached", currentEpoch6);
	assert.ok(terminal.sessions.has("term_test_detached"));

	// Create an attached session via WebSocket
	const wsTerminal = new WebSocket(`ws://127.0.0.1:${address.port}/terminal?sessionId=term_test_attached`, {
		headers: { Cookie: `token=${token6}` },
		origin: baseUrl,
	});
	await new Promise((resolve, reject) => {
		wsTerminal.once("open", resolve);
		wsTerminal.once("error", reject);
	});
	assert.ok(terminal.sessions.has("term_test_attached"));
	assert.ok(terminal.sessions.size >= 2);

	let wsClosed = false;
	wsTerminal.once("close", () => {
		wsClosed = true;
	});

	// Revoke sessions
	preferences.incrementSessionEpoch();

	assert.equal(terminal.sessions.size, 0, "All terminal sessions must be removed from sessions Map on revocation");
	assert.equal(terminal.sessions.has("term_test_detached"), false);
	assert.equal(terminal.sessions.has("term_test_attached"), false);

	const startWaitWs = Date.now();
	while (!wsClosed && Date.now() - startWaitWs < 2000) {
		await new Promise((r) => setTimeout(r, 50));
	}
	assert.equal(wsClosed, true, "Attached terminal WebSocket must be closed on revocation");
	console.log("  ✔ Terminal sessions Map emptied and attached sockets closed on revocation");

	// [Test 7] Cross-epoch reattach does not reuse old session or replay scrollback
	console.log("[Test 7] Cross-epoch reattach does not reuse old session or replay scrollback");
	const epochOld = preferences.getSessionEpoch();

	// Create a stale session with epochOld and sensitive scrollback
	const staleSession = new terminal.TerminalSession("term_cross_epoch_test", epochOld);
	staleSession.buffer.write("SUPER_SECRET_REVOKED_DATA_LINE_1\n");
	assert.equal(staleSession.authEpoch, epochOld);
	assert.ok(terminal.sessions.has("term_cross_epoch_test"));

	// Bump epoch to simulate login in a newer epoch
	preferences.incrementSessionEpoch();
	const epochNew = preferences.getSessionEpoch();
	assert.notEqual(epochOld, epochNew);

	// In case the module-level revoked wiped it, manually re-insert a stale session with epochOld
	// to strictly test the handleSystemTerminal cross-epoch reattach guard
	terminal.sessions.set("term_cross_epoch_test", staleSession);

	const token7 = await getSessionToken(); // has epochNew
	const wsReattach = new WebSocket(`ws://127.0.0.1:${address.port}/terminal?sessionId=term_cross_epoch_test`, {
		headers: { Cookie: `token=${token7}` },
		origin: baseUrl,
	});

	let receivedMessages = [];
	wsReattach.on("message", (data) => {
		receivedMessages.push(data.toString());
	});

	await new Promise((resolve, reject) => {
		wsReattach.once("open", resolve);
		wsReattach.once("error", reject);
	});

	// Allow initial frame to arrive
	await new Promise((r) => setTimeout(r, 100));

	const currentSession = terminal.sessions.get("term_cross_epoch_test");
	assert.ok(currentSession, "Session must exist for connected socket");
	assert.notEqual(currentSession, staleSession, "Old session object must have been destroyed and replaced");
	assert.equal(currentSession.authEpoch, epochNew, "New session authEpoch must match current connection epoch");

	const sessionPayload = receivedMessages.find((m) => m.startsWith("{\"type\":\"session\""));
	assert.ok(sessionPayload, "Client must receive session handshake message");
	const parsedHandshake = JSON.parse(sessionPayload);
	assert.equal(parsedHandshake.restored, false, "Cross-epoch reattach must NOT restore previous terminal");

	const leakedData = receivedMessages.some((m) => m.includes("SUPER_SECRET_REVOKED_DATA"));
	assert.equal(leakedData, false, "Client must NOT receive scrollback from previous epoch");

	wsReattach.close();
	console.log("  ✔ Cross-epoch reattach destroyed old session, did not restore PTY, and prevented scrollback leak");

	console.log("\n✅ All Stream & Terminal Session Revocation verification tests passed successfully!");
} finally {
	server.closeAllConnections?.();
	await new Promise((resolve) => server.close(resolve));
	try {
		fs.rmSync(testTmpDir, { recursive: true, force: true });
	} catch (_) {}
}
