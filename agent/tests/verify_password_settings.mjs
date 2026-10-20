import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";

const require = createRequire(import.meta.url);
const preferences = require("../services/preferences.js");
const { app } = require("../index.js");
const settingsRouter = require("../routes/settings.js");
const { constantTimeCompare } = require("../routes/auth.js");

console.log("--- Running Dynamic Passcode Management Verification Tests ---");

// Helper to extract cookie value
function extractCookieValue(setCookieHeader, name) {
	if (!setCookieHeader) return null;
	const match = new RegExp(`${name}=([^;]+)`).exec(setCookieHeader);
	return match ? match[1] : null;
}

// 1. Test updateEnvPassword helper directly in isolated temp directory
console.log("\n[Test Suite 1] Testing updateEnvPassword helper");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "home-cloud-env-test-"));

try {
	// 1a. Test update existing .env with PASSWORD
	const envFile1 = path.join(tempDir, ".env1");
	fs.writeFileSync(envFile1, "SOME_VAR=hello\nPASSWORD=old-pass\nOTHER_VAR=world\n", "utf8");
	settingsRouter.updateEnvPassword(envFile1, "new-secret-pass-123");
	const content1 = fs.readFileSync(envFile1, "utf8");
	assert.ok(content1.includes("PASSWORD=new-secret-pass-123"), "Should contain new password");
	assert.ok(!content1.includes("PASSWORD=old-pass"), "Should not contain old password");
	assert.ok(content1.includes("SOME_VAR=hello"), "Should preserve other vars");
	assert.ok(content1.includes("OTHER_VAR=world"), "Should preserve other vars");
	console.log("  ✔ updateEnvPassword correctly updates existing PASSWORD in .env");

	// 1b. Test update existing .env without PASSWORD
	const envFile2 = path.join(tempDir, ".env2");
	fs.writeFileSync(envFile2, "SOME_VAR=hello\nOTHER_VAR=world\n", "utf8");
	settingsRouter.updateEnvPassword(envFile2, "appended-pass-456");
	const content2 = fs.readFileSync(envFile2, "utf8");
	assert.ok(content2.includes("PASSWORD=appended-pass-456"), "Should append new password");
	assert.ok(content2.includes("SOME_VAR=hello"), "Should preserve other vars");
	console.log("  ✔ updateEnvPassword correctly appends PASSWORD to .env when missing");

	// 1c. Test fallback when .env does not exist
	const envFile3 = path.join(tempDir, "sub", ".env3");
	settingsRouter.updateEnvPassword(envFile3, "brand-new-pass-789");
	assert.ok(fs.existsSync(envFile3), ".env file should be created");
	const content3 = fs.readFileSync(envFile3, "utf8");
	assert.ok(content3.includes("PASSWORD=brand-new-pass-789"), "Should contain new password");
	assert.ok(content3.includes("JWT_SECRET="), "Should contain JWT_SECRET");
	console.log("  ✔ updateEnvPassword creates new .env with password and JWT_SECRET when missing");

	// 1d. Test file permissions (0o600)
	const stat = fs.statSync(envFile3);
	const mode = stat.mode & 0o777;
	assert.equal(mode, 0o600, `File permissions should be 0600, got ${mode.toString(8)}`);
	console.log("  ✔ updateEnvPassword creates file with secure 0600 permissions");
} finally {
	fs.rmSync(tempDir, { recursive: true, force: true });
}

// 2. HTTP Endpoint Integration Tests
console.log("\n[Test Suite 2] Testing POST /api/settings/password HTTP Endpoint");

const origPassword = process.env.PASSWORD;
const origJwtSecret = process.env.JWT_SECRET;

const JWT_SECRET = "test-jwt-secret-settings-pass";
process.env.JWT_SECRET = JWT_SECRET;
const INITIAL_PASSWORD = "initial-secure-password-123";
process.env.PASSWORD = INITIAL_PASSWORD;

// Resolve agent directory relative to this test file
const agentDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const realEnvPath = path.resolve(agentDir, ".env");

// Backup real .env if it exists in agent/
let realEnvBackup = null;
if (fs.existsSync(realEnvPath)) {
	realEnvBackup = fs.readFileSync(realEnvPath, "utf8");
} else {
	// Create temporary agent/.env so tests don't affect anything
	fs.writeFileSync(realEnvPath, `PASSWORD=${INITIAL_PASSWORD}\nJWT_SECRET=${JWT_SECRET}\n`, "utf8");
}

// Backup initial preferences file if it exists
let initialPrefsBackup = null;
if (fs.existsSync(preferences.PREFERENCES_FILE)) {
	initialPrefsBackup = fs.readFileSync(preferences.PREFERENCES_FILE, "utf8");
}

const testServer = http.createServer(app);
await new Promise((resolve) => testServer.listen(0, "127.0.0.1", resolve));
const address = testServer.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
	// 2a. Unauthenticated request to /api/settings/password must return 401
	console.log("  [Test 2a] Unauthenticated request rejected with 401");
	const unauthRes = await fetch(`${baseUrl}/api/settings/password`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ currentPassword: INITIAL_PASSWORD, newPassword: "newpassword123" }),
	});
	assert.equal(unauthRes.status, 401, `Expected 401, got ${unauthRes.status}`);
	console.log("    ✔ Unauthenticated access rejected");

	// Log in to get auth token
	const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: INITIAL_PASSWORD }),
	});
	assert.equal(loginRes.status, 200, "Login must succeed");
	const tokenHeader = loginRes.headers.get("set-cookie");
	const authToken = extractCookieValue(tokenHeader, "token");
	assert.ok(authToken, "Auth token must be retrieved");
	const initialEpoch = preferences.getSessionEpoch();

	// 2b. Missing or non-string currentPassword / newPassword
	console.log("  [Test 2b] Missing or invalid payload validation");
	const invalidBodies = [
		{},
		{ currentPassword: INITIAL_PASSWORD },
		{ newPassword: "newpassword123" },
		{ currentPassword: 12345, newPassword: "newpassword123" },
		{ currentPassword: INITIAL_PASSWORD, newPassword: null },
		{ currentPassword: "", newPassword: "newpassword123" },
	];

	for (const body of invalidBodies) {
		const res = await fetch(`${baseUrl}/api/settings/password`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: `token=${authToken}`,
			},
			body: JSON.stringify(body),
		});
		assert.equal(res.status, 400, `Expected 400 for invalid body ${JSON.stringify(body)}, got ${res.status}`);
		const data = await res.json();
		assert.equal(data.error, "Current password and new password are required");
	}
	console.log("    ✔ Payload validation properly rejects missing or non-string fields");

	// 2c. Incorrect current password returns 401
	console.log("  [Test 2c] Incorrect current password returns 401");
	const wrongPassRes = await fetch(`${baseUrl}/api/settings/password`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: `token=${authToken}`,
		},
		body: JSON.stringify({
			currentPassword: "wrong-password-999",
			newPassword: "brandnewpassword123",
		}),
	});
	assert.equal(wrongPassRes.status, 401, `Expected 401, got ${wrongPassRes.status}`);
	const wrongPassData = await wrongPassRes.json();
	assert.equal(wrongPassData.error, "Incorrect current password");
	console.log("    ✔ Incorrect current password rejected with 401");

	// 2d. New password too short (< 8 chars) returns 400
	console.log("  [Test 2d] New password < 8 characters returns 400");
	const shortPassRes = await fetch(`${baseUrl}/api/settings/password`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: `token=${authToken}`,
		},
		body: JSON.stringify({
			currentPassword: INITIAL_PASSWORD,
			newPassword: "  short  ", // trims to 'short' (5 chars)
		}),
	});
	assert.equal(shortPassRes.status, 400, `Expected 400, got ${shortPassRes.status}`);
	const shortPassData = await shortPassRes.json();
	assert.equal(shortPassData.error, "New password must be at least 8 characters long");
	console.log("    ✔ Password length validation works (< 8 characters after trim)");

	// 2e. New password same as current password returns 400
	console.log("  [Test 2e] New password identical to current password returns 400");
	const samePassRes = await fetch(`${baseUrl}/api/settings/password`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: `token=${authToken}`,
		},
		body: JSON.stringify({
			currentPassword: INITIAL_PASSWORD,
			newPassword: `  ${INITIAL_PASSWORD}  `, // trimmed matches current
		}),
	});
	assert.equal(samePassRes.status, 400, `Expected 400, got ${samePassRes.status}`);
	const samePassData = await samePassRes.json();
	assert.equal(samePassData.error, "New password must be different from current password");
	console.log("    ✔ Identical password rejected");

	// 2f. Successful password update
	console.log("  [Test 2f] Successful password update");
	const NEW_PASSWORD = "updated-secure-password-456";
	const successRes = await fetch(`${baseUrl}/api/settings/password`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: `token=${authToken}`,
		},
		body: JSON.stringify({
			currentPassword: INITIAL_PASSWORD,
			newPassword: `  ${NEW_PASSWORD}  `,
		}),
	});
	assert.equal(successRes.status, 200, `Expected 200, got ${successRes.status}`);
	const successData = await successRes.json();
	assert.equal(successData.success, true);
	assert.equal(successData.message, "Password updated successfully. All sessions revoked.");
	assert.equal(successData.sessionEpoch, initialEpoch + 1);

	// Check that token cookie was cleared in response header
	const setCookie = successRes.headers.get("set-cookie");
	assert.ok(setCookie, "Response must set-cookie to clear token");
	assert.ok(setCookie.includes("token=;") || setCookie.includes("token=; Max-Age=0") || setCookie.includes("token=; Path=/; Expires="), "Cookie must be cleared");

	// Check in-memory update
	assert.equal(process.env.PASSWORD, NEW_PASSWORD, "process.env.PASSWORD must be updated");

	// Check .env file update
	const envOnDisk = fs.readFileSync(realEnvPath, "utf8");
	assert.ok(envOnDisk.includes(`PASSWORD=${NEW_PASSWORD}`), ".env must contain updated PASSWORD");

	console.log("    ✔ Successful password update returned 200, cleared cookie, updated process.env and .env");

	// 2g. Active session revocation
	console.log("  [Test 2g] Active sessions with old epoch revoked");
	const postRevokeRes = await fetch(`${baseUrl}/api/me`, {
		headers: { Cookie: `token=${authToken}` },
	});
	assert.equal(postRevokeRes.status, 401, `Expected 401 for old session token, got ${postRevokeRes.status}`);
	const postRevokeData = await postRevokeRes.json();
	assert.equal(postRevokeData.error, "Session has been revoked");
	console.log("    ✔ Old session token successfully revoked across devices");

	// 2h. Verify old password no longer logs in, but new password logs in
	console.log("  [Test 2h] Verify login with old vs new password");
	const oldLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: INITIAL_PASSWORD }),
	});
	assert.equal(oldLoginRes.status, 401, "Old password must fail");

	const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: NEW_PASSWORD }),
	});
	assert.equal(newLoginRes.status, 200, "New password must succeed");
	const newLoginData = await newLoginRes.json();
	assert.equal(newLoginData.success, true);
	console.log("    ✔ Login works with new password and fails with old password");

} finally {
	await new Promise((resolve) => testServer.close(resolve));
	// Restore real .env
	if (realEnvBackup !== null) {
		fs.writeFileSync(realEnvPath, realEnvBackup, "utf8");
	} else if (fs.existsSync(realEnvPath)) {
		fs.unlinkSync(realEnvPath);
	}

	// Clean up any stray temporary files in agent directory
	try {
		const agentFiles = fs.readdirSync(agentDir);
		for (const file of agentFiles) {
			if (file.startsWith(".env") && file.endsWith(".tmp")) {
				fs.unlinkSync(path.join(agentDir, file));
			}
		}
	} catch (_) {}

	// Restore preferences to ensure complete determinism
	if (initialPrefsBackup !== null) {
		fs.writeFileSync(preferences.PREFERENCES_FILE, initialPrefsBackup, "utf8");
	} else if (fs.existsSync(preferences.PREFERENCES_FILE)) {
		fs.unlinkSync(preferences.PREFERENCES_FILE);
	}

	// Clean up any stray preferences .tmp files
	try {
		if (fs.existsSync(preferences.PREFERENCES_DIR)) {
			const prefFiles = fs.readdirSync(preferences.PREFERENCES_DIR);
			for (const file of prefFiles) {
				if (file.endsWith(".tmp")) {
					fs.unlinkSync(path.join(preferences.PREFERENCES_DIR, file));
				}
			}
		}
	} catch (_) {}

	preferences._resetForTesting(null);

	// Restore original env vars
	if (origPassword !== undefined) {
		process.env.PASSWORD = origPassword;
	} else {
		delete process.env.PASSWORD;
	}
	if (origJwtSecret !== undefined) {
		process.env.JWT_SECRET = origJwtSecret;
	} else {
		delete process.env.JWT_SECRET;
	}
}

console.log("\n--- All Passcode Management Verification Tests Passed Successfully! ---");
