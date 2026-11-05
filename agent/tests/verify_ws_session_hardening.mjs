import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import WebSocket from "ws";

// Isolate test environment
const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "home-cloud-ws-session-hardening-"));
const configDir = path.join(testTmpDir, ".config", "home-cloud");
fs.mkdirSync(configDir, { recursive: true });

process.env.HOME = testTmpDir;
process.env.XDG_CONFIG_HOME = path.join(testTmpDir, ".config");
process.env.HOME_CLOUD_CONFIG_DIR = configDir;
process.env.AGENT_ENV_FILE = path.join(testTmpDir, ".env");
process.env.CF_CONFIG = path.join(testTmpDir, ".cloudflared", "config.yml");
process.env.BASE_DIR = testTmpDir;

const JWT_SECRET = "hardening-test-jwt-secret-32-chars-min";
const INITIAL_PASSWORD = `pw-${crypto.randomUUID()}`;
process.env.JWT_SECRET = JWT_SECRET;
process.env.PASSWORD = INITIAL_PASSWORD;

fs.writeFileSync(
	process.env.AGENT_ENV_FILE,
	`PASSWORD=${INITIAL_PASSWORD}\nJWT_SECRET=${JWT_SECRET}\n`,
	{ mode: 0o600, encoding: "utf8" }
);

const require = createRequire(import.meta.url);
const preferences = require("../services/preferences.js");
const { server } = require("../index.js");
const authRouter = require("../routes/auth.js");

function extractCookieValue(setCookieHeader, name) {
	if (!setCookieHeader) return null;
	const match = new RegExp(`${name}=([^;]+)`).exec(setCookieHeader);
	return match ? match[1] : null;
}

console.log("--- Running WebSocket & Session Hardening Verification Tests ---");

try {
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const baseUrl = `http://127.0.0.1:${address.port}`;

	// [Test 1] Malformed 6-byte WebSocket frame crash survival
	console.log("[Test 1] Server survives malformed 6-byte frame and answers HTTP afterwards");
	const tcpSocket = net.createConnection({ port: address.port, host: "127.0.0.1" });
	await new Promise((resolve, reject) => {
		tcpSocket.once("connect", resolve);
		tcpSocket.once("error", reject);
	});

	const upgradeRequest = [
		"GET /terminal HTTP/1.1",
		`Host: 127.0.0.1:${address.port}`,
		"Upgrade: websocket",
		"Connection: Upgrade",
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
		"Sec-WebSocket-Version: 13",
		"Origin: http://rebind.attacker.test",
		"",
		"",
	].join("\r\n");

	tcpSocket.write(upgradeRequest);

	await new Promise((resolve) => {
		tcpSocket.on("data", function onData(chunk) {
			if (chunk.toString().includes("101 Switching Protocols")) {
				tcpSocket.off("data", onData);
				resolve();
			}
		});
	});

	// Masked RSV1 frame (c1 80 01 02 03 04)
	const malformedFrame = Buffer.from([0xc1, 0x80, 0x01, 0x02, 0x03, 0x04]);
	tcpSocket.write(malformedFrame);

	// Wait for frame to be processed
	await new Promise((r) => setTimeout(r, 150));

	// Verify server is alive and answers HTTP request
	const pingRes = await fetch(`${baseUrl}/api/ping`);
	assert.equal(pingRes.status, 200, "Server must remain alive and return 200 on /api/ping");
	const pingBody = await pingRes.json();
	assert.deepEqual(pingBody, { status: "ok" });
	tcpSocket.destroy();
	console.log("  ✔ Server survived malformed frame and responded with 200 { status: 'ok' }");

	// [Test 2] Open terminal socket is closed promptly after logout-all and after password change
	console.log("[Test 2] Open terminal socket is closed promptly after logout-all and after password change");
	const loginRes1 = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: baseUrl },
		body: JSON.stringify({ password: INITIAL_PASSWORD }),
	});
	assert.equal(loginRes1.status, 200);
	const cookieHeader1 = loginRes1.headers.get("set-cookie");
	const token1 = extractCookieValue(cookieHeader1, "token");
	assert.ok(token1);

	const wsTerminal1 = new WebSocket(`ws://127.0.0.1:${address.port}/terminal?sessionId=hardening_sess_1`, {
		headers: { Cookie: `token=${token1}` },
		origin: baseUrl,
	});

	await new Promise((resolve, reject) => {
		wsTerminal1.once("open", resolve);
		wsTerminal1.once("error", reject);
	});
	assert.equal(wsTerminal1.readyState, WebSocket.OPEN, "Terminal WS should be open");

	let ws1Closed = false;
	wsTerminal1.once("close", () => {
		ws1Closed = true;
	});

	// Trigger logout-all
	const logoutRes = await fetch(`${baseUrl}/api/auth/logout-all`, {
		method: "POST",
		headers: { Cookie: `token=${token1}`, Origin: baseUrl },
	});
	assert.equal(logoutRes.status, 200);

	const startWait1 = Date.now();
	while (!ws1Closed && Date.now() - startWait1 < 2500) {
		await new Promise((r) => setTimeout(r, 50));
	}
	assert.equal(ws1Closed, true, "Terminal socket must close after logout-all");
	console.log("  ✔ Terminal WebSocket was closed after logout-all");

	// Test revocation on password change
	const loginRes2 = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: baseUrl },
		body: JSON.stringify({ password: INITIAL_PASSWORD }),
	});
	assert.equal(loginRes2.status, 200);
	const token2 = extractCookieValue(loginRes2.headers.get("set-cookie"), "token");
	assert.ok(token2);

	const wsTerminal2 = new WebSocket(`ws://127.0.0.1:${address.port}/terminal?sessionId=hardening_sess_2`, {
		headers: { Cookie: `token=${token2}` },
		origin: baseUrl,
	});
	await new Promise((resolve, reject) => {
		wsTerminal2.once("open", resolve);
		wsTerminal2.once("error", reject);
	});

	let ws2Closed = false;
	wsTerminal2.once("close", () => {
		ws2Closed = true;
	});

	const PWD_V2 = `pw-${crypto.randomUUID()}`;
	const changeRes = await fetch(`${baseUrl}/api/settings/password`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Cookie: `token=${token2}`, Origin: baseUrl },
		body: JSON.stringify({ currentPassword: INITIAL_PASSWORD, newPassword: PWD_V2 }),
	});
	assert.equal(changeRes.status, 200);

	const startWait2 = Date.now();
	while (!ws2Closed && Date.now() - startWait2 < 2500) {
		await new Promise((r) => setTimeout(r, 50));
	}
	assert.equal(ws2Closed, true, "Terminal socket must close after password change");
	console.log("  ✔ Terminal WebSocket was closed after password rotation");

	// [Test 3] Password change with unwritable preferences returns error, keeping old password and rejecting new
	console.log("[Test 3] Password change with unwritable preferences returns error, keeping old password and rejecting new");
	const loginRes3 = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: baseUrl },
		body: JSON.stringify({ password: PWD_V2 }),
	});
	assert.equal(loginRes3.status, 200);
	const token3 = extractCookieValue(loginRes3.headers.get("set-cookie"), "token");

	// Make preferences directory non-writable
	fs.chmodSync(configDir, 0o500);

	const PWD_V3 = `pw-${crypto.randomUUID()}`;
	let rotationFailed = false;
	try {
		const failedRotationRes = await fetch(`${baseUrl}/api/settings/password`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: `token=${token3}`, Origin: baseUrl },
			body: JSON.stringify({ currentPassword: PWD_V2, newPassword: PWD_V3 }),
		});
		assert.ok(failedRotationRes.status >= 400, `Expected error status, got ${failedRotationRes.status}`);
		rotationFailed = true;
	} finally {
		fs.chmodSync(configDir, 0o700);
	}
	assert.equal(rotationFailed, true, "Rotation must fail when preferences are unwritable");

	// Old password must still work
	const oldPwdLogin = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: baseUrl },
		body: JSON.stringify({ password: PWD_V2 }),
	});
	assert.equal(oldPwdLogin.status, 200, "Old password must still work");

	// New password must NOT work
	const newPwdLogin = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: baseUrl },
		body: JSON.stringify({ password: PWD_V3 }),
	});
	assert.equal(newPwdLogin.status, 401, "New password must not be accepted");
	console.log("  ✔ Password rotation safely aborted; old password remains valid and new password was not applied");

	// [Test 4] Loopback peer cap blocks after N failures even when CF-Connecting-IP rotates
	console.log("[Test 4] Loopback peer cap blocks after N failures even when CF-Connecting-IP rotates");
	authRouter._resetRateLimiter();
	const PEER_MAX = authRouter.PEER_MAX_ATTEMPTS || 30;

	for (let i = 0; i < PEER_MAX; i++) {
		const res = await fetch(`${baseUrl}/api/auth/login`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": `198.51.100.${i + 1}`,
				Origin: baseUrl,
			},
			body: JSON.stringify({ password: "wrong-password-guess" }),
		});
		assert.ok(res.status === 401 || res.status === 429, `Attempt ${i + 1} status was ${res.status}`);
	}

	const blockedRes = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"CF-Connecting-IP": "198.51.100.254",
			Origin: baseUrl,
		},
		body: JSON.stringify({ password: "wrong-password-guess" }),
	});
	assert.equal(blockedRes.status, 429, "Aggregate peer limit must block request with 429 even with new CF-Connecting-IP");
	const blockedBody = await blockedRes.json();
	assert.match(blockedBody.error, /Too many failed login attempts/);
	console.log(`  ✔ Loopback peer cap locked out attacker after ${PEER_MAX} rotated attempts (returned 429)`);

	// [Test 5] Cookie request with Sec-Fetch-Site: cross-site is rejected on GET and POST, and same-origin still works
	console.log("[Test 5] Cookie request with Sec-Fetch-Site: cross-site is rejected on GET and POST, and same-origin still works");
	authRouter._resetRateLimiter();
	const loginRes5 = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: baseUrl },
		body: JSON.stringify({ password: PWD_V2 }),
	});
	assert.equal(loginRes5.status, 200);
	const token5 = extractCookieValue(loginRes5.headers.get("set-cookie"), "token");
	assert.ok(token5);

	// 5a. GET /api/me with cookie and Sec-Fetch-Site: cross-site -> 403
	const crossSiteGet = await fetch(`${baseUrl}/api/me`, {
		headers: {
			Cookie: `token=${token5}`,
			"Sec-Fetch-Site": "cross-site",
		},
	});
	assert.equal(crossSiteGet.status, 403, "Cookie-authenticated GET with Sec-Fetch-Site: cross-site must be 403");
	const crossSiteGetBody = await crossSiteGet.json();
	assert.equal(crossSiteGetBody.error, "Cross-site request rejected");

	// 5b. POST /api/auth/logout with cookie and Sec-Fetch-Site: cross-site -> 403
	const crossSitePost = await fetch(`${baseUrl}/api/auth/logout`, {
		method: "POST",
		headers: {
			Cookie: `token=${token5}`,
			Origin: baseUrl,
			"Sec-Fetch-Site": "cross-site",
		},
	});
	assert.equal(crossSitePost.status, 403, "Cookie-authenticated POST with Sec-Fetch-Site: cross-site must be 403");

	// 5c. GET /api/me with cookie and Sec-Fetch-Site: same-origin -> 200
	const sameOriginGet = await fetch(`${baseUrl}/api/me`, {
		headers: {
			Cookie: `token=${token5}`,
			"Sec-Fetch-Site": "same-origin",
		},
	});
	assert.equal(sameOriginGet.status, 200, "Same-origin Sec-Fetch-Site must be allowed (200)");

	// 5d. GET /api/me with cookie and NO Sec-Fetch-Site (curl) -> 200
	const noSecFetchGet = await fetch(`${baseUrl}/api/me`, {
		headers: {
			Cookie: `token=${token5}`,
		},
	});
	assert.equal(noSecFetchGet.status, 200, "Request without Sec-Fetch-Site header must be allowed (200)");

	// 5e. Unauthenticated GET /api/ping with Sec-Fetch-Site: cross-site -> 200
	const unauthPing = await fetch(`${baseUrl}/api/ping`, {
		headers: {
			"Sec-Fetch-Site": "cross-site",
		},
	});
	assert.equal(unauthPing.status, 200, "Unauthenticated /api/ping with Sec-Fetch-Site: cross-site must be allowed (200)");
	console.log("  ✔ Sec-Fetch-Site: cross-site strictly rejected for cookie-authenticated requests while same-origin and curl pass");

	console.log("\n✅ All WebSocket & Session Hardening tests passed successfully!");
} finally {
	await new Promise((resolve) => server.close(resolve));
	try {
		fs.rmSync(testTmpDir, { recursive: true, force: true });
	} catch (_) {}
}
