import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const updateManager = require("../services/updateManager.js");
const settingsRouter = require("../routes/settings.js");

console.log("🧪 Testing Auto-Update Engine and Settings API Endpoints...\n");

// Ensure clean state before tests
updateManager._resetForTesting();

// -------------------------------------------------------------
// [Test Suite 1] Semver Parsing & Comparison
// -------------------------------------------------------------
console.log("[Test Suite 1] Semver Parsing & Comparison");

assert.equal(updateManager.compareSemver("1.0.1", "1.0.0"), 1, "1.0.1 should be newer than 1.0.0");
assert.equal(updateManager.compareSemver("1.0.0", "1.0.1"), -1, "1.0.0 should be older than 1.0.1");
assert.equal(updateManager.compareSemver("1.0.0", "1.0.0"), 0, "Identical versions should be equal");
assert.equal(updateManager.compareSemver("2.0.0", "1.99.99"), 1, "Major version bump should be newer");
assert.equal(updateManager.compareSemver("1.10.0", "1.2.0"), 1, "1.10.0 should be newer than 1.2.0 (numeric)");
assert.equal(updateManager.compareSemver("v1.5.0", "1.4.9"), 1, "Leading 'v' should be handled cleanly");
assert.equal(updateManager.compareSemver("1.0.0", "1.0.0-beta.1"), 1, "Final release should be newer than prerelease");

const parsed = updateManager.parseSemver("v2.4.11");
assert.equal(parsed.major, 2);
assert.equal(parsed.minor, 4);
assert.equal(parsed.patch, 11);

console.log("  ✔ Semver comparison correctly identifies newer, older, and equivalent versions");

// -------------------------------------------------------------
// [Test Suite 2] Version & Commit Detection
// -------------------------------------------------------------
console.log("\n[Test Suite 2] Version & Commit Detection");

const currentVersion = updateManager.getCurrentVersion();
assert.ok(typeof currentVersion === "string" && currentVersion.length > 0, "Current version must be a non-empty string");
assert.equal(currentVersion, "1.0.0", "Root package.json version is 1.0.0");

const currentCommit = updateManager.getCurrentCommit();
assert.ok(typeof currentCommit === "string" && currentCommit.length > 0, "Current commit must be detected");
console.log(`  ✔ Detected version: ${currentVersion}, commit: ${currentCommit}`);

// -------------------------------------------------------------
// [Test Suite 3] Upstream Update Checks & 24h Cache TTL
// -------------------------------------------------------------
console.log("\n[Test Suite 3] Upstream Update Checks & Cache TTL");

let fetchCallCount = 0;
let mockResponseData = {
	tag_name: "v1.2.0",
	name: "Release 1.2.0: Major Performance Boost",
	body: "### Changes\n- Optimized caching\n- New dashboard",
	published_at: "2026-10-20T12:00:00Z",
	html_url: "https://github.com/Cypher0071/Home_Cloud/releases/tag/v1.2.0",
};

updateManager._setMockFetch(async () => {
	fetchCallCount++;
	return {
		ok: true,
		status: 200,
		json: async () => mockResponseData,
	};
});

// 3a. Initial check should call fetch and find update
const check1 = await updateManager.checkForUpdates();
assert.equal(fetchCallCount, 1, "Fetch should be called once on first check");
assert.equal(check1.updateAvailable, true, "1.2.0 should trigger updateAvailable: true against 1.0.0");
assert.equal(check1.latestVersion, "1.2.0", "Version tag 'v' should be stripped");
assert.equal(check1.tagName, "v1.2.0");
assert.equal(check1.releaseNotes, mockResponseData.body);

// 3b. Second check within TTL should hit cache and NOT call fetch
const check2 = await updateManager.checkForUpdates();
assert.equal(fetchCallCount, 1, "Fetch should not be called again within cache TTL");
assert.equal(check2.latestVersion, "1.2.0");

// 3c. Forced check should bypass cache
const check3 = await updateManager.checkForUpdates({ force: true });
assert.equal(fetchCallCount, 2, "Force: true must bypass cache and query upstream");

// 3d. Upstream 404 handling (repository with no releases)
updateManager._resetForTesting();
updateManager._setMockFetch(async () => ({
	ok: false,
	status: 404,
	statusText: "Not Found",
}));

const check404 = await updateManager.checkForUpdates({ force: true });
assert.equal(check404.updateAvailable, false, "404 should result in updateAvailable: false");
assert.equal(check404.error, undefined, "404 is handled gracefully without error");

// 3e. Network / Timeout failure fallback
updateManager._resetForTesting();
updateManager._setMockFetch(async () => {
	throw new Error("Connection refused (offline)");
});

const checkErr = await updateManager.checkForUpdates({ force: true });
assert.equal(checkErr.updateAvailable, false);
assert.ok(checkErr.error.includes("Connection refused"), "Should gracefully capture error message");

console.log("  ✔ Cache TTL, upstream release parsing, 404 handling, and error fallbacks verified");

// -------------------------------------------------------------
// [Test Suite 4] getUpdateStatus Method
// -------------------------------------------------------------
console.log("\n[Test Suite 4] getUpdateStatus Method");

updateManager._resetForTesting({
	cachedReleaseInfo: {
		currentVersion: "1.0.0",
		currentCommit: "abc1234",
		latestVersion: "1.0.5",
		tagName: "v1.0.5",
		updateAvailable: true,
		releaseNotes: "Fixes",
		publishedAt: "2026-10-20T00:00:00Z",
		htmlUrl: "https://github.com/...",
		lastChecked: "2026-10-20T12:00:00Z",
	},
	isUpdating: false,
	updateError: null,
});

const status = updateManager.getUpdateStatus();
assert.equal(status.isUpdating, false);
assert.equal(status.updateAvailable, true);
assert.equal(status.latestVersion, "1.0.5");
assert.equal(status.tagName, "v1.0.5");
assert.equal(status.currentVersion, "1.0.0");

console.log("  ✔ getUpdateStatus accurately reflects cache and runtime state");

// -------------------------------------------------------------
// [Test Suite 5] Update Execution Pipeline (applyUpdate)
// -------------------------------------------------------------
console.log("\n[Test Suite 5] Update Pipeline Execution & Rollback");

// 5a. Concurrent update guard
updateManager._resetForTesting({ isUpdating: true });
await assert.rejects(
	async () => updateManager.applyUpdate(),
	/Update already in progress/,
	"applyUpdate must throw if an update is already in progress"
);
console.log("  ✔ Concurrent update guard successfully blocks double updates");

// 5b. Successful pipeline execution with progress events
updateManager._resetForTesting();
const executedCommands = [];
const progressEvents = [];

updateManager._setMockRunCommand(async (cmd, args) => {
	executedCommands.push(`${cmd} ${args.join(" ")}`);
	if (cmd === "git" && args[0] === "status") {
		return { stdout: "", stderr: "" };
	}
	if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
		return { stdout: "initial-commit-sha-12345\n", stderr: "" };
	}
	if (cmd === "df") {
		return { stdout: "Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/sda1 10000000 1000000 9000000 10% /\n", stderr: "" };
	}
	return { stdout: "ok", stderr: "" };
});

const result = await updateManager.applyUpdate(
	(p) => progressEvents.push(p),
	{ targetTag: "v1.1.0", skipRestart: true }
);

assert.equal(result.success, true, "Pipeline should return success: true");
assert.equal(updateManager.isUpdating(), false, "isUpdating should reset to false upon completion");

// Verify stage progression
const stages = progressEvents.map((e) => e.stage);
assert.ok(stages.includes("preflight"), "Should pass preflight stage");
assert.ok(stages.includes("fetch"), "Should pass fetch stage");
assert.ok(stages.includes("install"), "Should pass install stage");
assert.ok(stages.includes("build"), "Should pass build stage");
assert.ok(stages.includes("restart"), "Should pass restart stage");

// Verify commands invoked
assert.ok(executedCommands.some((c) => c.includes("git fetch --tags origin")));
assert.ok(executedCommands.some((c) => c.includes("git checkout v1.1.0")));
assert.ok(executedCommands.some((c) => c.includes("pnpm install --frozen-lockfile")));
assert.ok(executedCommands.some((c) => c.includes("pnpm --filter dashboard build")));
console.log("  ✔ Pipeline successfully progresses through preflight, fetch, install, build, and restart");

// 5c. Pipeline failure with Auto-Rollback
updateManager._resetForTesting();
const rollbackEvents = [];
const rollbackCommands = [];

updateManager._setMockRunCommand(async (cmd, args) => {
	rollbackCommands.push(`${cmd} ${args.join(" ")}`);
	if (cmd === "git" && args[0] === "status") return { stdout: "", stderr: "" };
	if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
		return { stdout: "safe-rollback-sha-9999\n", stderr: "" };
	}
	if (cmd === "pnpm" && args[1] === "dashboard") {
		throw new Error("Syntax error in dashboard build");
	}
	return { stdout: "ok", stderr: "" };
});

await assert.rejects(
	async () => updateManager.applyUpdate((p) => rollbackEvents.push(p), { targetTag: "v1.2.0", skipRestart: true }),
	/Syntax error in dashboard build/,
	"applyUpdate must re-throw failure error"
);

assert.equal(updateManager.isUpdating(), false, "isUpdating must be reset on failure");
assert.ok(updateManager.getUpdateStatus().updateError.includes("Syntax error in dashboard build"), "updateError must be recorded");

// Verify rollback command was executed
assert.ok(
	rollbackCommands.some((c) => c === "git checkout safe-rollback-sha-9999"),
	"Git rollback to initial commit must be triggered"
);

const rollbackStage = rollbackEvents.find((e) => e.stage === "rollback");
assert.ok(rollbackStage, "Rollback event should be emitted to onProgress");
console.log("  ✔ Pipeline auto-rollback triggers on build failure and restores commit state");

// -------------------------------------------------------------
// [Test Suite 6] Settings API Endpoints Integration
// -------------------------------------------------------------
console.log("\n[Test Suite 6] Settings API HTTP & SSE Endpoints");

const app = express();
app.use(express.json());
app.use("/api/settings", settingsRouter);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/api/settings`;

try {
	// 6a. GET /api/settings/update/status
	updateManager._resetForTesting();
	const resStatus = await fetch(`${baseUrl}/update/status`);
	assert.equal(resStatus.status, 200);
	const dataStatus = await resStatus.json();
	assert.equal(dataStatus.status, "ok");
	assert.equal(dataStatus.currentVersion, "1.0.0");
	assert.equal(dataStatus.isUpdating, false);
	console.log("  ✔ GET /api/settings/update/status returns 200 with status payload");

	// 6b. POST /api/settings/update/check
	updateManager._setMockFetch(async () => ({
		ok: true,
		status: 200,
		json: async () => ({
			tag_name: "v2.0.0",
			name: "Version 2.0.0",
			body: "Exciting release",
			published_at: "2026-10-20T00:00:00Z",
			html_url: "https://github.com/...",
		}),
	}));

	const resCheck = await fetch(`${baseUrl}/update/check`, { method: "POST" });
	assert.equal(resCheck.status, 200);
	const dataCheck = await resCheck.json();
	assert.equal(dataCheck.status, "ok");
	assert.equal(dataCheck.latestVersion, "2.0.0");
	assert.equal(dataCheck.updateAvailable, true);
	console.log("  ✔ POST /api/settings/update/check returns 200 with checked release info");

	// 6c. POST /api/settings/update/apply (Success 202)
	updateManager._resetForTesting();
	// Mock runCommand to be fast
	updateManager._setMockRunCommand(async (cmd, args) => {
		if (cmd === "git" && args[0] === "status") return { stdout: "", stderr: "" };
		if (cmd === "git" && args[0] === "rev-parse") return { stdout: "test-commit\n", stderr: "" };
		return { stdout: "ok", stderr: "" };
	});

	const resApply = await fetch(`${baseUrl}/update/apply`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ targetTag: "v2.0.0" }),
	});
	assert.equal(resApply.status, 202);
	const dataApply = await resApply.json();
	assert.equal(dataApply.status, "ok");
	assert.equal(dataApply.message, "Update initiated successfully");
	console.log("  ✔ POST /api/settings/update/apply returns 202 Accepted");

	// 6d. POST /api/settings/update/apply (Conflict 409 when already updating)
	updateManager._resetForTesting({ isUpdating: true });
	const resConflict = await fetch(`${baseUrl}/update/apply`, { method: "POST" });
	assert.equal(resConflict.status, 409);
	const dataConflict = await resConflict.json();
	assert.ok(dataConflict.error.includes("already in progress"));
	console.log("  ✔ POST /api/settings/update/apply returns 409 Conflict when update in progress");

	// 6e. GET /api/settings/update/progress (SSE stream)
	updateManager._resetForTesting();
	const controller = new AbortController();
	const resProgress = await fetch(`${baseUrl}/update/progress`, {
		signal: controller.signal,
	});

	assert.equal(resProgress.status, 200);
	assert.equal(resProgress.headers.get("content-type"), "text/event-stream");
	assert.equal(resProgress.headers.get("cache-control"), "no-cache");
	assert.equal(resProgress.headers.get("connection"), "keep-alive");

	const reader = resProgress.body.getReader();
	const decoder = new TextDecoder();

	// Read initial SSE message
	const { value } = await reader.read();
	const initialChunk = decoder.decode(value);
	assert.ok(initialChunk.startsWith("data: "), "SSE chunk must start with 'data: '");
	const parsedInitial = JSON.parse(initialChunk.replace("data: ", "").trim());
	assert.ok(parsedInitial.stage, "Initial progress must include a stage");

	// Emit another progress event and verify SSE receives it
	updateManager.updateEmitter.emit("progress", {
		stage: "install",
		message: "Installing node packages...",
		percent: 60,
	});

	const nextRead = await reader.read();
	const nextChunk = decoder.decode(nextRead.value);
	assert.ok(nextChunk.includes('"stage":"install"'));
	assert.ok(nextChunk.includes('"percent":60'));

	controller.abort();
	console.log("  ✔ GET /api/settings/update/progress streams SSE events properly");
} finally {
	await new Promise((resolve) => server.close(resolve));
}

console.log("\n🎉 All Auto-Update Engine Verification Tests Passed Successfully!");
