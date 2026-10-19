import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
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
const homeDir = os.homedir();
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

// Reset preferences to default safe server mode
preferences.updatePreferences({ allowSystemRoot: false, customStoragePaths: [] });
console.log("\n✅ All Storage Scope & System Root Access backend tests passed successfully!\n");
