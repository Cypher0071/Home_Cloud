import assert from "node:assert/strict";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const cf = require("../services/cloudflaredBinary.js");
const {
	CLOUDFLARED_VERSION,
	CLOUDFLARED_SHA256,
	parseCloudflaredVersion,
	compareVersions,
	ensureCloudflared,
	selectCloudflared,
	getCloudflaredPath,
	setCloudflaredPath,
} = cf;

console.log("--- Running Managed cloudflared Tests ---");

assert.equal(parseCloudflaredVersion("cloudflared version 2026.10.7 (built 2026-10-30-17:05 UTC)"), "2026.10.7");
assert.equal(parseCloudflaredVersion("garbage"), null);
assert.equal(compareVersions("2026.9.3", "2026.10.7"), -1, "numeric, not string, compare");
assert.equal(compareVersions("2026.10.7", "2026.10.7"), 0);
console.log("  ✔ parses and compares cloudflared versions");

// setup.sh and the agent must pin the same version and binary hashes.
{
	const setup = fs.readFileSync(new URL("../../setup.sh", import.meta.url), "utf8");
	assert.equal(setup.match(/^CLOUDFLARED_VERSION="([^"]+)"/m)?.[1], CLOUDFLARED_VERSION);
	for (const [asset, hash] of Object.entries(CLOUDFLARED_SHA256)) {
		assert.ok(setup.includes(`${CLOUDFLARED_VERSION}:${asset}) expected="${hash}" ;;`), `setup.sh hash for ${asset} differs`);
	}
	console.log("  ✔ setup.sh and the agent pin the same cloudflared build");
}

const quiet = { log() {}, warn() {} };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hc-cloudflared-"));
const managedPath = path.join(tmp, "bin", "cloudflared");
const asset = "cloudflared-linux-amd64";

// Fakes: the "binary" is a text file holding its version; --version reads it back.
const versions = new Map();
const versionOf = (p) => (p === managedPath ? (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null) : versions.get(p) ?? null);
const goodBody = Buffer.from(CLOUDFLARED_VERSION);
const realHash = CLOUDFLARED_SHA256[asset];
function fetchReturning(body, { status = 200 } = {}) {
	const calls = [];
	const fn = async (url) => {
		calls.push(url);
		return { ok: status === 200, status, arrayBuffer: async () => body };
	};
	fn.calls = calls;
	return fn;
}
// The test body isn't the real binary, so point the pinned hash at it for the happy path.
function withHash(hash, fn) {
	const prev = CLOUDFLARED_SHA256[asset];
	CLOUDFLARED_SHA256[asset] = hash;
	return fn().finally(() => { CLOUDFLARED_SHA256[asset] = prev; });
}
const goodHash = crypto.createHash("sha256").update(goodBody).digest("hex");
const base = { arch: "x64", platform: "linux", managedPath, versionOf, log: quiet };

// Old system cloudflared -> downloads, verifies, installs managed copy, switches to it.
{
	versions.set("cloudflared", "2026.9.3");
	const fetchFn = fetchReturning(goodBody);
	const r = await withHash(goodHash, () => ensureCloudflared({ ...base, fetchFn }));
	assert.equal(r.updated, true);
	assert.equal(r.previousVersion, "2026.9.3");
	assert.equal(r.previousPath, "cloudflared");
	assert.equal(r.path, managedPath);
	assert.equal(getCloudflaredPath(), managedPath);
	assert.equal(fetchFn.calls[0], `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset}`);
	assert.equal(fs.statSync(managedPath).mode & 0o777, 0o755);
	console.log("  ✔ old cloudflared is replaced by the verified pinned build");
}

// Already current -> no download.
{
	const fetchFn = fetchReturning(goodBody);
	const r = await ensureCloudflared({ ...base, fetchFn });
	assert.equal(r.updated, false);
	assert.equal(fetchFn.calls.length, 0);
	assert.equal(getCloudflaredPath(), managedPath);
	console.log("  ✔ no download when already on the pinned version");
}

// System copy newer than the managed one (e.g. apt upgrade) -> use the system one.
{
	versions.set("cloudflared", "2027.1.0");
	assert.equal(selectCloudflared({ managedPath, versionOf }).version, "2027.1.0");
	assert.equal(getCloudflaredPath(), "cloudflared");
	fs.rmSync(managedPath);
	console.log("  ✔ prefers a newer system cloudflared");
}

// Hash mismatch -> nothing installed, old binary kept, error reported.
{
	versions.set("cloudflared", "2026.9.3");
	const r = await withHash(realHash, () => ensureCloudflared({ ...base, fetchFn: fetchReturning(Buffer.from("tampered")) }));
	assert.equal(r.updated, false);
	assert.match(r.error, /SHA256 mismatch/);
	assert.equal(fs.existsSync(managedPath), false);
	assert.equal(getCloudflaredPath(), "cloudflared");
	console.log("  ✔ a download with the wrong hash is rejected");
}

// HTTP failure and unsupported platforms keep the current binary.
{
	const r = await ensureCloudflared({ ...base, fetchFn: fetchReturning(goodBody, { status: 404 }) });
	assert.match(r.error, /HTTP 404/);
	const mac = await ensureCloudflared({ ...base, platform: "darwin", fetchFn: fetchReturning(goodBody) });
	assert.match(mac.error, /no pinned cloudflared build/);
	assert.equal(getCloudflaredPath(), "cloudflared");
	console.log("  ✔ download failures keep the working binary");
}

// No cloudflared anywhere -> tunnel was never set up; don't install one.
{
	versions.delete("cloudflared");
	const fetchFn = fetchReturning(goodBody);
	const r = await ensureCloudflared({ ...base, fetchFn });
	assert.equal(r.updated, false);
	assert.equal(fetchFn.calls.length, 0);
	console.log("  ✔ does not install cloudflared when none was installed");
}

setCloudflaredPath("cloudflared");
fs.rmSync(tmp, { recursive: true, force: true });
console.log("All managed cloudflared tests passed.");
