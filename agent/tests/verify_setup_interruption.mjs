import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const SETUP_SH = path.join(REPO_ROOT, "setup.sh");
const setupSource = fs.readFileSync(SETUP_SH, "utf8");

function assertMarkerBlock(name) {
	const start = setupSource.indexOf(`# >>> ${name} >>>`);
	const end = setupSource.indexOf(`# <<< ${name} <<<`);
	assert.ok(start >= 0 && end > start, `setup.sh must expose the ${name} helper block`);
	return setupSource.slice(start, end + `# <<< ${name} <<<`.length);
}

function writeMock(binDir, name, body) {
	const file = path.join(binDir, name);
	fs.writeFileSync(file, `#!/usr/bin/env bash\nset -u\n${body}\n`, { mode: 0o755 });
	return file;
}

function createSandbox(name, options = {}) {
	const { repoExists = true, cloneSource = false } = options;
	const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `home-cloud-interrupt-${name}-`));
	const home = path.join(sandbox, "home");
	const bin = path.join(sandbox, "bin");
	const repo = path.join(sandbox, "repo");
	const systemd = path.join(sandbox, "systemd");
	const state = path.join(sandbox, "state");
	const mockDir = path.join(sandbox, "mock");
	const tmp = path.join(sandbox, "tmp");
	for (const dir of [home, bin, systemd, state, mockDir, tmp]) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const seedRepo = (target) => {
		fs.mkdirSync(path.join(target, "agent"), { recursive: true });
		fs.copyFileSync(path.join(REPO_ROOT, "home-cloud.service.template"), path.join(target, "home-cloud.service.template"));
		fs.copyFileSync(path.join(REPO_ROOT, "agent", "package.json"), path.join(target, "agent", "package.json"));
		fs.copyFileSync(path.join(REPO_ROOT, "agent", ".env.example"), path.join(target, "agent", ".env.example"));
		fs.symlinkSync(path.join(REPO_ROOT, "agent", "node_modules"), path.join(target, "agent", "node_modules"), "dir");
	};

	if (repoExists) seedRepo(repo);
	if (cloneSource) seedRepo(path.join(sandbox, "clone-src"));

	writeMock(
		bin,
		"sudo",
		`if [ "$1" = "mv" ] && [ -f "$MOCK_DIR/mv-service-block" ]; then
  for arg in "$@"; do
    if [ "$arg" = "$HOME_CLOUD_SYSTEMD_DIR/home-cloud.service" ]; then
      : > "$MOCK_DIR/mv-service-started"
      trap 'exit 143' TERM INT
      while :; do sleep 1; done
    fi
  done
fi
exec "$@"`,
	);
	writeMock(bin, "apt-get", 'echo "apt-get $*" >> "$MOCK_DIR/mock.log"\nexit 0');
	writeMock(bin, "fuser", "exit 1");
	writeMock(bin, "usermod", 'echo "usermod $*" >> "$MOCK_DIR/mock.log"\nexit 0');
	writeMock(bin, "corepack", 'echo "corepack $*" >> "$MOCK_DIR/mock.log"\nexit 0');
	writeMock(bin, "ufw", 'echo "Status: inactive"');
	writeMock(bin, "docker", 'echo "docker $*" >> "$MOCK_DIR/mock.log"\nexit 0');
	writeMock(bin, "cloudflared", 'echo "cloudflared $*" >> "$MOCK_DIR/mock.log"\nexit 0');
	writeMock(
		bin,
		"systemctl",
		`echo "systemctl $*" >> "$MOCK_DIR/mock.log"
if [ "$1" = "is-active" ]; then exit 3; fi
if [ -f "$MOCK_DIR/systemd-fail" ] && [ "$1" = "daemon-reload" ]; then
  echo "mock systemctl daemon-reload failure" >&2
  exit 1
fi
if [ -f "$MOCK_DIR/systemd-block" ] && [ "$1" = "daemon-reload" ]; then
  : > "$MOCK_DIR/systemd-started"
  trap 'exit 143' TERM INT
  while :; do sleep 1; done
fi
exit 0`,
	);
	writeMock(
		bin,
		"git",
		`echo "git $*" >> "$MOCK_DIR/mock.log"
if [ "$1" = "--version" ]; then echo "git version 2.0"; exit 0; fi
if [ "$1" = "-C" ]; then
  if [ "\${3:-}" = "rev-parse" ]; then echo "v1.0.1"; exit 0; fi
  if [ "\${3:-}" = "describe" ]; then echo "v1.0.1"; exit 0; fi
fi
if [ "$1" = "clone" ]; then
  dest=""
  for arg in "$@"; do dest="$arg"; done
  mkdir -p "$dest"
  if [ "\${MOCK_GIT_CLONE_MODE:-success}" = "partial" ]; then
    echo "partial" > "$dest/PARTIAL"
    exit 1
  fi
  cp -a "$MOCK_GIT_CLONE_SRC/." "$dest/"
  exit 0
fi
exit 0`,
	);
	writeMock(
		bin,
		"pnpm",
		`echo "pnpm $*" >> "$MOCK_DIR/mock.log"
if [ "$1" = "--version" ]; then echo "12.15.0"; exit 0; fi
if [ -f "$MOCK_DIR/pnpm-block" ]; then
  : > "$MOCK_DIR/pnpm-started"
  trap 'exit 143' TERM INT
  while :; do sleep 1; done
fi
if [ "$1" = "--filter" ]; then mkdir -p "$MOCK_REPO/dashboard/dist"; fi
exit 0`,
	);
	writeMock(
		bin,
		"curl",
		`out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[ -n "$out" ] || exit 2
if [ "\${MOCK_CURL_FAIL:-0}" = "1" ]; then
  printf 'partial-download' > "$out"
  exit 22
fi
printf 'fake-cloudflared' > "$out"`,
	);
	writeMock(bin, "sha256sum", 'echo "053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0  ${2:-}"');

	const env = {
		...process.env,
		HOME: home,
		TMPDIR: tmp,
		XDG_STATE_HOME: path.join(home, ".local", "state"),
		HOME_CLOUD_STATE_DIR: state,
		HOME_CLOUD_SYSTEMD_DIR: systemd,
		NON_INTERACTIVE: "true",
		SKIP_CLOUDFLARED: "true",
		PATH: `${bin}:${process.env.PATH}`,
		MOCK_DIR: mockDir,
		MOCK_REPO: repo,
		MOCK_GIT_CLONE_SRC: path.join(sandbox, "clone-src"),
	};
	for (const key of [
		"SUDO_USER",
		"HOME_CLOUD_DIR",
		"HOME_CLOUD_PASSWORD",
		"HOME_CLOUD_BRANCH",
		"CF_DOMAIN",
		"CLOUDFLARE_DOMAIN",
		"TUNNEL_NAME",
	]) {
		delete env[key];
	}

	return { sandbox, home, bin, repo, systemd, state, mockDir, tmp, env };
}

function setupEnv(sandbox, extra = {}) {
	return { ...sandbox.env, ...extra };
}

function runSetup(sandbox, extra = {}, args = []) {
	return spawnSync("bash", [SETUP_SH, "--dir", sandbox.repo, ...args], {
		env: setupEnv(sandbox, extra),
		encoding: "utf8",
		timeout: 120000,
		maxBuffer: 8 * 1024 * 1024,
	});
}

function startSetup(sandbox, extra = {}) {
	const child = spawn("bash", [SETUP_SH, "--dir", sandbox.repo], {
		env: setupEnv(sandbox, extra),
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const done = new Promise((resolve) => {
		child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
	});
	return { child, done };
}

async function waitForFile(file, timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (fs.existsSync(file)) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`timed out waiting for ${file}`);
}

function killGroup(child, signal) {
	try {
		process.kill(-child.pid, signal);
	} catch (error) {
		if (error.code !== "ESRCH") throw error;
	}
}

function readJournal(sandbox) {
	const dir = path.join(sandbox.state, "setup");
	if (!fs.existsSync(dir)) return null;
	const files = fs.readdirSync(dir).filter((name) => /^transaction-.*\.state$/.test(name));
	if (files.length === 0) return null;
	const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
	const result = {};
	for (const line of content.split("\n")) {
		const index = line.indexOf("=");
		if (index > 0) result[line.slice(0, index)] = line.slice(index + 1);
	}
	return result;
}

function readRepoEnv(sandbox) {
	return fs.readFileSync(path.join(sandbox.repo, "agent", ".env"), "utf8");
}

function artifactPaths(sandbox) {
	const roots = [sandbox.home, sandbox.repo, sandbox.systemd, sandbox.state, sandbox.tmp];
	const found = [];
	const walk = (dir) => {
		if (!fs.existsSync(dir)) return;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === "node_modules") continue;
			const full = path.join(dir, entry.name);
			const stat = fs.lstatSync(full);
			if (stat.isSymbolicLink()) continue;
			if (stat.isDirectory()) {
				if (/\.home-cloud-clone\./.test(entry.name)) {
					found.push(full);
					continue;
				}
				walk(full);
				continue;
			}
			if (
				/\.home-cloud-tmp\./.test(entry.name) ||
				/^transaction-.*\.state$/.test(entry.name) ||
				/^service-unit\.(?:[^.]*\.)?(?:backup|render)\./.test(entry.name) ||
				/^home-cloud-setup\./.test(entry.name)
			) {
				found.push(full);
			}
		}
	};
	for (const root of roots) walk(root);
	return found;
}

function assertNoArtifacts(sandbox) {
	assert.deepEqual(artifactPaths(sandbox), [], "setup must not leave transaction or temporary artifacts");
}

function assertNoTempArtifacts(sandbox) {
	const found = artifactPaths(sandbox).filter((file) => !/^transaction-.*\.state$/.test(path.basename(file)));
	assert.deepEqual(found, [], "interrupted setup must clean temporary files while keeping only its journal");
}

function assertValidInstall(sandbox) {
	const envPath = path.join(sandbox.repo, "agent", ".env");
	assert.equal(fs.existsSync(envPath), true, "agent/.env should exist");
	assert.equal(fs.statSync(envPath).mode & 0o777, 0o600, "agent/.env must be 0600");
	const env = readRepoEnv(sandbox);
	assert.match(env, /^JWT_SECRET=[0-9a-f]{48}$/m, "JWT secret should be a generated 48-character hex value");
	assert.match(env, /^PASSWORD="?[^\n"]{8,}"?$/m, "admin password should be present");
	const servicePath = path.join(sandbox.systemd, "home-cloud.service");
	assert.equal(fs.existsSync(servicePath), true, "systemd unit should exist");
	const service = fs.readFileSync(servicePath, "utf8");
	assert.doesNotMatch(service, /\{\{/, "systemd unit must not contain unresolved template variables");
	assert.match(service, /^ExecStart=/m);
}

const cleanupSandboxes = [];
function registerSandbox(sandbox) {
	cleanupSandboxes.push(sandbox.sandbox);
	return sandbox;
}

process.on("exit", () => {
	for (const dir of cleanupSandboxes) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

console.log("--- Running setup.sh interruption and idempotency verification tests ---");

// -----------------------------------------------------------------------------
// Test 1: Fresh install produces a complete, secret-safe state with no artifacts
// -----------------------------------------------------------------------------
console.log("\n[Test 1] Fresh install");
{
	const sandbox = registerSandbox(createSandbox("fresh"));
	const res = runSetup(sandbox);
	assert.equal(res.status, 0, `fresh setup failed:\n${res.stdout}\n${res.stderr}`);
	assertValidInstall(sandbox);
	assertNoArtifacts(sandbox);
	console.log("  ✔ Fresh install completed with valid secrets, unit, and no temporary artifacts.");
}

// -----------------------------------------------------------------------------
// Test 2: A successful rerun is idempotent and preserves generated secrets
// -----------------------------------------------------------------------------
console.log("\n[Test 2] Successful rerun");
{
	const sandbox = registerSandbox(createSandbox("rerun"));
	const first = runSetup(sandbox);
	assert.equal(first.status, 0, `first setup failed:\n${first.stdout}\n${first.stderr}`);
	const firstEnv = readRepoEnv(sandbox);
	const firstService = fs.readFileSync(path.join(sandbox.systemd, "home-cloud.service"), "utf8");
	const second = runSetup(sandbox);
	assert.equal(second.status, 0, `rerun failed:\n${second.stdout}\n${second.stderr}`);
	assert.equal(readRepoEnv(sandbox), firstEnv, "rerun must not regenerate or reorder secrets");
	assert.equal(
		fs.readFileSync(path.join(sandbox.systemd, "home-cloud.service"), "utf8"),
		firstService,
		"rerun must render the same systemd unit",
	);
	const log = fs.readFileSync(path.join(sandbox.mockDir, "mock.log"), "utf8");
	assert.match(log, /pnpm install --frozen-lockfile/);
	assert.doesNotMatch(log, /git .* checkout /, "rerun must not perform a needless checkout");
	assertNoArtifacts(sandbox);
	console.log("  ✔ Rerun converged without rewriting the existing password or JWT.");
}

// -----------------------------------------------------------------------------
// Test 3: Pre-existing .env secrets and unrelated keys are preserved
// -----------------------------------------------------------------------------
console.log("\n[Test 3] Pre-existing .env preservation");
{
	const sandbox = registerSandbox(createSandbox("preexisting-env"));
	const envPath = path.join(sandbox.repo, "agent", ".env");
	const original = "PASSWORD=keep-me-123\nJWT_SECRET=keep-this-secret\nPORT=4567\nCUSTOM_SETTING=keep\n";
	fs.writeFileSync(envPath, original, { mode: 0o600 });

	const res = runSetup(sandbox);
	assert.equal(res.status, 0, `setup failed:\n${res.stdout}\n${res.stderr}`);
	assert.equal(readRepoEnv(sandbox), original, "preexisting .env must not be rewritten");
	assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);

	const override = runSetup(sandbox, { HOME_CLOUD_PASSWORD: "new-password-123" });
	assert.equal(override.status, 0, `password override failed:\n${override.stdout}\n${override.stderr}`);
	const updated = readRepoEnv(sandbox);
	assert.match(updated, /^PASSWORD="new-password-123"$/m);
	assert.match(updated, /^JWT_SECRET=keep-this-secret$/m, "JWT must survive a password-only update");
	assert.match(updated, /^PORT=4567$/m);
	assert.match(updated, /^CUSTOM_SETTING=keep$/m);
	assertNoArtifacts(sandbox);
	console.log("  ✔ Preexisting password, JWT, and unrelated keys survived; explicit password update was narrow.");
}

// -----------------------------------------------------------------------------
// Test 4: SIGTERM during dependency install records state and rerun completes
// -----------------------------------------------------------------------------
console.log("\n[Test 4] SIGTERM during dependency install");
{
	const sandbox = registerSandbox(createSandbox("sigterm"));
	fs.writeFileSync(path.join(sandbox.mockDir, "pnpm-block"), "1");
	const { child, done } = startSetup(sandbox);
	try {
		await waitForFile(path.join(sandbox.mockDir, "pnpm-started"));
		killGroup(child, "SIGTERM");
		const result = await done;
		assert.ok(
			result.code === 143 || result.signal === "SIGTERM",
			`expected SIGTERM handling, got code=${result.code} signal=${result.signal}\n${result.stdout}\n${result.stderr}`,
		);
		const journal = readJournal(sandbox);
		assert.equal(journal?.status, "interrupted", "signal handler should record an interrupted transaction");
		const jwtBefore = readRepoEnv(sandbox).match(/^JWT_SECRET=(.*)$/m)?.[1];
		assert.ok(jwtBefore, "JWT should already have been written before the interrupted phase");
		assertNoTempArtifacts(sandbox);

		fs.rmSync(path.join(sandbox.mockDir, "pnpm-block"));
		const rerun = runSetup(sandbox);
		assert.equal(rerun.status, 0, `rerun after SIGTERM failed:\n${rerun.stdout}\n${rerun.stderr}`);
		assert.equal(readRepoEnv(sandbox).match(/^JWT_SECRET=(.*)$/m)?.[1], jwtBefore, "JWT must survive recovery");
		assert.equal(readJournal(sandbox), null, "successful rerun must clear the journal");
		assertNoArtifacts(sandbox);
		console.log("  ✔ SIGTERM journal, cleanup, and rerun recovery behaved deterministically.");
	} finally {
		killGroup(child, "SIGKILL");
	}
}

// -----------------------------------------------------------------------------
// Test 5: SIGKILL leaves a stale journal/temp files that the next run cleans up
// -----------------------------------------------------------------------------
console.log("\n[Test 5] SIGKILL stale transaction recovery");
{
	const sandbox = registerSandbox(createSandbox("sigkill"));
	fs.writeFileSync(path.join(sandbox.mockDir, "pnpm-block"), "1");
	const { child, done } = startSetup(sandbox);
	try {
		await waitForFile(path.join(sandbox.mockDir, "pnpm-started"));
		killGroup(child, "SIGKILL");
		const result = await done;
		assert.ok(result.code === 137 || result.signal === "SIGKILL", "expected SIGKILL");
		const journal = readJournal(sandbox);
		assert.equal(journal?.status, "running", "hard kill cannot run traps and must leave a recoverable running journal");
		const jwtBefore = readRepoEnv(sandbox).match(/^JWT_SECRET=(.*)$/m)?.[1];
		assert.ok(jwtBefore);

		const staleEnv = path.join(sandbox.repo, "agent", ".env.home-cloud-tmp.stale");
		const staleConfig = path.join(sandbox.home, ".cloudflared", ".config.yml.home-cloud-tmp.stale");
		const staleClone = path.join(sandbox.sandbox, "repo.home-cloud-clone.stale");
		const foreignClone = path.join(sandbox.sandbox, "repo.home-cloud-clone.foreign");
		const staleTmp = path.join(sandbox.tmp, "home-cloud-setup.stale");
		fs.writeFileSync(staleEnv, "stale");
		fs.mkdirSync(path.dirname(staleConfig), { recursive: true });
		fs.writeFileSync(staleConfig, "stale");
		fs.mkdirSync(staleClone, { recursive: true });
		fs.writeFileSync(path.join(staleClone, ".home-cloud-attempt"), "stale");
		fs.mkdirSync(foreignClone, { recursive: true });
		fs.writeFileSync(path.join(foreignClone, "keep-me.txt"), "not setup-owned");
		fs.mkdirSync(staleTmp, { recursive: true });
		fs.writeFileSync(path.join(staleTmp, ".home-cloud-attempt"), "stale");

		fs.rmSync(path.join(sandbox.mockDir, "pnpm-block"));
		const rerun = runSetup(sandbox);
		assert.equal(rerun.status, 0, `rerun after SIGKILL failed:\n${rerun.stdout}\n${rerun.stderr}`);
		assert.equal(readRepoEnv(sandbox).match(/^JWT_SECRET=(.*)$/m)?.[1], jwtBefore);
		assert.equal(fs.existsSync(staleEnv), false);
		assert.equal(fs.existsSync(staleConfig), false);
		assert.equal(fs.existsSync(staleClone), false);
		assert.equal(fs.existsSync(staleTmp), false);
		assert.equal(
			fs.readFileSync(path.join(foreignClone, "keep-me.txt"), "utf8"),
			"not setup-owned",
			"an unmarked clone-named directory must be preserved",
		);
		fs.rmSync(foreignClone, { recursive: true, force: true });
		assert.equal(readJournal(sandbox), null);
		assertNoArtifacts(sandbox);
		console.log("  ✔ Stale journal, owned temp/clone, and cloudflared temp directory were cleaned; unmarked data was preserved.");
	} finally {
		killGroup(child, "SIGKILL");
	}
}

// -----------------------------------------------------------------------------
// Test 6: Failed systemd reload rolls back only the unit touched by this run
// -----------------------------------------------------------------------------
console.log("\n[Test 6] Systemd failure rollback");
{
	const sandbox = registerSandbox(createSandbox("service-rollback"));
	const servicePath = path.join(sandbox.systemd, "home-cloud.service");
	const previous = "[Unit]\nDescription=Previous Home Cloud Unit\n";
	fs.writeFileSync(servicePath, previous, { mode: 0o644 });
	fs.writeFileSync(path.join(sandbox.mockDir, "systemd-fail"), "1");

	const failed = runSetup(sandbox);
	assert.notEqual(failed.status, 0, "systemctl failure should fail setup");
	assert.equal(fs.readFileSync(servicePath, "utf8"), previous, "rollback must restore the pre-existing unit byte for byte");
	assert.equal(readJournal(sandbox)?.status, "interrupted");
	assertNoTempArtifacts(sandbox);

	fs.rmSync(path.join(sandbox.mockDir, "systemd-fail"));
	const rerun = runSetup(sandbox);
	assert.equal(rerun.status, 0, `rerun failed:\n${rerun.stdout}\n${rerun.stderr}`);
	const service = fs.readFileSync(servicePath, "utf8");
	assert.match(service, /^Description=Home Cloud/m);
	assert.doesNotMatch(service, /Previous Home Cloud Unit/);
	assertNoArtifacts(sandbox);
	console.log("  ✔ Failed run restored the previous unit; rerun installed the intended unit.");
}

// -----------------------------------------------------------------------------
// Test 6b: SIGKILL after unit install restores the pre-existing unit on rerun
// -----------------------------------------------------------------------------
console.log("\n[Test 6b] Systemd unit recovery after SIGKILL");
{
	const sandbox = registerSandbox(createSandbox("service-sigkill"));
	const servicePath = path.join(sandbox.systemd, "home-cloud.service");
	const previous = "[Unit]\nDescription=Previous Home Cloud Unit\n";
	fs.writeFileSync(servicePath, previous, { mode: 0o600 });
	fs.writeFileSync(path.join(sandbox.mockDir, "systemd-block"), "1");
	const { child, done } = startSetup(sandbox);
	try {
		await waitForFile(path.join(sandbox.mockDir, "systemd-started"));
		killGroup(child, "SIGKILL");
		const result = await done;
		assert.ok(result.code === 137 || result.signal === "SIGKILL", "expected SIGKILL");
		const journal = readJournal(sandbox);
		assert.equal(journal?.status, "running");
		assert.equal(journal?.phase, "systemd_reload");
		assert.match(fs.readFileSync(servicePath, "utf8"), /^Description=Home Cloud/m, "new unit should be installed before the kill");
		assert.equal(fs.statSync(servicePath).mode & 0o777, 0o644);

		const backupFiles = fs
			.readdirSync(path.join(sandbox.state, "setup"))
			.filter((name) => /^service-unit\..*\.backup\./.test(name));
		assert.equal(backupFiles.length, 1, "interrupted transaction must retain its unit backup");

		fs.rmSync(path.join(sandbox.mockDir, "systemd-block"));
		const rerun = runSetup(sandbox);
		assert.equal(rerun.status, 0, `rerun after SIGKILL failed:\n${rerun.stdout}\n${rerun.stderr}`);
		assert.match(rerun.stdout, /Restored the pre-existing systemd unit from the interrupted transaction/i);
		const service = fs.readFileSync(servicePath, "utf8");
		assert.match(service, /^Description=Home Cloud/m);
		assert.doesNotMatch(service, /Previous Home Cloud Unit/);
		assert.equal(readJournal(sandbox), null);
		assertNoArtifacts(sandbox);
		console.log("  ✔ SIGKILL left a recoverable backup; rerun restored it before converging.");
	} finally {
		killGroup(child, "SIGKILL");
	}
}

// -----------------------------------------------------------------------------
// Test 7: Partial clone is discarded; pre-existing non-empty target is preserved
// -----------------------------------------------------------------------------
console.log("\n[Test 7] Clone failure and pre-existing target safety");
{
	const sandbox = registerSandbox(createSandbox("clone", { repoExists: false, cloneSource: true }));
	const partial = runSetup(sandbox, { MOCK_GIT_CLONE_MODE: "partial" });
	assert.notEqual(partial.status, 0, "partial clone should fail setup");
	assert.equal(fs.existsSync(sandbox.repo), false, "partial clone must not be promoted to the target directory");
	assert.deepEqual(
		fs.readdirSync(sandbox.sandbox).filter((name) => name.startsWith("repo.home-cloud-clone.")),
		[],
		"partial clone temp directory must be removed",
	);

	const rerun = runSetup(sandbox);
	assert.equal(rerun.status, 0, `clone retry failed:\n${rerun.stdout}\n${rerun.stderr}`);
	assertValidInstall(sandbox);
	assertNoArtifacts(sandbox);

	const occupied = registerSandbox(createSandbox("clone-occupied"));
	fs.rmSync(path.join(occupied.repo, "home-cloud.service.template"));
	fs.rmSync(path.join(occupied.repo, "agent", "package.json"));
	fs.writeFileSync(path.join(occupied.repo, "keep-me.txt"), "do not delete");
	const refused = runSetup(occupied);
	assert.notEqual(refused.status, 0, "incomplete pre-existing target must be refused");
	assert.equal(fs.readFileSync(path.join(occupied.repo, "keep-me.txt"), "utf8"), "do not delete");
	assert.match(refused.stdout + refused.stderr, /Refusing to delete or overwrite pre-existing files/);
	assert.doesNotMatch(
		fs.readFileSync(path.join(occupied.mockDir, "mock.log"), "utf8"),
		/git clone/,
		"setup must not clone over an unrelated pre-existing directory",
	);
	console.log("  ✔ Partial clone was discarded; unrelated pre-existing directory contents were preserved.");
}

// -----------------------------------------------------------------------------
// Test 8: cloudflared download never promotes a failed or unverified file
// -----------------------------------------------------------------------------
console.log("\n[Test 8] cloudflared download atomicity");
{
	const helperBlock = assertMarkerBlock("HOME CLOUD TRANSACTION HELPERS");
	const cfBlock = assertMarkerBlock("CLOUDFLARED HELPERS");
	const sandbox = registerSandbox(createSandbox("cloudflared"));
	const dest = path.join(sandbox.tmp, "cloudflared-download");
	const runDownload = (extra) => {
		const script = `set -u\n${helperBlock}\n${cfBlock}\ndownload_verified_cloudflared "cloudflared-linux-amd64" "$1"`;
		return spawnSync("bash", ["-c", script, "bash", dest], {
			env: { ...sandbox.env, ...extra },
			encoding: "utf8",
		});
	};

	fs.writeFileSync(dest, "previous-binary");
	const failed = runDownload({ MOCK_CURL_FAIL: "1" });
	assert.notEqual(failed.status, 0, "download failure should abort");
	assert.equal(fs.readFileSync(dest, "utf8"), "previous-binary", "failed download must not replace the destination");
	assert.equal(fs.existsSync(`${dest}.part`), false, "failed download part file must be removed");

	fs.rmSync(dest);
	const succeeded = runDownload({});
	assert.equal(succeeded.status, 0, `download should succeed:\n${succeeded.stdout}\n${succeeded.stderr}`);
	assert.equal(fs.readFileSync(dest, "utf8"), "fake-cloudflared");
	assert.equal(fs.existsSync(`${dest}.part`), false);
	console.log("  ✔ Failed download preserved the old destination; verified download was promoted atomically.");
}

// -----------------------------------------------------------------------------
// Test 9: env updates treat values containing replacement syntax literally
// -----------------------------------------------------------------------------
console.log("\n[Test 9] env update replacement safety");
{
	const helperBlock = assertMarkerBlock("HOME CLOUD TRANSACTION HELPERS");
	const sandbox = registerSandbox(createSandbox("env-replacement"));
	const envPath = path.join(sandbox.tmp, "replacement.env");
	fs.writeFileSync(envPath, "JWT_SECRET=old-secret\nPORT=3000\n", { mode: 0o600 });
	const value = "literal$&value$1$`";
	const res = spawnSync(
		"bash",
		[
			"-c",
			`set -u\n${helperBlock}\napply_env_update "$1" JWT_SECRET "$2"`,
			"bash",
			envPath,
			value,
		],
		{
			env: { ...sandbox.env, NODE_PATH: process.execPath },
			encoding: "utf8",
		},
	);
	assert.equal(res.status, 0, `env update failed:\n${res.stdout}\n${res.stderr}`);
	const content = fs.readFileSync(envPath, "utf8");
	assert.match(content, /^JWT_SECRET=literal\$&value\$1\$`$/m, "replacement syntax must not be expanded");
	assert.match(content, /^PORT=3000$/m, "unrelated env keys must be preserved");
	assert.equal(fs.statSync(envPath).mode & 0o777, 0o600, "env file must stay 0600");
	console.log("  ✔ Values containing $&, $1, and $` were written literally without touching other keys.");
}

// -----------------------------------------------------------------------------
// Test 10: SIGKILL right before atomic mv has sealed journal and restores unit
// -----------------------------------------------------------------------------
console.log("\n[Test 10] Systemd unit replacement crash window right before mv");
{
	const sandbox = registerSandbox(createSandbox("service-pre-mv-kill"));
	const servicePath = path.join(sandbox.systemd, "home-cloud.service");
	const previous = "[Unit]\nDescription=Previous Home Cloud Unit\n";
	fs.writeFileSync(servicePath, previous, { mode: 0o644 });
	fs.writeFileSync(path.join(sandbox.mockDir, "mv-service-block"), "1");

	const { child, done } = startSetup(sandbox);
	try {
		await waitForFile(path.join(sandbox.mockDir, "mv-service-started"));
		killGroup(child, "SIGKILL");
		const result = await done;
		assert.ok(result.code === 137 || result.signal === "SIGKILL", "expected SIGKILL");

		const journal = readJournal(sandbox);
		assert.equal(journal?.status, "running");
		assert.equal(journal?.phase, "service_install");
		assert.equal(journal?.service_unit_touched, "yes");
		assert.equal(journal?.service_unit_preexisting, "yes");
		assert.equal(fs.readFileSync(servicePath, "utf8"), previous, "previous unit must still be on disk");

		const backupFiles = fs
			.readdirSync(path.join(sandbox.state, "setup"))
			.filter((name) => /^service-unit\..*\.backup\./.test(name));
		assert.equal(backupFiles.length, 1, "backup must exist");

		fs.rmSync(path.join(sandbox.mockDir, "mv-service-block"));
		const rerun = runSetup(sandbox);
		assert.equal(rerun.status, 0, `rerun failed:\n${rerun.stdout}\n${rerun.stderr}`);
		assert.match(rerun.stdout, /Restored the pre-existing systemd unit from the interrupted transaction/i);
		const service = fs.readFileSync(servicePath, "utf8");
		assert.match(service, /^Description=Home Cloud/m);
		assert.doesNotMatch(service, /Previous Home Cloud Unit/);
		assert.equal(readJournal(sandbox), null);
		assertNoArtifacts(sandbox);
		console.log("  ✔ Pre-mv crash window was fully sealed in journal; rerun restored previous unit and converged.");
	} finally {
		killGroup(child, "SIGKILL");
	}
}

// -----------------------------------------------------------------------------
// Test 11: Journal failure aborts before protected mutations
// -----------------------------------------------------------------------------
console.log("\n[Test 11] Journal failure aborts before protected mutations");
{
	const sandbox = registerSandbox(createSandbox("journal-failure"));

	try {
		const res = runSetup(sandbox, { HOME_CLOUD_SIMULATE_JOURNAL_FAIL: "1" });
		assert.notEqual(res.status, 0, "setup must fail when journal cannot be written");
		assert.match(
			res.stderr + res.stdout,
			/Fatal: Failed to persist critical journal record/i,
			"must log critical journal failure message",
		);
		const envPath = path.join(sandbox.repo, "agent", ".env");
		assert.equal(fs.existsSync(envPath), false, "agent/.env must NOT be created when journal fails");
		const servicePath = path.join(sandbox.systemd, "home-cloud.service");
		assert.equal(fs.existsSync(servicePath), false, "systemd unit must NOT be installed when journal fails");
		console.log("  ✔ Critical journal failure safely aborted before creating .env or installing service unit.");
	} finally {
	}
}

// -----------------------------------------------------------------------------
// Test 12: Stale backup reference preserved when restoration cannot proceed
// -----------------------------------------------------------------------------
console.log("\n[Test 12] Stale backup reference preserved when restoration cannot proceed");
{
	const sandbox = registerSandbox(createSandbox("backup-ref-preserved"));
	const servicePath = path.join(sandbox.systemd, "home-cloud.service");
	const previousUnit = "[Unit]\nDescription=Previous Unit\n";
	const setupStateDir = path.join(sandbox.state, "setup");
	fs.mkdirSync(setupStateDir, { recursive: true });

	const stateKey = "053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0";
	const backupFile = path.join(setupStateDir, `service-unit.${stateKey}.backup.12345`);
	fs.writeFileSync(backupFile, previousUnit);

	const journalFile = path.join(setupStateDir, `transaction-${stateKey}.state`);
	fs.writeFileSync(
		journalFile,
		`version=1\nstatus=interrupted\nphase=systemd_reload\ninstall_dir=${sandbox.repo}\nservice_unit_target=${servicePath}\nservice_unit_preexisting=yes\nservice_unit_touched=yes\nservice_unit_backup=${backupFile}\n`,
	);

	// Make the target a symlink so restoration is refused
	fs.symlinkSync("/dev/null", servicePath);

	const res = runSetup(sandbox);
	assert.notEqual(res.status, 0, "setup should refuse when unit is a symlink and cannot be restored");
	assert.match(res.stderr + res.stdout, /is now a symlink; refusing to overwrite it/i);
	assert.match(res.stderr + res.stdout, /Cannot safely proceed: pre-existing systemd unit backup could not be restored/i);

	assert.equal(fs.existsSync(backupFile), true, "backup file must be kept");
	assert.equal(fs.readFileSync(backupFile, "utf8"), previousUnit);
	assert.equal(fs.existsSync(journalFile), true, "journal file must be kept");
	const journal = readJournal(sandbox);
	assert.equal(journal?.service_unit_backup, backupFile, "journal must keep the stale backup reference");

	fs.unlinkSync(servicePath);
	const rerun = runSetup(sandbox);
	assert.equal(rerun.status, 0, `rerun should succeed after fixing symlink:\n${rerun.stdout}\n${rerun.stderr}`);
	assertValidInstall(sandbox);
	assertNoArtifacts(sandbox);
	console.log("  ✔ Stale backup and journal reference were preserved on restore failure, then safely recovered.");
}

// -----------------------------------------------------------------------------
// Test 13: Directory lock fallback with stale and active holders
// -----------------------------------------------------------------------------
console.log("\n[Test 13] Directory lock fallback with stale and active holders");
{
	const sandbox = registerSandbox(createSandbox("lock-fallback"));
	const stateBase = path.join(sandbox.state);
	const lockDir = path.join(stateBase, "setup.lock.d");

	// Subcase A: Stale lock directory with dead PID
	fs.mkdirSync(lockDir, { recursive: true });
	fs.writeFileSync(path.join(lockDir, "pid"), "999999\n");

	const res = runSetup(sandbox, { HOME_CLOUD_FORCE_LOCK_DIR: "true" });
	assert.equal(res.status, 0, `setup with stale lock directory failed:\n${res.stdout}\n${res.stderr}`);
	assertValidInstall(sandbox);
	assertNoArtifacts(sandbox);
	console.log("  ✔ Stale directory lock with dead PID was automatically cleaned and setup succeeded.");

	// Subcase B: Active lock directory with running process
	const blockerSandbox = registerSandbox(createSandbox("lock-active"));
	const blockerLockDir = path.join(blockerSandbox.state, "setup.lock.d");
	fs.mkdirSync(blockerLockDir, { recursive: true });

	const sleepProc = spawn("sleep", ["60"], { stdio: "ignore" });
	fs.writeFileSync(path.join(blockerLockDir, "pid"), `${sleepProc.pid}\n`);

	const { child, done } = startSetup(blockerSandbox, { HOME_CLOUD_FORCE_LOCK_DIR: "true" });
	try {
		let output = "";
		const waited = await new Promise((resolve) => {
			const onData = (chunk) => {
				output += chunk;
				if (/holds the lock\. Waiting\.\.\./.test(output)) {
					child.stdout.off("data", onData);
					resolve(true);
				}
			};
			child.stdout.on("data", onData);
			setTimeout(() => resolve(false), 5000);
		});
		assert.equal(waited, true, `setup should detect active holder:\n${output}`);
		assert.equal(fs.existsSync(blockerLockDir), true, "active lock directory must not be removed by another run");
	} finally {
		killGroup(child, "SIGKILL");
		await done;
		try { process.kill(sleepProc.pid, "SIGKILL"); } catch {}
	}
	const recoveryRes = runSetup(blockerSandbox, { HOME_CLOUD_FORCE_LOCK_DIR: "true" });
	assert.equal(recoveryRes.status, 0, `recovery after process death failed:\n${recoveryRes.stdout}\n${recoveryRes.stderr}`);
	assertValidInstall(blockerSandbox);
	assertNoArtifacts(blockerSandbox);
	console.log("  ✔ Active directory lock was respected, and reclaimed once the holder terminated.");
}

// -----------------------------------------------------------------------------
// Test 14: Cleanup safety preserves foreign and unmarked files
// -----------------------------------------------------------------------------
console.log("\n[Test 14] Cleanup safety preserves foreign and unmarked files");
{
	const sandbox = registerSandbox(createSandbox("cleanup-safety"));

	const foreignTmp = path.join(sandbox.tmp, "home-cloud-setup.foreign");
	fs.mkdirSync(foreignTmp, { recursive: true });
	fs.writeFileSync(path.join(foreignTmp, "user-data.txt"), "keep this foreign file");

	const foreignClone = path.join(sandbox.sandbox, "repo.home-cloud-clone.foreign");
	fs.mkdirSync(foreignClone, { recursive: true });
	fs.writeFileSync(path.join(foreignClone, "user-repo.txt"), "keep this foreign clone");

	const foreignSystemdTmp = path.join(sandbox.systemd, ".other-service.home-cloud-tmp.keep");
	fs.writeFileSync(foreignSystemdTmp, "foreign systemd temp");

	const foreignAgentTmp = path.join(sandbox.repo, "agent", "user-file.home-cloud-tmp.keep");
	fs.writeFileSync(foreignAgentTmp, "foreign agent temp");

	const res = runSetup(sandbox);
	assert.equal(res.status, 0, `setup failed:\n${res.stdout}\n${res.stderr}`);
	assertValidInstall(sandbox);

	assert.equal(fs.existsSync(foreignTmp), true, "unmarked setup tmp dir must be preserved");
	assert.equal(fs.readFileSync(path.join(foreignTmp, "user-data.txt"), "utf8"), "keep this foreign file");

	assert.equal(fs.existsSync(foreignClone), true, "unmarked clone dir must be preserved");
	assert.equal(fs.readFileSync(path.join(foreignClone, "user-repo.txt"), "utf8"), "keep this foreign clone");

	assert.equal(fs.existsSync(foreignSystemdTmp), true, "foreign systemd tmp file must be preserved");
	assert.equal(fs.existsSync(foreignAgentTmp), true, "unrelated agent file must be preserved");

	console.log("  ✔ Foreign tmp directories, clone dirs, and non-owned temporary files were strictly preserved.");
}

// -----------------------------------------------------------------------------
// Test 15: SIGKILL after backup creation but before target replacement intent
// -----------------------------------------------------------------------------
console.log("\n[Test 15] Systemd backup is recoverable if killed immediately after creation");
{
	const sandbox = registerSandbox(createSandbox("service-backup-kill"));
	const servicePath = path.join(sandbox.systemd, "home-cloud.service");
	const previous = "[Unit]\nDescription=Previous Home Cloud Unit\n";
	fs.writeFileSync(servicePath, previous, { mode: 0o640 });

	writeMock(
		sandbox.bin,
		"cp",
		`/usr/bin/cp "$@" || exit $?
dest=""
for arg in "$@"; do dest="$arg"; done
case "$dest" in
  */service-unit.*.backup.*)
    if [ -f "$MOCK_DIR/kill-after-backup" ]; then
      : > "$MOCK_DIR/backup-created"
      kill -KILL "$PPID"
    fi
    ;;
esac`,
	);
	fs.writeFileSync(path.join(sandbox.mockDir, "kill-after-backup"), "1");

	const { child, done } = startSetup(sandbox);
	try {
		await waitForFile(path.join(sandbox.mockDir, "backup-created"));
		const result = await done;
		assert.ok(result.code === 137 || result.signal === "SIGKILL", "expected SIGKILL after backup creation");
		assert.equal(fs.readFileSync(servicePath, "utf8"), previous, "target unit must remain untouched before replacement intent");

		const journal = readJournal(sandbox);
		assert.equal(journal?.service_unit_preexisting, "yes");
		assert.equal(journal?.service_unit_touched, "no");
		assert.ok(journal?.service_unit_backup, "backup path must be journaled before the copy starts");
		const backupPath = journal.service_unit_backup;
		assert.equal(fs.readFileSync(backupPath, "utf8"), previous, "completed backup must match the old unit");

		fs.rmSync(path.join(sandbox.mockDir, "kill-after-backup"));
		const rerun = runSetup(sandbox);
		assert.equal(rerun.status, 0, `rerun after backup-window SIGKILL failed:\n${rerun.stdout}\n${rerun.stderr}`);
		assert.equal(fs.existsSync(backupPath), false, "stale backup from pre-replacement crash must be removed");
		assert.match(fs.readFileSync(servicePath, "utf8"), /^Description=Home Cloud/m);
		assert.equal(readJournal(sandbox), null);
		assertNoArtifacts(sandbox);
		console.log("  ✔ Backup path was journaled first; rerun removed the stale backup and preserved the old unit until replacement.");
	} finally {
		killGroup(child, "SIGKILL");
	}
}

console.log("\n--- ALL SETUP INTERRUPTION AND IDEMPOTENCY TESTS PASSED ---");
