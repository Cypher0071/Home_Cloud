import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createRequire } from "node:module";

const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "home-cloud-scope-test-"));
process.env.HOME = testTmpDir;
process.env.HOME_CLOUD_CONFIG_DIR = path.join(testTmpDir, ".config", "home-cloud");
process.env.AGENT_ENV_FILE = path.join(testTmpDir, ".env");
process.env.CF_CONFIG = path.join(testTmpDir, ".cloudflared", "config.yml");
process.env.BASE_DIR = testTmpDir;

const require = createRequire(import.meta.url);
const express = require("express");
const preferences = require("../services/preferences.js");
const paths = require("../paths.js");
const settingsRouter = require("../routes/settings.js");
const filesRouter = require("../routes/file.js");

console.log("🧪 Testing Storage Scope & System Root Access Mode...");

// Reset preferences before test
preferences._resetForTesting({ allowSystemRoot: false, customStoragePaths: [] });

// 1. Test Virtual FS detection
console.log("\n[Test 1] Virtual Kernel Filesystem Blocking");
assert.equal(paths.isVirtualFs("/proc"), true, "/proc must be identified as virtual fs");
assert.equal(paths.isVirtualFs("/proc/cpuinfo"), true, "/proc/* must be identified as virtual fs");
assert.equal(paths.isVirtualFs("/sys"), true, "/sys must be identified as virtual fs");
assert.equal(paths.isVirtualFs("/sys/class/net"), true, "/sys/* must be identified as virtual fs");
assert.equal(paths.isVirtualFs("/dev"), true, "/dev must be identified as virtual fs");
assert.equal(paths.isVirtualFs("/dev/null"), true, "/dev/* must be identified as virtual fs");
assert.equal(paths.isVirtualFs(os.homedir()), false, "Home dir is not virtual fs");
assert.equal(paths.isVirtualFs("/etc"), false, "/etc is not virtual fs");
console.log("  ✔ Virtual filesystem paths (/proc, /sys, /dev) correctly blocked");

// 2. Test Safe Server Mode (allowSystemRoot = false)
console.log("\n[Test 2] Safe Server Mode Scoping (allowSystemRoot = false)");
preferences._resetForTesting({ allowSystemRoot: false, customStoragePaths: [] });
const homeDir = testTmpDir;
assert.equal(paths.BASE_DIR, testTmpDir, "Test storage root must use the isolated temporary directory");
assert.equal(paths.isInsideAllowedScope(homeDir), true, "Home dir must be allowed");
assert.equal(paths.isInsideAllowedScope(path.join(homeDir, "documents")), true, "Subpath in home must be allowed");
assert.equal(paths.isInsideAllowedScope("/mnt/storage"), true, "Mounted drive (/mnt/*) must be allowed");
assert.equal(paths.isInsideAllowedScope("/media/usb"), true, "Removable media (/media/*) must be allowed");
assert.equal(paths.isInsideAllowedScope("/srv/data"), true, "Server storage (/srv/*) must be allowed");

// Core system dirs must be blocked under safe server mode
assert.equal(paths.isInsideAllowedScope("/etc"), false, "/etc must be blocked when allowSystemRoot is false");
assert.equal(paths.isInsideAllowedScope("/var/log"), false, "/var/log must be blocked when allowSystemRoot is false");
assert.equal(paths.isInsideAllowedScope("/"), false, "/ must be blocked when allowSystemRoot is false");
assert.equal(paths.isInsideAllowedScope("/proc"), false, "/proc must always be blocked");
console.log("  ✔ Safe Server Mode correctly permits home and storage mounts, while blocking system root");

// 3. Test Full System Root Mode (allowSystemRoot = true)
console.log("\n[Test 3] Full System Root Mode Scoping (allowSystemRoot = true)");
preferences._resetForTesting({ allowSystemRoot: true, customStoragePaths: [] });
assert.equal(paths.isInsideAllowedScope("/etc"), true, "/etc must be allowed when allowSystemRoot is true");
assert.equal(paths.isInsideAllowedScope("/var/log"), true, "/var/log must be allowed when allowSystemRoot is true");
assert.equal(paths.isInsideAllowedScope("/"), true, "System root / must be allowed when allowSystemRoot is true");
assert.equal(paths.isInsideAllowedScope(homeDir), true, "Home dir remains allowed");
assert.equal(paths.isInsideAllowedScope("/mnt/storage"), true, "/mnt remains allowed");

// Virtual kernel filesystems must STILL be blocked even in root mode
assert.equal(paths.isInsideAllowedScope("/proc"), false, "/proc must remain blocked in root mode");
assert.equal(paths.isInsideAllowedScope("/sys"), false, "/sys must remain blocked in root mode");
assert.equal(paths.isInsideAllowedScope("/dev"), false, "/dev must remain blocked in root mode");
console.log("  ✔ Full System Root Mode correctly opens system tree while preserving virtual fs safeguards");

// 4. Test Preferences Service & Custom Storage Paths
console.log("\n[Test 4] Preferences Service & Custom Storage Paths");
preferences._resetForTesting(null);
const initialPrefs = preferences.getPreferences();
assert.equal(typeof initialPrefs.allowSystemRoot, "boolean");

const updatedPrefs = preferences.updatePreferences({
	allowSystemRoot: true,
	customStoragePaths: ["/opt/my-storage"],
});
assert.equal(updatedPrefs.allowSystemRoot, true);
assert.deepEqual(updatedPrefs.customStoragePaths, ["/opt/my-storage"]);
assert.equal(paths.isInsideAllowedScope("/opt/my-storage"), true);

// 5. Test Settings Route Handler
console.log("\n[Test 5] Settings API Endpoint Contract");
let storageGetPayload = null;
const mockGetReq = {};
const mockGetRes = {
	json(data) {
		storageGetPayload = data;
	},
	status() {
		return this;
	},
};
// Find GET /storage handler on settingsRouter
const getLayer = settingsRouter.stack.find(
	(l) => l.route && l.route.path === "/storage" && l.route.methods.get,
);
assert.ok(getLayer, "GET /storage route must be registered");
getLayer.route.stack[0].handle(mockGetReq, mockGetRes);
assert.equal(storageGetPayload.status, "ok");
assert.equal(storageGetPayload.baseDir, paths.BASE_DIR);
assert.equal(typeof storageGetPayload.allowSystemRoot, "boolean");
console.log("  ✔ GET /api/settings/storage returned expected schema");

// 6. Test GET /api/files/view active content prevention (P1-2)
console.log("\n[Test 6] File View Active Content Prevention (P1-2)");
const viewLayer = filesRouter.stack.find(
	(l) => l.route && l.route.path === "/view" && l.route.methods.get,
);
assert.ok(viewLayer, "GET /view route must be registered");

const testHtml = path.join(homeDir, "test.html");
const testSvg = path.join(homeDir, "test.svg");
const testPng = path.join(homeDir, "test.png");
const hiddenDir = path.join(testTmpDir, ".hidden");
const hiddenHtml = path.join(hiddenDir, "test-hidden.html");
fs.mkdirSync(hiddenDir, { recursive: true });
fs.writeFileSync(testHtml, "<html><script>alert(1)</script></html>", "utf8");
fs.writeFileSync(testSvg, "<svg><script>alert(1)</script></svg>", "utf8");
fs.writeFileSync(testPng, "fake-png-bytes", "utf8");
fs.writeFileSync(hiddenHtml, "<html>hidden fixture</html>", "utf8");

try {
	function callViewRoute(filePath) {
		const headers = {};
		let sentFile = null;
		let sentFileOptions = null;
		const req = { query: { path: filePath } };
		const res = {
			setHeader(k, v) { headers[k.toLowerCase()] = v; },
			sendFile(p, options) { sentFile = p; sentFileOptions = options; },
			status(s) { this.statusCode = s; return this; },
			json(d) { this.body = d; },
		};
		viewLayer.route.stack[0].handle(req, res);
		return { headers, sentFile, sentFileOptions };
	}

	const htmlRes = callViewRoute(testHtml);
	assert.equal(htmlRes.headers["content-disposition"], "attachment", "HTML must be served as attachment");
	assert.equal(htmlRes.headers["content-type"], "application/octet-stream", "HTML must not be served as text/html");
	assert.equal(htmlRes.headers["x-content-type-options"], "nosniff");
	assert.equal(htmlRes.sentFileOptions.dotfiles, "allow", "the validated in-scope path may contain hidden directories");

	const svgRes = callViewRoute(testSvg);
	assert.equal(svgRes.headers["content-disposition"], "attachment", "SVG must be served as attachment");
	assert.equal(svgRes.headers["content-type"], "application/octet-stream", "SVG must not be served as image/svg+xml");
	assert.equal(svgRes.headers["x-content-type-options"], "nosniff");

	const pngRes = callViewRoute(testPng);
	assert.equal(pngRes.headers["content-disposition"], "inline", "PNG images may be served inline");
	assert.equal(pngRes.headers["content-type"], "image/png");
	assert.equal(pngRes.headers["x-content-type-options"], "nosniff");

	const testApp = express();
	testApp.use("/api/files", filesRouter);
	const testServer = http.createServer(testApp);
	await new Promise((resolve) => testServer.listen(0, "127.0.0.1", resolve));
	try {
		const baseUrl = `http://127.0.0.1:${testServer.address().port}/api/files/view?path=`;
		for (const [filePath, disposition, contentType] of [
			[testHtml, "attachment", "application/octet-stream"],
			[testSvg, "attachment", "application/octet-stream"],
			[testPng, "inline", "image/png"],
			[hiddenHtml, "attachment", "application/octet-stream"],
		]) {
			const response = await fetch(`${baseUrl}${encodeURIComponent(filePath)}`);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("content-disposition"), disposition);
			assert.equal(response.headers.get("content-type")?.split(";")[0], contentType);
			assert.equal(response.headers.get("x-content-type-options"), "nosniff");
		}
		const missingResponse = await fetch(`${baseUrl}${encodeURIComponent(path.join(homeDir, "missing.html"))}`);
		assert.equal(missingResponse.status, 404, "missing files must return an HTTP error, not an unhandled rejection");
		assert.deepEqual(await missingResponse.json(), { error: "File not found" });
	} finally {
		await new Promise((resolve) => testServer.close(resolve));
	}

	console.log("  ✔ HTTP file-view responses safely serve active content and return 404 for missing files");
} finally {
	try { fs.unlinkSync(testHtml); } catch (_) {}
	try { fs.unlinkSync(testSvg); } catch (_) {}
	try { fs.unlinkSync(testPng); } catch (_) {}
	try { fs.unlinkSync(hiddenHtml); } catch (_) {}
	try { fs.rmdirSync(hiddenDir); } catch (_) {}
}

// Reset preferences to default safe server mode
preferences.updatePreferences({ allowSystemRoot: false, customStoragePaths: [] });
try {
	fs.rmSync(testTmpDir, { recursive: true, force: true });
} catch (_) {}
console.log("\n✅ All Storage Scope & System Root Access backend tests passed successfully!\n");
