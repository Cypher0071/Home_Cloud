import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";

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
	const loginData = await loginRes.json();
	assert.equal(loginData.success, true, "Login must return success: true");

	const rawSetCookie = loginRes.headers.get("set-cookie");
	assert.ok(rawSetCookie, "Login must set a cookie");
	const token1 = extractCookieValue(rawSetCookie, "token");
	assert.ok(token1, "Token cookie must be present");

	const decoded1 = jwt.verify(token1, JWT_SECRET);
	assert.equal(decoded1.authorized, true, "Token authorized claim must be true");
	assert.equal(decoded1.epoch, initialEpoch, `Token epoch claim must equal current epoch (${initialEpoch})`);
	console.log(`  ✔ Login successfully issued JWT with epoch: ${decoded1.epoch}`);

	// Test 3: Requests to protected endpoints (/api/me, /api/network/info) succeed with valid epoch token
	console.log("[Test 3] Requests to protected endpoints (/api/me, /api/network/info) succeed with valid epoch token");
	const meRes = await fetch(`${baseUrl}/api/me`, {
		headers: { Cookie: `token=${token1}` },
	});
	assert.equal(meRes.status, 200, `Expected 200 from /api/me, got ${meRes.status}`);
	const meData = await meRes.json();
	assert.equal(meData.authorized, true, "Expected authorized: true on /api/me");
	assert.equal(meData.user?.epoch, initialEpoch, "Expected user.epoch to match on /api/me");

	const authMeRes = await fetch(`${baseUrl}/api/auth/me`, {
		headers: { Cookie: `token=${token1}` },
	});
	assert.equal(authMeRes.status, 200, `Expected 200 from /api/auth/me, got ${authMeRes.status}`);
	const authMeData = await authMeRes.json();
	assert.equal(authMeData.authorized, true, "Expected authorized: true on /api/auth/me");
	assert.equal(authMeData.user?.epoch, initialEpoch, "Expected user.epoch to match on /api/auth/me");

	const netInfoRes = await fetch(`${baseUrl}/api/network/info`, {
		headers: { Cookie: `token=${token1}` },
	});
	assert.equal(netInfoRes.status, 200, `Expected 200 from /api/network/info, got ${netInfoRes.status}`);
	const netInfoData = await netInfoRes.json();
	assert.equal(netInfoData.status, "ok", "Expected status: ok from /api/network/info");
	console.log("  ✔ Protected endpoints successfully authenticated with valid epoch token.");

	// Test 4: Token with wrong/expired epoch is rejected by authMiddleware with HTTP 401
	console.log("[Test 4] Token with wrong/expired epoch is rejected by authMiddleware with HTTP 401");
	const wrongEpochToken = jwt.sign(
		{ authorized: true, epoch: initialEpoch + 999 },
		JWT_SECRET,
		{ expiresIn: "1h" }
	);
	const wrongEpochRes = await fetch(`${baseUrl}/api/network/info`, {
		headers: { Cookie: `token=${wrongEpochToken}` },
	});
	assert.equal(wrongEpochRes.status, 401, `Expected 401 for wrong epoch, got ${wrongEpochRes.status}`);
	const wrongEpochData = await wrongEpochRes.json();
	assert.equal(wrongEpochData.error, "Session has been revoked", "Expected error message: 'Session has been revoked'");

	const wrongEpochMeRes = await fetch(`${baseUrl}/api/auth/me`, {
		headers: { Cookie: `token=${wrongEpochToken}` },
	});
	assert.equal(wrongEpochMeRes.status, 401, `Expected 401 for wrong epoch on /api/auth/me, got ${wrongEpochMeRes.status}`);
	const wrongEpochMeData = await wrongEpochMeRes.json();
	assert.equal(wrongEpochMeData.error, "Session has been revoked");
	console.log("  ✔ Expired/mismatched epoch token correctly rejected with 401 and 'Session has been revoked'.");

	// Test 5: Legacy token with no epoch (undefined) is rejected with HTTP 401
	console.log("[Test 5] Legacy token with no epoch (undefined) is rejected with HTTP 401");
	const legacyToken = jwt.sign(
		{ authorized: true },
		JWT_SECRET,
		{ expiresIn: "1h" }
	);
	const legacyRes = await fetch(`${baseUrl}/api/network/info`, {
		headers: { Cookie: `token=${legacyToken}` },
	});
	assert.equal(legacyRes.status, 401, `Expected 401 for legacy token without epoch, got ${legacyRes.status}`);
	const legacyData = await legacyRes.json();
	assert.equal(legacyData.error, "Session has been revoked", "Legacy token without epoch must be rejected as revoked");

	const legacyMeRes = await fetch(`${baseUrl}/api/auth/me`, {
		headers: { Cookie: `token=${legacyToken}` },
	});
	assert.equal(legacyMeRes.status, 401, `Expected 401 for legacy token on /api/auth/me, got ${legacyMeRes.status}`);
	const legacyMeData = await legacyMeRes.json();
	assert.equal(legacyMeData.error, "Session has been revoked");
	console.log("  ✔ Legacy token with no epoch rejected with 401 and 'Session has been revoked'.");

	// Test 6: POST /api/auth/logout-all increments session epoch, clears cookie, and invalidates previously valid token
	console.log("[Test 6] POST /api/auth/logout-all increments session epoch, clears cookie, and invalidates previously valid token");
	const logoutAllRes = await fetch(`${baseUrl}/api/auth/logout-all`, {
		method: "POST",
		headers: { Cookie: `token=${token1}` },
	});
	assert.equal(logoutAllRes.status, 200, `Expected 200 from /api/auth/logout-all, got ${logoutAllRes.status}`);
	const logoutAllData = await logoutAllRes.json();
	assert.equal(logoutAllData.success, true, "Expected success: true from logout-all");
	assert.equal(logoutAllData.message, "All active sessions revoked", "Expected message: 'All active sessions revoked'");
	assert.equal(logoutAllData.sessionEpoch, initialEpoch + 1, `Expected sessionEpoch to be incremented to ${initialEpoch + 1}`);

	// Verify cookie clearing
	const logoutCookie = logoutAllRes.headers.get("set-cookie");
	assert.ok(logoutCookie, "logout-all must set cookie to clear token");
	assert.ok(
		logoutCookie.includes("token=;") || logoutCookie.includes("Expires=Thu, 01 Jan 1970"),
		"logout-all must clear token cookie"
	);

	// Verify current in-memory epoch was incremented
	assert.equal(preferences.getSessionEpoch(), initialEpoch + 1, "getSessionEpoch() must return updated epoch");

	// Verify previously valid token is now rejected on protected endpoints
	const revokedInfoRes = await fetch(`${baseUrl}/api/network/info`, {
		headers: { Cookie: `token=${token1}` },
	});
	assert.equal(revokedInfoRes.status, 401, "Previously valid token must now be rejected with 401");
	const revokedInfoData = await revokedInfoRes.json();
	assert.equal(revokedInfoData.error, "Session has been revoked");

	const revokedMeRes = await fetch(`${baseUrl}/api/me`, {
		headers: { Cookie: `token=${token1}` },
	});
	assert.equal(revokedMeRes.status, 401, "Previously valid token must now be rejected on /api/me");
	const revokedMeData = await revokedMeRes.json();
	assert.equal(revokedMeData.error, "Session has been revoked");
	console.log("  ✔ /api/auth/logout-all incremented epoch and successfully revoked all existing tokens.");

	// Test 7: New login after logout-all gets the new epoch and succeeds
	console.log("[Test 7] New login after logout-all gets the new epoch and succeeds");
	const login2Res = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: TEST_PASSWORD }),
	});
	assert.equal(login2Res.status, 200, "New login must succeed");
	const token2 = extractCookieValue(login2Res.headers.get("set-cookie"), "token");
	assert.ok(token2, "New token must be set in cookie");

	const decoded2 = jwt.verify(token2, JWT_SECRET);
	assert.equal(decoded2.epoch, initialEpoch + 1, `New token must have incremented epoch (${initialEpoch + 1})`);

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
}
