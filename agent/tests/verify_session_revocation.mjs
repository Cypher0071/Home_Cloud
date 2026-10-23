import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";

// Isolate test environment before importing agent modules
const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "home-cloud-session-test-"));
process.env.HOME = testTmpDir;
process.env.XDG_CONFIG_HOME = path.join(testTmpDir, ".config");
process.env.HOME_CLOUD_CONFIG_DIR = path.join(testTmpDir, ".config", "home-cloud");
process.env.AGENT_ENV_FILE = path.join(testTmpDir, ".env");
process.env.CF_CONFIG = path.join(testTmpDir, ".cloudflared", "config.yml");
process.env.BASE_DIR = testTmpDir;

const require = createRequire(import.meta.url);
const preferences = require("../services/preferences.js");
const { app } = require("../index.js");
const { handleSystemTerminal } = require("../sockets/terminal.js");
const { handleContainerExec } = require("../sockets/containerExec.js");

console.log("--- Running Session Revocation & Token Epoch Verification Tests ---");

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-epoch-12345";
process.env.JWT_SECRET = JWT_SECRET;
const TEST_PASSWORD = "test-session-epoch-password";
process.env.PASSWORD = TEST_PASSWORD;

// Helper to extract cookie value
function extractCookieValue(setCookieHeader, name) {
	if (!setCookieHeader) return null;
	const match = new RegExp(`${name}=([^;]+)`).exec(setCookieHeader);
	return match ? match[1] : null;
}

// Start ephemeral server
const testServer = http.createServer(app);
await new Promise((resolve) => testServer.listen(0, "127.0.0.1", resolve));
const address = testServer.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const _fetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
	const method = String(init.method || "GET").toUpperCase();
	if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
		const headers = new Headers(init.headers || {});
		if (!headers.has("origin")) headers.set("origin", baseUrl);
		init = { ...init, headers };
	}
	return _fetch(input, init);
};

try {
	// Test 1: Initial state has valid sessionEpoch (>= 1)
	console.log("[Test 1] Initial state has valid sessionEpoch (>= 1)");
	const initialEpoch = preferences.getSessionEpoch();
	assert.ok(Number.isInteger(initialEpoch), "sessionEpoch must be an integer");
	assert.ok(initialEpoch >= 1, `sessionEpoch must be >= 1, got ${initialEpoch}`);
	const currentPrefs = preferences.getPreferences();
	assert.equal(currentPrefs.sessionEpoch, initialEpoch, "getPreferences().sessionEpoch must match getSessionEpoch()");
	console.log(`  ✔ Initial sessionEpoch verified: ${initialEpoch}`);

	// Test 2: Login issues JWT with current sessionEpoch
	console.log("[Test 2] Login issues JWT with current sessionEpoch");
	const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: TEST_PASSWORD }),
	});
	assert.equal(loginRes.status, 200, `Expected 200 from login, got ${loginRes.status}`);

	const tokenHeader1 = loginRes.headers.get("set-cookie");
	assert.ok(tokenHeader1, "set-cookie header must be present on successful login");
	const token1 = extractCookieValue(tokenHeader1, "token");
	assert.ok(token1, "token cookie must be present");

	const decoded1 = jwt.verify(token1, JWT_SECRET);
	assert.equal(decoded1.epoch, initialEpoch, `Token epoch must equal initial sessionEpoch (${initialEpoch})`);
	console.log("  ✔ Login issued JWT containing current epoch.");

	// Test 3: Authenticated access succeeds with valid token
	console.log("[Test 3] Authenticated access succeeds with valid token");
	const meRes = await fetch(`${baseUrl}/api/me`, {
		headers: { Cookie: `token=${token1}` },
	});
	assert.equal(meRes.status, 200, "Authenticated request to /api/me must return 200");
	const meData = await meRes.json();
	assert.equal(meData.authorized, true);
	assert.equal(meData.user.epoch, initialEpoch);

	const netInfoRes = await fetch(`${baseUrl}/api/network/info`, {
		headers: { Cookie: `token=${token1}` },
	});
	assert.equal(netInfoRes.status, 200, "Authenticated request to /api/network/info must return 200");
	console.log("  ✔ Authenticated endpoints accepted valid session token.");

	// Test 4: Revocation on POST /api/auth/logout-all increments sessionEpoch
	console.log("[Test 4] Revocation on POST /api/auth/logout-all increments sessionEpoch");
	const logoutAllRes = await fetch(`${baseUrl}/api/auth/logout-all`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: `token=${token1}`,
		},
	});
	assert.equal(logoutAllRes.status, 200, `Expected 200 from logout-all, got ${logoutAllRes.status}`);
	const logoutAllData = await logoutAllRes.json();
	assert.equal(logoutAllData.success, true);
	assert.equal(logoutAllData.sessionEpoch, initialEpoch + 1, "sessionEpoch in response must be incremented");

	const currentEpochAfterRevoke = preferences.getSessionEpoch();
	assert.equal(currentEpochAfterRevoke, initialEpoch + 1, "preferences.getSessionEpoch() must reflect incremented value");

	// Verify set-cookie clears the token
	const logoutCookieHeader = logoutAllRes.headers.get("set-cookie");
	assert.ok(logoutCookieHeader, "set-cookie header must be present to clear cookie");
	assert.ok(
		logoutCookieHeader.includes("token=;") || logoutCookieHeader.includes("Max-Age=0") || logoutCookieHeader.includes("Expires="),
		"Cookie should be expired or cleared",
	);
	console.log(`  ✔ POST /api/auth/logout-all incremented sessionEpoch to ${currentEpochAfterRevoke} and cleared cookie.`);

	// Test 5: Previously issued token is rejected after revocation across endpoints
	console.log("[Test 5] Previously issued token is rejected after revocation across endpoints");
	const revokedMeRes = await fetch(`${baseUrl}/api/me`, {
		headers: { Cookie: `token=${token1}` },
	});
	assert.equal(revokedMeRes.status, 401, "Revoked token must return 401 on /api/me");
	const revokedMeData = await revokedMeRes.json();
	assert.equal(revokedMeData.error, "Session has been revoked", "Error message must indicate revoked session");

	const revokedAuthMeRes = await fetch(`${baseUrl}/api/auth/me`, {
		headers: { Cookie: `token=${token1}` },
	});
	assert.equal(revokedAuthMeRes.status, 401, "Revoked token must return 401 on /api/auth/me");
	const revokedAuthMeData = await revokedAuthMeRes.json();
	assert.equal(revokedAuthMeData.error, "Session has been revoked");

	const revokedNetworkRes = await fetch(`${baseUrl}/api/network/info`, {
		headers: { Cookie: `token=${token1}` },
	});
	assert.equal(revokedNetworkRes.status, 401, "Revoked token must return 401 on /api/network/info");
	const revokedNetworkData = await revokedNetworkRes.json();
	assert.equal(revokedNetworkData.error, "Session has been revoked");
	console.log("  ✔ Revoked token rejected across all authenticated endpoints.");

	// Test 6: Legacy token without epoch claim is rejected
	console.log("[Test 6] Legacy token without epoch claim is rejected");
	const legacyToken = jwt.sign(
		{ authorized: true }, // Missing epoch claim
		JWT_SECRET,
		{ expiresIn: "7d" },
	);

	const legacyMeRes = await fetch(`${baseUrl}/api/me`, {
		headers: { Cookie: `token=${legacyToken}` },
	});
	assert.equal(legacyMeRes.status, 401, "Legacy token must return 401 on /api/me");
	const legacyMeData = await legacyMeRes.json();
	assert.equal(legacyMeData.error, "Session has been revoked");

	const legacyAuthMeRes = await fetch(`${baseUrl}/api/auth/me`, {
		headers: { Cookie: `token=${legacyToken}` },
	});
	assert.equal(legacyAuthMeRes.status, 401, "Legacy token must return 401 on /api/auth/me");
	const legacyAuthMeData = await legacyAuthMeRes.json();
	assert.equal(legacyAuthMeData.error, "Session has been revoked");
	console.log("  ✔ Legacy token without epoch claim safely rejected.");

	// Test 7: New login after revocation succeeds with new epoch
	console.log("[Test 7] New login after revocation succeeds with new epoch");
	const loginRes2 = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: TEST_PASSWORD }),
	});
	assert.equal(loginRes2.status, 200);
	const tokenHeader2 = loginRes2.headers.get("set-cookie");
	const token2 = extractCookieValue(tokenHeader2, "token");
	assert.ok(token2);

	const decoded2 = jwt.verify(token2, JWT_SECRET);
	assert.equal(decoded2.epoch, initialEpoch + 1, "New token must carry updated epoch");

	const newMeRes = await fetch(`${baseUrl}/api/me`, {
		headers: { Cookie: `token=${token2}` },
	});
	assert.equal(newMeRes.status, 200, "New session token must succeed on /api/me");

	const newNetInfoRes = await fetch(`${baseUrl}/api/network/info`, {
		headers: { Cookie: `token=${token2}` },
	});
	assert.equal(newNetInfoRes.status, 200, "New session token must succeed on /api/network/info");
	console.log("  ✔ New login issued JWT with new epoch and succeeded on protected endpoints.");

	// Test 8: Preferences persistence verification (preferences.json stores updated epoch)
	console.log("[Test 8] Preferences persistence verification (preferences.json stores updated epoch)");
	assert.ok(fs.existsSync(preferences.PREFERENCES_FILE), "preferences.json must exist on disk");
	const fileContent = fs.readFileSync(preferences.PREFERENCES_FILE, "utf8");
	const parsedPrefs = JSON.parse(fileContent);
	assert.equal(parsedPrefs.sessionEpoch, initialEpoch + 1, `Disk preferences.json sessionEpoch must be ${initialEpoch + 1}`);

	// Reset testing cache and verify it reloads correctly from disk
	preferences._resetForTesting(null);
	assert.equal(preferences.getSessionEpoch(), initialEpoch + 1, "After cache reset, getSessionEpoch() must read updated epoch from disk");
	console.log("  ✔ Preferences correctly persisted to preferences.json and reloads reliably.");

	// Test 9: WebSocket handlers (terminal & containerExec) reject revoked or legacy tokens immediately
	console.log("[Test 9] WebSocket handlers (terminal & containerExec) reject revoked or legacy tokens immediately");
	let termClosedRevoked = false;
	handleSystemTerminal({ close: () => { termClosedRevoked = true; } }, {
		headers: { cookie: `token=${token1}` },
		url: "/terminal?sessionId=test-session-1",
	});
	assert.equal(termClosedRevoked, true, "Terminal socket must close immediately for revoked epoch token");

	let termClosedLegacy = false;
	handleSystemTerminal({ close: () => { termClosedLegacy = true; } }, {
		headers: { cookie: `token=${legacyToken}` },
		url: "/terminal?sessionId=test-session-2",
	});
	assert.equal(termClosedLegacy, true, "Terminal socket must close immediately for legacy token without epoch");

	let containerClosedRevoked = false;
	handleContainerExec({ close: () => { containerClosedRevoked = true; } }, {
		headers: { cookie: `token=${token1}` },
		url: "/ws/docker/exec?containerId=test-container-1",
	});
	assert.equal(containerClosedRevoked, true, "Container exec socket must close immediately for revoked epoch token");

	let containerClosedLegacy = false;
	handleContainerExec({ close: () => { containerClosedLegacy = true; } }, {
		headers: { cookie: `token=${legacyToken}` },
		url: "/ws/docker/exec?containerId=test-container-2",
	});
	assert.equal(containerClosedLegacy, true, "Container exec socket must close immediately for legacy token without epoch");
	console.log("  ✔ WebSocket terminal and containerExec immediately reject revoked and legacy tokens.");

	console.log("\n✅ All 9 Session Revocation & Token Epoch tests passed successfully!");
} finally {
	await new Promise((resolve) => testServer.close(resolve));
	try {
		fs.rmSync(testTmpDir, { recursive: true, force: true });
	} catch (_) {}
}
