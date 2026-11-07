/**
 * Keeps cloudflared at the version pinned by this Home Cloud release.
 *
 * The agent runs as a normal user, so it can't replace /usr/local/bin/cloudflared. Instead it
 * keeps its own copy in ~/.local/share/home-cloud/bin. On startup (which follows every Home Cloud
 * update), if the newest cloudflared it can find is older than the pin, it downloads the pinned
 * release, checks it against the SHA256 published by Cloudflare, installs it atomically and
 * restarts the tunnel on it. Bumping CLOUDFLARED_VERSION in a release is how cloudflared updates.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

// Keep in sync with CLOUDFLARED_VERSION and the hashes in setup.sh (agent/tests/verify_cloudflared_binary.mjs checks).
// Hashes from https://github.com/cloudflare/cloudflared/releases/tag/2026.10.7
const CLOUDFLARED_VERSION = "2026.10.7";
const CLOUDFLARED_SHA256 = {
	"cloudflared-linux-amd64": "1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872",
	"cloudflared-linux-arm64": "3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775",
	"cloudflared-linux-arm": "74f690f6707182839b63e0465726c7776dd63f0a174390b911d5d71f35cab94e",
	"cloudflared-linux-386": "4823d2f038395617e04e4070601ab45c0c43f31f15ee7586be299e19ef49d46e",
};

const ARCH_ASSETS = { x64: "cloudflared-linux-amd64", arm64: "cloudflared-linux-arm64", arm: "cloudflared-linux-arm", ia32: "cloudflared-linux-386" };
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

function managedBinaryPath(home = os.homedir()) {
	return path.join(home, ".local", "share", "home-cloud", "bin", "cloudflared");
}

// The binary the tunnel and ingress validation run. Plain "cloudflared" means the one on PATH.
let activePath = "cloudflared";

function getCloudflaredPath() {
	return activePath;
}

/** "cloudflared version 2026.9.3 (built ...)" -> "2026.9.3" */
function parseCloudflaredVersion(output) {
	const m = String(output || "").match(/version\s+(\d+\.\d+\.\d+)/);
	return m ? m[1] : null;
}

function compareVersions(a, b) {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
	}
	return 0;
}

function readVersion(binary) {
	try {
		const out = execFileSync(binary, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 });
		return parseCloudflaredVersion(out);
	} catch {
		return null;
	}
}

async function downloadVerified(asset, fetchFn) {
	const url = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset}`;
	const res = await fetchFn(url, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`download of ${asset} failed with HTTP ${res.status}`);
	const body = Buffer.from(await res.arrayBuffer());
	const actual = crypto.createHash("sha256").update(body).digest("hex");
	if (actual !== CLOUDFLARED_SHA256[asset]) {
		throw new Error(`SHA256 mismatch for ${asset} ${CLOUDFLARED_VERSION}: got ${actual}`);
	}
	return body;
}

function installAtomic(body, dest) {
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
	try {
		fs.writeFileSync(tmp, body, { mode: 0o755 });
		fs.renameSync(tmp, dest);
	} catch (err) {
		fs.rmSync(tmp, { force: true });
		throw err;
	}
}

/**
 * Points the tunnel at the newest cloudflared available: the managed copy or the one on PATH
 * (so an apt upgrade past the pin is used too). Fast and synchronous; call before starting the tunnel.
 */
function selectCloudflared({ managedPath = managedBinaryPath(), versionOf = readVersion } = {}) {
	const candidates = [
		{ path: managedPath, version: fs.existsSync(managedPath) ? versionOf(managedPath) : null },
		{ path: "cloudflared", version: versionOf("cloudflared") },
	].filter((c) => c.version);
	candidates.sort((a, b) => compareVersions(b.version, a.version));
	const best = candidates[0] || null;
	if (best) activePath = best.path;
	return best;
}

/**
 * When the selected cloudflared is older than the pin, installs the pinned release as the
 * managed copy. Returns { path, version, updated, previousPath, previousVersion }. Never throws: on failure
 * the existing binary keeps working and `error` says why.
 */
async function ensureCloudflared({
	fetchFn = globalThis.fetch,
	arch = process.arch,
	platform = process.platform,
	managedPath = managedBinaryPath(),
	versionOf = readVersion,
	install = installAtomic,
	log = console,
} = {}) {
	const best = selectCloudflared({ managedPath, versionOf });

	const result = { path: activePath, version: best?.version ?? null, updated: false, previousPath: activePath, previousVersion: best?.version ?? null };
	if (!best) {
		// No cloudflared at all means the tunnel was never set up; don't install one uninvited.
		return result;
	}
	if (compareVersions(best.version, CLOUDFLARED_VERSION) >= 0) return result;

	const asset = platform === "linux" ? ARCH_ASSETS[arch] : null;
	if (!asset) {
		return { ...result, error: `no pinned cloudflared build for ${platform}/${arch}` };
	}
	try {
		log.log?.(`[cloudflared] ${best.version} is older than ${CLOUDFLARED_VERSION}; downloading ${asset}...`);
		const body = await downloadVerified(asset, fetchFn);
		install(body, managedPath);
		const installed = versionOf(managedPath);
		if (installed !== CLOUDFLARED_VERSION) {
			throw new Error(`installed binary reports version ${installed ?? "unknown"}`);
		}
		activePath = managedPath;
		log.log?.(`[cloudflared] Updated ${best.version} -> ${CLOUDFLARED_VERSION} at ${managedPath}`);
		return { path: managedPath, version: CLOUDFLARED_VERSION, updated: true, previousPath: result.previousPath, previousVersion: best.version };
	} catch (err) {
		log.warn?.(`[cloudflared] Update to ${CLOUDFLARED_VERSION} failed, keeping ${best.version}: ${err.message}`);
		return { ...result, error: err.message };
	}
}

module.exports = {
	CLOUDFLARED_VERSION,
	CLOUDFLARED_SHA256,
	managedBinaryPath,
	getCloudflaredPath,
	selectCloudflared,
	parseCloudflaredVersion,
	compareVersions,
	ensureCloudflared,
	setCloudflaredPath: (p) => { activePath = p; },
};
