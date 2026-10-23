import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

// Isolate test environment before importing agent modules
const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "home-cloud-pref-test-"));
process.env.HOME = testTmpDir;
process.env.XDG_CONFIG_HOME = path.join(testTmpDir, ".config");
process.env.HOME_CLOUD_CONFIG_DIR = path.join(testTmpDir, ".config", "home-cloud");
process.env.AGENT_ENV_FILE = path.join(testTmpDir, ".env");
process.env.CF_CONFIG = path.join(testTmpDir, ".cloudflared", "config.yml");
process.env.BASE_DIR = testTmpDir;

const require = createRequire(import.meta.url);
const preferences = require("../services/preferences.js");
const { app } = require("../index.js");

console.log("--- Running Cross-Device Settings & Personalization Verification Tests ---");

// Helper to extract cookie value
function extractCookieValue(setCookieHeader, name) {
	if (!setCookieHeader) return null;
	const match = new RegExp(`${name}=([^;]+)`).exec(setCookieHeader);
	return match ? match[1] : null;
}

try {
	// 1. Service unit tests
	console.log("\n[Test Suite 1] Testing preferences service personalization methods");

	// Ensure clean testing state
	const origPrefs = preferences.getPreferences();
	try {
		// 1a. DEFAULT_PREFERENCES structure
		assert.ok(preferences.DEFAULT_PREFERENCES.personalization, "DEFAULT_PREFERENCES must contain personalization");
		assert.equal(preferences.DEFAULT_PREFERENCES.personalization.presetId, "macos-sonoma");
		assert.equal(preferences.DEFAULT_PREFERENCES.personalization.fit, "cover");
		assert.equal(preferences.DEFAULT_PREFERENCES.personalization.hasCustomWallpaper, false);
		assert.equal(preferences.DEFAULT_PREFERENCES.personalization.customWallpaperExt, null);
		console.log("  ✔ DEFAULT_PREFERENCES has correct personalization schema");

		// 1b. updatePreferences clean merge of personalization
		preferences.updatePreferences({
			personalization: {
				presetId: "sequoia-dark",
				fit: "contain",
			},
		});
		const updated = preferences.getPreferences();
		assert.equal(updated.personalization.presetId, "sequoia-dark");
		assert.equal(updated.personalization.fit, "contain");
		assert.equal(updated.personalization.hasCustomWallpaper, false, "Untouched personalization fields must be preserved");
		assert.equal(updated.personalization.customWallpaperExt, null);
		console.log("  ✔ updatePreferences() merges personalization fields cleanly");

		// 1c. getWallpaperPath helper
		assert.ok(typeof preferences.getWallpaperPath === "function", "getWallpaperPath must be a function");
		assert.ok(preferences.WALLPAPER_FILE_PREFIX, "WALLPAPER_FILE_PREFIX must be exported");

		// Remove any existing wallpapers
		preferences.removeCustomWallpaperFiles();
		assert.equal(preferences.getWallpaperPath(), null, "getWallpaperPath must return null when no file exists");

		// Create a dummy wallpaper.webp
		const testFile = `${preferences.WALLPAPER_FILE_PREFIX}.webp`;
		fs.writeFileSync(testFile, Buffer.from("fake-webp-content"));
		assert.equal(preferences.getWallpaperPath(), testFile, "getWallpaperPath must detect existing wallpaper.webp");

		preferences.removeCustomWallpaperFiles();
		assert.equal(fs.existsSync(testFile), false, "removeCustomWallpaperFiles must delete the file");
		assert.equal(preferences.getWallpaperPath(), null, "getWallpaperPath returns null after deletion");

		preferences.updatePreferences({
			personalization: { customWallpaperExt: "../../../../etc/passwd" },
		});
		assert.equal(preferences.getPreferences().personalization.customWallpaperExt, null);
		assert.equal(preferences.getWallpaperPath(), null);
		console.log("  ✔ getWallpaperPath() and removeCustomWallpaperFiles() function correctly");
	} finally {
		preferences.updatePreferences(origPrefs, { allowWallpaperExt: true });
		preferences.removeCustomWallpaperFiles();
	}

	// 2. HTTP Endpoint Integration Tests
	console.log("\n[Test Suite 2] Testing Settings & Personalization HTTP Endpoints");

	const JWT_SECRET = "test-jwt-secret-personalization";
	process.env.JWT_SECRET = JWT_SECRET;
	const TEST_PASSWORD = "test-personalization-password-123";
	process.env.PASSWORD = TEST_PASSWORD;

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
		// Log in to get auth token
		const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: TEST_PASSWORD }),
		});
		assert.equal(loginRes.status, 200, "Login must succeed");
		const tokenHeader = loginRes.headers.get("set-cookie");
		const authToken = extractCookieValue(tokenHeader, "token");
		assert.ok(authToken, "Auth token must be retrieved");
		const authHeaders = { Cookie: `token=${authToken}` };

		// 2a. GET /api/settings/preferences
		console.log("  [Test 2a] GET /api/settings/preferences");
		const getPrefsRes = await fetch(`${baseUrl}/api/settings/preferences`, {
			headers: authHeaders,
		});
		assert.equal(getPrefsRes.status, 200);
		const getPrefsData = await getPrefsRes.json();
		assert.equal(getPrefsData.status, "ok");
		assert.ok(getPrefsData.preferences);
		assert.ok(getPrefsData.preferences.personalization);
		console.log("    ✔ GET /api/settings/preferences returns status ok and preferences");

		// 2b. PUT /api/settings/preferences
		console.log("  [Test 2b] PUT /api/settings/preferences");
		const putPrefsRes = await fetch(`${baseUrl}/api/settings/preferences`, {
			method: "PUT",
			headers: {
				...authHeaders,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				personalization: {
					presetId: "cyberpunk-neon",
					fit: "fill",
				},
				customStoragePaths: ["/mnt/storage1"],
			}),
		});
		assert.equal(putPrefsRes.status, 200);
		const putPrefsData = await putPrefsRes.json();
		assert.equal(putPrefsData.status, "ok");
		assert.equal(putPrefsData.preferences.personalization.presetId, "cyberpunk-neon");
		assert.equal(putPrefsData.preferences.personalization.fit, "fill");
		assert.deepEqual(putPrefsData.preferences.customStoragePaths, ["/mnt/storage1"]);
		console.log("    ✔ PUT /api/settings/preferences updates and returns updated preferences");

		// 2c. GET /api/settings/wallpaper when none exists -> 404
		console.log("  [Test 2c] GET /api/settings/wallpaper with no wallpaper -> 404");
		preferences.removeCustomWallpaperFiles();
		preferences.updatePreferences({
			personalization: { hasCustomWallpaper: false, customWallpaperExt: null },
		});
		const notFoundRes = await fetch(`${baseUrl}/api/settings/wallpaper`, {
			headers: authHeaders,
		});
		assert.equal(notFoundRes.status, 404);
		console.log("    ✔ GET /api/settings/wallpaper returned 404 when no custom wallpaper set");

		// 2d. POST /api/settings/wallpaper rejection of invalid types
		console.log("  [Test 2d] POST /api/settings/wallpaper invalid mime rejection");
		const invalidFormData = new FormData();
		invalidFormData.append("file", new Blob(["fake text file content"], { type: "text/plain" }), "test.txt");
		const invalidRes = await fetch(`${baseUrl}/api/settings/wallpaper`, {
			method: "POST",
			headers: authHeaders,
			body: invalidFormData,
		});
		assert.equal(invalidRes.status, 400);
		console.log("    ✔ Invalid mime type correctly rejected with 400");

		// 2e. POST /api/settings/wallpaper with valid PNG file
		console.log("  [Test 2e] POST /api/settings/wallpaper with valid PNG");
		// 1x1 valid PNG buffer
		const pngBuffer = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
			"base64"
		);
		const pngFormData = new FormData();
		pngFormData.append("file", new Blob([pngBuffer], { type: "image/png" }), "my-wallpaper.png");
		const uploadRes = await fetch(`${baseUrl}/api/settings/wallpaper`, {
			method: "POST",
			headers: authHeaders,
			body: pngFormData,
		});
		assert.equal(uploadRes.status, 200);
		const uploadData = await uploadRes.json();
		assert.equal(uploadData.success, true);
		assert.ok(uploadData.url.startsWith("/api/settings/wallpaper?t="));

		// Verify preferences updated
		const prefsAfterUpload = preferences.getPreferences();
		assert.equal(prefsAfterUpload.personalization.hasCustomWallpaper, true);
		assert.equal(prefsAfterUpload.personalization.customWallpaperExt, "png");
		assert.equal(prefsAfterUpload.personalization.presetId, "cyberpunk-neon", "Other personalization fields preserved");

		// Verify file exists on disk
		const savedWallpaperPath = preferences.getWallpaperPath();
		assert.ok(savedWallpaperPath);
		assert.ok(savedWallpaperPath.endsWith(".png"));
		console.log("    ✔ Upload successful, preferences updated, file saved on disk");

		// 2f. GET /api/settings/wallpaper returns image stream with headers
		console.log("  [Test 2f] GET /api/settings/wallpaper retrieves custom wallpaper");
		const getWallpaperRes = await fetch(`${baseUrl}/api/settings/wallpaper`, {
			headers: authHeaders,
		});
		assert.equal(getWallpaperRes.status, 200);
		assert.equal(getWallpaperRes.headers.get("content-type"), "image/png");
		assert.equal(getWallpaperRes.headers.get("cache-control"), "private, max-age=86400");
		assert.equal(getWallpaperRes.headers.get("x-content-type-options"), "nosniff");
		const receivedBytes = Buffer.from(await getWallpaperRes.arrayBuffer());
		assert.deepEqual(receivedBytes, pngBuffer);
		console.log("    ✔ GET /api/settings/wallpaper streamed correct image with proper Content-Type & Cache-Control");

		// 2g. Overwrite existing wallpaper with WEBP
		console.log("  [Test 2g] POST /api/settings/wallpaper overwrites previous wallpaper");
		const webpBuffer = Buffer.from("RIFF2000WEBPVP8X", "utf8");
		const webpFormData = new FormData();
		webpFormData.append("file", new Blob([webpBuffer], { type: "image/webp" }), "bg.webp");
		const uploadWebpRes = await fetch(`${baseUrl}/api/settings/wallpaper`, {
			method: "POST",
			headers: authHeaders,
			body: webpFormData,
		});
		assert.equal(uploadWebpRes.status, 200);
		const prefsAfterWebp = preferences.getPreferences();
		assert.equal(prefsAfterWebp.personalization.hasCustomWallpaper, true);
		assert.equal(prefsAfterWebp.personalization.customWallpaperExt, "webp");

		// Check that old .png is gone and .webp is present
		assert.equal(fs.existsSync(savedWallpaperPath), false, "Old wallpaper.png must be deleted");
		const newWallpaperPath = preferences.getWallpaperPath();
		assert.ok(newWallpaperPath && newWallpaperPath.endsWith(".webp"), "New wallpaper.webp must exist");
		console.log("    ✔ Replacing wallpaper removes previous file and saves new format");

		// 2h. DELETE /api/settings/wallpaper
		console.log("  [Test 2h] DELETE /api/settings/wallpaper");
		const deleteRes = await fetch(`${baseUrl}/api/settings/wallpaper`, {
			method: "DELETE",
			headers: authHeaders,
		});
		assert.equal(deleteRes.status, 200);
		const deleteData = await deleteRes.json();
		assert.equal(deleteData.success, true);

		// Check preferences reset
		const prefsAfterDelete = preferences.getPreferences();
		assert.equal(prefsAfterDelete.personalization.hasCustomWallpaper, false);
		assert.equal(prefsAfterDelete.personalization.customWallpaperExt, null);
		assert.equal(preferences.getWallpaperPath(), null, "Wallpaper file removed from disk");

		// 2i. Subsequent GET returns 404
		const postDeleteGetRes = await fetch(`${baseUrl}/api/settings/wallpaper`, {
			headers: authHeaders,
		});
		assert.equal(postDeleteGetRes.status, 404);
		console.log("    ✔ DELETE /api/settings/wallpaper resets preferences, cleans file, subsequent GET returns 404");

	} finally {
		await new Promise((resolve) => testServer.close(resolve));
	}
} finally {
	try {
		fs.rmSync(testTmpDir, { recursive: true, force: true });
	} catch (_) {}
}

console.log("\n--- All Cross-Device Settings & Personalization Verification Tests Passed! ---");
