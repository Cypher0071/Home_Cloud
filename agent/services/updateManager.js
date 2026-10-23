const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { EventEmitter } = require("events");

const REPO = "Cypher0071/Home_Cloud";
const GITHUB_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function assertReleaseTag(tag) {
	if (typeof tag !== "string" || !RELEASE_TAG.test(tag)) {
		throw new Error("targetTag must be a semver release tag such as v1.0.1");
	}
}

async function assertTagAdvertised(tag) {
	const res = await runCommand("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
	const needle = `refs/tags/${tag}`;
	const advertised = String(res.stdout || "")
		.split("\n")
		.some((line) => {
			const ref = line.split("\t")[1] || "";
			return ref === needle;
		});
	if (!advertised) {
		throw new Error(`Tag ${tag} is not advertised by origin`);
	}
}

const rootDir = path.resolve(__dirname, "../..");

// In-memory cache variables
let cachedReleaseInfo = null;
let lastFetchTime = 0;
let isUpdating = false;
let updateError = null;
let lastProgress = null;

// Progress event emitter for SSE broadcast
const updateEmitter = new EventEmitter();
updateEmitter.setMaxListeners(100);

// Testing mocks / overrides
let customRunCommand = null;
let customFetch = null;

/**
 * Reads current version from root package.json or agent package.json
 */
function getCurrentVersion() {
	try {
		const rootPkgPath = path.resolve(rootDir, "package.json");
		if (fs.existsSync(rootPkgPath)) {
			const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
			if (pkg.version) return pkg.version;
		}
	} catch (_) {}

	try {
		const agentPkgPath = path.resolve(__dirname, "../package.json");
		if (fs.existsSync(agentPkgPath)) {
			const pkg = JSON.parse(fs.readFileSync(agentPkgPath, "utf8"));
			if (pkg.version) return pkg.version;
		}
	} catch (_) {}

	return "1.0.0";
}

/**
 * Returns short commit SHA via git rev-parse --short HEAD (with fallback)
 */
function getCurrentCommit() {
	try {
		const stdout = execSync("git rev-parse --short HEAD", {
			cwd: rootDir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return stdout.trim();
	} catch (_) {
		return process.env.GIT_COMMIT || "unknown";
	}
}

/**
 * Returns full commit SHA via git rev-parse HEAD (with fallback)
 */
function getCurrentFullCommit() {
	try {
		const stdout = execSync("git rev-parse HEAD", {
			cwd: rootDir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return stdout.trim();
	} catch (_) {
		return getCurrentCommit();
	}
}

/**
 * Parses semver string into { major, minor, patch, prerelease, raw }
 */
function parseSemver(v) {
	if (typeof v !== "string") return null;
	const clean = v.trim().replace(/^[vV]/, "");
	const [versionCore, prerelease] = clean.split("-");
	const parts = versionCore.split(".").map((n) => parseInt(n, 10));
	while (parts.length < 3) parts.push(0);
	if (parts.some((n) => isNaN(n))) return null;
	return {
		major: parts[0],
		minor: parts[1],
		patch: parts[2],
		prerelease: prerelease || null,
		raw: clean,
	};
}

/**
 * Compares two semantic version strings.
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
function compareSemver(v1, v2) {
	const p1 = parseSemver(v1);
	const p2 = parseSemver(v2);

	if (!p1 || !p2) {
		return String(v1).localeCompare(String(v2), undefined, { numeric: true });
	}

	if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
	if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
	if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;

	// Core versions are equal; non-prerelease is newer than prerelease
	if (!p1.prerelease && p2.prerelease) return 1;
	if (p1.prerelease && !p2.prerelease) return -1;
	if (p1.prerelease && p2.prerelease) {
		return p1.prerelease.localeCompare(p2.prerelease);
	}

	return 0;
}

/**
 * Checks for upstream releases from GitHub.
 * Caches release info for 24 hours unless force: true is passed.
 */
async function checkForUpdates({ force = false } = {}) {
	const currentVersion = getCurrentVersion();
	const currentCommit = getCurrentCommit();

	if (!force && cachedReleaseInfo && Date.now() - lastFetchTime < CACHE_TTL_MS) {
		return cachedReleaseInfo;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 10000);

	try {
		const fetchFn = customFetch || globalThis.fetch;
		const headers = {
			"User-Agent": "Home-Cloud-Agent",
			Accept: "application/vnd.github.v3+json",
		};
		if (process.env.GITHUB_TOKEN) {
			headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
		}

		const response = await fetchFn(GITHUB_API_URL, {
			headers,
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		// Handle 404 cleanly (repository has no releases published yet)
		if (response.status === 404) {
			const result = {
				currentVersion,
				currentCommit,
				latestVersion: currentVersion,
				tagName: null,
				name: null,
				updateAvailable: false,
				releaseNotes: "No releases found on upstream repository.",
				publishedAt: null,
				htmlUrl: null,
				lastChecked: new Date().toISOString(),
			};
			cachedReleaseInfo = result;
			lastFetchTime = Date.now();
			return result;
		}

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`GitHub API error ${response.status}: ${response.statusText} ${text}`.trim());
		}

		const data = await response.json();
		const tagName = data.tag_name || "";
		const version = tagName.replace(/^[vV]/, "");
		const name = data.name || tagName;
		const body = data.body || "";
		const publishedAt = data.published_at || "";
		const htmlUrl = data.html_url || "";

		const updateAvailable = compareSemver(version, currentVersion) > 0;

		const result = {
			currentVersion,
			currentCommit,
			latestVersion: version,
			tagName,
			name,
			updateAvailable,
			releaseNotes: body,
			publishedAt,
			htmlUrl,
			lastChecked: new Date().toISOString(),
		};

		cachedReleaseInfo = result;
		lastFetchTime = Date.now();
		return result;
	} catch (err) {
		clearTimeout(timeoutId);
		const errorMsg = err.name === "AbortError" ? "Request timed out after 10s" : err.message;

		if (cachedReleaseInfo) {
			return {
				...cachedReleaseInfo,
				error: errorMsg,
				lastChecked: new Date().toISOString(),
			};
		}

		return {
			currentVersion,
			currentCommit,
			latestVersion: null,
			tagName: null,
			updateAvailable: false,
			releaseNotes: null,
			publishedAt: null,
			htmlUrl: null,
			error: errorMsg,
			lastChecked: new Date().toISOString(),
		};
	}
}

/**
 * Executes a child process command using spawn, streaming output and returning a Promise.
 */
function runCommand(cmd, args, opts = {}, onLog = null) {
	if (customRunCommand) {
		return Promise.resolve(customRunCommand(cmd, args, opts, onLog));
	}

	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			cwd: opts.cwd || rootDir,
			...opts,
		});

		let stdout = "";
		let stderr = "";

		child.stdout?.on("data", (chunk) => {
			const text = chunk.toString();
			stdout += text;
			if (typeof onLog === "function") {
				onLog(text);
			}
		});

		child.stderr?.on("data", (chunk) => {
			const text = chunk.toString();
			stderr += text;
			if (typeof onLog === "function") {
				onLog(text);
			}
		});

		child.on("error", (err) => reject(err));

		child.on("close", (code) => {
			if (code !== 0) {
				const errMsg = (stderr || stdout).trim() || `Exit code ${code}`;
				const err = new Error(`Command "${cmd} ${args.join(" ")}" exited with code ${code}: ${errMsg}`);
				err.code = code;
				err.stdout = stdout;
				err.stderr = stderr;
				reject(err);
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
}

/**
 * Executes the complete update pipeline:
 * 1. Pre-flight checks (git status, conflict detection, disk space > 500MB)
 * 2. Capture rollback commit
 * 3. Fetch tags & checkout target tag or pull main
 * 4. Install dependencies (pnpm install --frozen-lockfile, fallback to pnpm install)
 * 5. Build dashboard & verify dist/index.html
 * 6. Finalize & schedule service restart
 */
async function applyUpdate(onProgress, options = {}) {
	if (isUpdating) {
		throw new Error("Update already in progress");
	}

	isUpdating = true;
	updateError = null;

	function emit(data) {
		const payload = {
			stage: data.stage || "update",
			message: data.message || "",
			progress: data.progress || data.stage || "",
			percent: typeof data.percent === "number" ? data.percent : 0,
			timestamp: new Date().toISOString(),
			...(data.error ? { error: data.error } : {}),
			...(data.completed ? { completed: true } : {}),
		};

		lastProgress = payload;

		if (typeof onProgress === "function") {
			try {
				onProgress(payload);
			} catch (_) {}
		}

		updateEmitter.emit("progress", payload);
	}

	let rollbackCommit = null;

	try {
		// Stage 1: Pre-flight checks
		emit({
			stage: "preflight",
			message: "Verifying repository status and disk space...",
			percent: 10,
		});

		// Check for ongoing git merge / rebase
		const gitDir = path.resolve(rootDir, ".git");
		if (fs.existsSync(path.join(gitDir, "MERGE_HEAD")) || fs.existsSync(path.join(gitDir, "REBASE_HEAD"))) {
			throw new Error("Git merge or rebase is currently in progress. Aborting update.");
		}

		// Check git status for unresolved conflicts
		try {
			const statusRes = await runCommand("git", ["status", "--porcelain"]);
			const conflictLines = statusRes.stdout
				.split("\n")
				.filter((l) => /^(DD|AU|UD|UA|DU|AA|UU)\s/.test(l.trim()));
			if (conflictLines.length > 0) {
				throw new Error("Git working tree contains unresolved conflicts.");
			}
		} catch (gitErr) {
			if (gitErr.message.includes("unresolved conflicts")) throw gitErr;
		}

		// Verify disk space (> 500MB)
		let freeBytes = 0;
		try {
			if (typeof fs.statfsSync === "function") {
				const stats = fs.statfsSync(rootDir);
				freeBytes = Number(stats.bavail) * Number(stats.bsize);
			}
		} catch (_) {}

		if (!freeBytes) {
			try {
				const dfRes = await runCommand("df", ["-Pk", rootDir]);
				const lines = dfRes.stdout.trim().split("\n");
				if (lines.length >= 2) {
					const parts = lines[1].trim().split(/\s+/);
					const availKb = parseInt(parts[3], 10);
					if (!isNaN(availKb)) freeBytes = availKb * 1024;
				}
			} catch (_) {}
		}

		const minSpaceBytes = 500 * 1024 * 1024; // 500MB
		if (freeBytes > 0 && freeBytes < minSpaceBytes) {
			const availMb = Math.round(freeBytes / (1024 * 1024));
			throw new Error(`Insufficient disk space: ${availMb}MB available, but at least 500MB is required.`);
		}

		// Stage 2: Capture rollback commit
		try {
			const revRes = await runCommand("git", ["rev-parse", "HEAD"]);
			rollbackCommit = revRes.stdout.trim();
		} catch (_) {
			rollbackCommit = getCurrentFullCommit();
		}

		// Stage 3: Fetch & Checkout
		emit({
			stage: "fetch",
			message: "Fetching updates and tags from origin...",
			percent: 30,
		});

		const targetTag = options.targetTag || cachedReleaseInfo?.tagName || "";
		if (!targetTag) {
			throw new Error("No release tag to apply. Refusing to update from floating main.");
		}
		assertReleaseTag(targetTag);

		await runCommand("git", ["fetch", "--tags", "origin"], {}, (chunk) => {
			const line = chunk.trim().split("\n").pop();
			if (line) emit({ stage: "fetch", message: line, percent: 35 });
		});
		await assertTagAdvertised(targetTag);

		emit({
			stage: "fetch",
			message: `Checking out release tag ${targetTag}...`,
			percent: 45,
		});
		await runCommand("git", ["checkout", "--detach", targetTag]);

		// Stage 4: Dependencies
		emit({
			stage: "install",
			message: "Installing project dependencies...",
			percent: 60,
		});

		try {
			await runCommand("pnpm", ["install", "--frozen-lockfile"], {}, (chunk) => {
				const line = chunk.trim().split("\n").pop();
				if (line) emit({ stage: "install", message: line, percent: 65 });
			});
		} catch (_) {
			emit({
				stage: "install",
				message: "Retrying dependency install with pnpm install...",
				percent: 68,
			});
			await runCommand("pnpm", ["install"], {}, (chunk) => {
				const line = chunk.trim().split("\n").pop();
				if (line) emit({ stage: "install", message: line, percent: 70 });
			});
		}

		// Stage 5: Build
		emit({
			stage: "build",
			message: "Building dashboard application...",
			percent: 80,
		});

		await runCommand("pnpm", ["--filter", "dashboard", "build"], {}, (chunk) => {
			const line = chunk.trim().split("\n").pop();
			if (line) emit({ stage: "build", message: line, percent: 85 });
		});

		const distHtml = path.resolve(rootDir, "dashboard/dist/index.html");
		if (!fs.existsSync(distHtml)) {
			throw new Error("Build verification failed: dashboard/dist/index.html was not generated.");
		}

		// Stage 6: Finalize & Restart trigger
		emit({
			stage: "restart",
			message: "Update applied successfully. Scheduling service restart in 2 seconds...",
			percent: 100,
			completed: true,
		});

		if (!options.skipRestart && process.env.NODE_ENV !== "test") {
			spawn(
				"bash",
				[
					"-c",
					"sleep 2 && (sudo systemctl restart home-cloud || systemctl restart home-cloud || pkill -f 'nodemon index.js' || true)",
				],
				{ detached: true, stdio: "ignore" }
			).unref();
		}

		isUpdating = false;
		updateError = null;
		return { success: true };
	} catch (err) {
		emit({
			stage: "rollback",
			message: `Update failed: ${err.message}. Rolling back...`,
			percent: 0,
			error: err.message,
		});

		if (rollbackCommit && rollbackCommit !== "unknown") {
			try {
				await runCommand("git", ["checkout", rollbackCommit]);
				emit({
					stage: "rollback",
					message: `Rollback completed to ${rollbackCommit.substring(0, 7)}.`,
					percent: 0,
				});
			} catch (rbErr) {
				console.error("[updateManager] Rollback failed:", rbErr.message);
			}
		}

		isUpdating = false;
		updateError = err.message;
		throw err;
	}
}

/**
 * Returns complete update status object
 */
function getUpdateStatus() {
	const currentVersion = getCurrentVersion();
	const currentCommit = getCurrentCommit();

	return {
		isUpdating,
		updateError,
		currentVersion,
		currentCommit,
		latestVersion: cachedReleaseInfo ? cachedReleaseInfo.latestVersion : null,
		tagName: cachedReleaseInfo ? cachedReleaseInfo.tagName : null,
		updateAvailable: cachedReleaseInfo ? cachedReleaseInfo.updateAvailable : false,
		releaseNotes: cachedReleaseInfo ? cachedReleaseInfo.releaseNotes : null,
		publishedAt: cachedReleaseInfo ? cachedReleaseInfo.publishedAt : null,
		htmlUrl: cachedReleaseInfo ? cachedReleaseInfo.htmlUrl : null,
		lastChecked: cachedReleaseInfo ? cachedReleaseInfo.lastChecked : null,
		lastProgress,
	};
}

function getLastProgress() {
	return lastProgress;
}

function _resetForTesting(state = {}) {
	cachedReleaseInfo = state.cachedReleaseInfo ?? null;
	lastFetchTime = state.lastFetchTime ?? 0;
	isUpdating = state.isUpdating ?? false;
	updateError = state.updateError ?? null;
	lastProgress = state.lastProgress ?? null;
	customRunCommand = null;
	customFetch = null;
}

function _setMockRunCommand(fn) {
	customRunCommand = fn;
}

function _setMockFetch(fn) {
	customFetch = fn;
}

module.exports = {
	REPO,
	GITHUB_API_URL,
	CACHE_TTL_MS,
	getCurrentVersion,
	getCurrentCommit,
	getCurrentFullCommit,
	parseSemver,
	compareSemver,
	checkForUpdates,
	applyUpdate,
	assertReleaseTag,
	getUpdateStatus,
	getLastProgress,
	isUpdating: () => isUpdating,
	runCommand,
	updateEmitter,
	_resetForTesting,
	_setMockRunCommand,
	_setMockFetch,
};
