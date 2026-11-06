// Verifies the installer's automatic runtime bootstrap: Node.js selection and
// pinned install, Docker repository targeting and key checks, and WSL systemd
// enablement. All network and privileged commands are mocked.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SETUP_SH = path.join(REPO_ROOT, "setup.sh");
const setupSource = fs.readFileSync(SETUP_SH, "utf8");

function markerBlock(name) {
	const start = setupSource.indexOf(`# >>> ${name} >>>`);
	const end = setupSource.indexOf(`# <<< ${name} <<<`);
	assert.ok(start >= 0 && end > start, `setup.sh must expose the ${name} helper block`);
	return setupSource.slice(start, end + `# <<< ${name} <<<`.length);
}

function writeExec(file, body) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
	return file;
}

const RUNTIME = markerBlock("RUNTIME HELPERS");
const PREFLIGHT = markerBlock("PREFLIGHT HELPERS");
// Stand-ins for helpers defined elsewhere in setup.sh.
const STUBS = `
run_privileged() { "$@"; }
run_as_current_user() { "$@"; }
register_temp_dir() { :; }
wait_for_apt_lock() { :; }
`;

const sandboxes = [];
function makeSandbox(name) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), `hc-runtime-${name}-`));
	sandboxes.push(root);
	const bin = path.join(root, "bin");
	fs.mkdirSync(bin, { recursive: true });
	fs.mkdirSync(path.join(root, "tmp"));
	return { root, bin, tmp: path.join(root, "tmp"), log: path.join(root, "mock.log") };
}

function runBash(sb, body, extraEnv = {}) {
	return spawnSync("bash", ["-c", `set -u\n${STUBS}\n${RUNTIME}\n${PREFLIGHT}\n${body}`], {
		env: {
			PATH: `${sb.bin}:/usr/bin:/bin`,
			HOME: sb.root,
			TMPDIR: sb.tmp,
			MOCK_LOG: sb.log,
			HOME_CLOUD_RUNTIME_DIR: path.join(sb.root, "runtime"),
			...extraEnv,
		},
		encoding: "utf8",
		timeout: 60000,
	});
}

function fakeNode(dir, version, { corepack = false } = {}) {
	writeExec(path.join(dir, "node"), `if [ "\${1:-}" = "-v" ]; then echo "${version}"; exit 0; fi\nexit 0`);
	if (corepack) writeExec(path.join(dir, "corepack"), 'echo "corepack $*" >> "$MOCK_LOG"');
	return path.join(dir, "node");
}

try {
	// -------------------------------------------------------------------------
	console.log("\n[Test 1] Node.js version and corepack detection");
	{
		const sb = makeSandbox("detect");
		const old = fakeNode(path.join(sb.root, "old"), "v20.11.0", { corepack: true });
		const tooOldPatch = fakeNode(path.join(sb.root, "patch"), "v22.23.3", { corepack: true });
		const noCorepack = fakeNode(path.join(sb.root, "nocp"), "v26.13.0");
		const good = fakeNode(path.join(sb.root, "good"), "v24.22.2", { corepack: true });
		const check = (bin) => runBash(sb, `node_is_usable "${bin}"`).status;
		assert.notEqual(check(old), 0, "Node 20 must be rejected");
		assert.notEqual(check(tooOldPatch), 0, "Node 22.23.3 must be rejected");
		assert.notEqual(check(noCorepack), 0, "Node without corepack and without pinned pnpm must be rejected");
		assert.equal(check(good), 0, "Node 24 with corepack must be accepted");
		assert.notEqual(check(path.join(sb.root, "missing", "node")), 0, "missing binary must be rejected");

		writeExec(path.join(sb.bin, "pnpm"), 'if [ "$1" = "--version" ]; then echo "12.15.0"; fi');
		assert.equal(check(noCorepack), 0, "Node without corepack is fine when pnpm is already pinned");
		console.log("  ✔ Rejects old Node and Node without a pnpm path; accepts Node 24 with corepack or pinned pnpm.");
	}

	// -------------------------------------------------------------------------
	console.log("\n[Test 2] Pinned Node.js install rejects a tampered download");
	{
		const sb = makeSandbox("tampered");
		writeExec(
			path.join(sb.bin, "curl"),
			'out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; *) shift;; esac; done; printf "evil" > "$out"',
		);
		const res = runBash(sb, "install_pinned_node");
		assert.notEqual(res.status, 0, "tampered tarball must fail");
		assert.match(res.stderr, /SHA256 verification failed/);
		const runtime = path.join(sb.root, "runtime");
		assert.ok(!fs.existsSync(runtime) || fs.readdirSync(runtime).length === 0, "nothing may be unpacked");
		assert.deepEqual(fs.readdirSync(sb.tmp), [], "download work dir must be removed");
		console.log("  ✔ Hash mismatch aborts before anything is unpacked; temp files removed.");
	}

	// -------------------------------------------------------------------------
	console.log("\n[Test 3] Pinned Node.js install unpacks a verified tarball atomically");
	{
		const sb = makeSandbox("install");
		const asset = runBash(sb, "node_pin_asset").stdout.trim();
		if (!asset) {
			console.log(`  ↷ Skipped: no pinned Node.js build for ${os.arch()}.`);
		} else {
			const src = path.join(sb.root, "src", asset);
			fakeNode(path.join(src, "bin"), "v24.22.2", { corepack: true });
			const tarball = path.join(sb.root, `${asset}.tar.xz`);
			const tar = spawnSync("tar", ["-cJf", tarball, "-C", path.join(sb.root, "src"), asset]);
			assert.equal(tar.status, 0, "fixture tarball must build");
			const sha = crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
			writeExec(
				path.join(sb.bin, "curl"),
				`out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; *) shift;; esac; done; cp "${tarball}" "$out"`,
			);
			// Swap only the hash table so the fixture verifies; the unpack and move logic is the real one.
			const res = runBash(sb, `node_pin_sha256() { echo "${sha}"; }\ninstall_pinned_node`);
			assert.equal(res.status, 0, `install failed:\n${res.stdout}\n${res.stderr}`);
			const nodeDir = path.join(sb.root, "runtime", "node-v24.22.2");
			assert.ok(fs.existsSync(path.join(nodeDir, "bin", "node")), "node binary must be installed");
			assert.ok(fs.existsSync(path.join(nodeDir, "bin", "corepack")), "corepack must be installed");
			assert.equal(fs.statSync(nodeDir).mode & 0o777, 0o755, "runtime dir must be traversable by the service user");
			assert.deepEqual(
				fs.readdirSync(path.join(sb.root, "runtime")).filter((n) => n.startsWith(".node-stage")),
				[],
				"staging dir must not be left behind",
			);
			assert.deepEqual(fs.readdirSync(sb.tmp), [], "download work dir must be removed");

			const again = runBash(sb, `node_pin_sha256() { echo "${sha}"; }\ninstall_pinned_node`);
			assert.equal(again.status, 0, "re-install over an existing runtime must succeed");
			console.log("  ✔ Verified tarball unpacked to runtime/node-v24.22.2 (0755), no staging leftovers, re-install works.");
		}
	}

	// -------------------------------------------------------------------------
	console.log("\n[Test 4] Pinned Node.js hashes match the official SHASUMS format");
	{
		const sb = makeSandbox("hashes");
		for (const asset of ["node-v24.22.2-linux-x64", "node-v24.22.2-linux-arm64"]) {
			const out = runBash(sb, `node_pin_sha256 "${asset}"`).stdout.trim();
			assert.match(out, /^[0-9a-f]{64}$/, `${asset} must have a pinned SHA256`);
		}
		assert.notEqual(runBash(sb, 'node_pin_sha256 "node-v24.22.2-linux-armv7l"').status, 0);
		console.log("  ✔ x64 and arm64 are pinned; unknown assets are refused.");
	}

	// -------------------------------------------------------------------------
	console.log("\n[Test 5] Docker apt repository targeting");
	{
		const sb = makeSandbox("apt-target");
		const target = (vars) => {
			const exports = Object.entries(vars)
				.map(([k, v]) => `${k}="${v}"`)
				.join("; ");
			const r = runBash(sb, `ID=""; ID_LIKE=""; UBUNTU_CODENAME=""; VERSION_CODENAME=""; DEBIAN_CODENAME=""; ${exports}; docker_apt_target`);
			return r.status === 0 ? r.stdout.trim() : null;
		};
		assert.equal(target({ ID: "ubuntu", VERSION_CODENAME: "noble", UBUNTU_CODENAME: "noble" }), "ubuntu noble");
		assert.equal(target({ ID: "debian", VERSION_CODENAME: "bookworm" }), "debian bookworm");
		assert.equal(target({ ID: "linuxmint", ID_LIKE: "ubuntu debian", VERSION_CODENAME: "wilma", UBUNTU_CODENAME: "noble" }), "ubuntu noble");
		assert.equal(target({ ID: "pop", ID_LIKE: "ubuntu debian", UBUNTU_CODENAME: "jammy" }), "ubuntu jammy");
		assert.equal(target({ ID: "arch" }), null);
		console.log("  ✔ Ubuntu, Debian and Ubuntu derivatives (Mint, Pop!_OS) map to Docker's repo; others fall back.");
	}

	// -------------------------------------------------------------------------
	console.log("\n[Test 6] Docker repository is not added when the signing key fingerprint is wrong");
	{
		const sb = makeSandbox("docker-key");
		writeExec(
			path.join(sb.bin, "curl"),
			'echo "curl $*" >> "$MOCK_LOG"; out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; *) shift;; esac; done; printf "key" > "$out"',
		);
		writeExec(path.join(sb.bin, "gpg"), 'echo "fpr:::::::::0000000000000000000000000000000000000000:"');
		writeExec(path.join(sb.bin, "dpkg"), 'echo amd64');
		writeExec(path.join(sb.bin, "install"), 'echo "install $*" >> "$MOCK_LOG"');
		writeExec(path.join(sb.bin, "tee"), 'echo "tee $*" >> "$MOCK_LOG"; cat >/dev/null');
		writeExec(path.join(sb.bin, "apt-get"), 'echo "apt-get $*" >> "$MOCK_LOG"');
		const res = runBash(sb, 'ID=ubuntu; UBUNTU_CODENAME=noble; ID_LIKE=""; install_docker_apt_repo');
		assert.notEqual(res.status, 0, "wrong fingerprint must fail");
		assert.match(res.stderr, /fingerprint did not match/);
		const log = fs.readFileSync(sb.log, "utf8");
		assert.match(log, /download\.docker\.com\/linux\/ubuntu\/gpg/);
		assert.doesNotMatch(log, /^install |^tee |^apt-get /m, "no keyring, source list or package install may happen");
		assert.deepEqual(fs.readdirSync(sb.tmp), [], "key download dir must be removed");
		console.log("  ✔ Fingerprint mismatch stops before writing a keyring or apt source.");
	}

	// -------------------------------------------------------------------------
	console.log("\n[Test 7] Failed apt update removes the Docker source list");
	{
		const sb = makeSandbox("docker-apt-fail");
		writeExec(
			path.join(sb.bin, "curl"),
			'out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; *) shift;; esac; done; printf "key" > "$out"',
		);
		writeExec(path.join(sb.bin, "gpg"), 'echo "fpr:::::::::9DC858229FC7DD38854AE2D88D81803C0EBFCD88:"');
		writeExec(path.join(sb.bin, "dpkg"), 'echo amd64');
		writeExec(path.join(sb.bin, "install"), 'echo "install $*" >> "$MOCK_LOG"');
		writeExec(path.join(sb.bin, "tee"), 'echo "tee $*" >> "$MOCK_LOG"; cat >/dev/null');
		writeExec(path.join(sb.bin, "rm"), 'echo "rm $*" >> "$MOCK_LOG"; exec /bin/rm "$@"');
		writeExec(
			path.join(sb.bin, "apt-get"),
			'echo "apt-get $*" >> "$MOCK_LOG"; if [ "$1" = "update" ]; then exit 100; fi',
		);
		const res = runBash(sb, 'ID=debian; VERSION_CODENAME=kali-rolling; ID_LIKE=""; install_docker_apt_repo');
		assert.notEqual(res.status, 0, "unsupported codename must fail");
		const log = fs.readFileSync(sb.log, "utf8");
		assert.match(log, /tee \/etc\/apt\/sources\.list\.d\/docker\.list/);
		assert.match(log, /rm -f \/etc\/apt\/sources\.list\.d\/docker\.list/, "broken source list must be removed");
		assert.doesNotMatch(log, /apt-get install/, "no package install after a failed update");
		console.log("  ✔ An unsupported release removes docker.list so later apt runs keep working.");
	}

	// -------------------------------------------------------------------------
	console.log("\n[Test 8] Compose plugin falls back to the distribution package name");
	{
		const sb = makeSandbox("compose");
		const state = path.join(sb.root, "compose-ok");
		writeExec(
			path.join(sb.bin, "apt-get"),
			`echo "apt-get $*" >> "$MOCK_LOG"; for a in "$@"; do if [ "$a" = "docker-compose-plugin" ]; then exit 100; fi; if [ "$a" = "docker-compose-v2" ]; then : > "${state}"; fi; done`,
		);
		writeExec(path.join(sb.bin, "docker"), `if [ "$1" = "compose" ] && [ -f "${state}" ]; then exit 0; fi; exit 1`);
		const res = runBash(sb, "PKG_MANAGER=apt; install_compose_plugin");
		assert.equal(res.status, 0, `compose fallback failed:\n${res.stderr}`);
		const log = fs.readFileSync(sb.log, "utf8");
		assert.match(log, /docker-compose-plugin[\s\S]*docker-compose-v2/, "must try Docker's name, then Ubuntu's");
		console.log("  ✔ docker-compose-plugin missing → docker-compose-v2 installed.");
	}

	// -------------------------------------------------------------------------
	console.log("\n[Test 9] WSL systemd enablement edits wsl.conf idempotently");
	{
		const sb = makeSandbox("wsl");
		const conf = path.join(sb.root, "wsl.conf");
		const run = () => runBash(sb, "enable_wsl_systemd", { HOME_CLOUD_WSL_CONF: conf });

		assert.equal(run().status, 0);
		assert.match(fs.readFileSync(conf, "utf8"), /\[boot\]\nsystemd=true/);

		fs.writeFileSync(conf, "[boot]\ncommand=echo hi\n\n[network]\nhostname=box\n");
		assert.equal(run().status, 0);
		const edited = fs.readFileSync(conf, "utf8");
		assert.match(edited, /\[boot\]\nsystemd=true\ncommand=echo hi/);
		assert.equal((edited.match(/\[boot\]/g) || []).length, 1, "must not add a second [boot] section");

		assert.equal(run().status, 0);
		assert.equal(fs.readFileSync(conf, "utf8"), edited, "already-enabled config must be left unchanged");
		console.log("  ✔ Adds [boot] systemd=true, reuses an existing [boot] section, and is idempotent.");
	}

	// -------------------------------------------------------------------------
	console.log("\n[Test 10] Dry-run with an old Node.js plans a private Node.js install");
	{
		const sb = makeSandbox("dry-run");
		fakeNode(sb.bin, "v18.19.0", { corepack: true });
		const res = spawnSync("bash", [SETUP_SH, "--dry-run", "--non-interactive", "--skip-cloudflared", "--dir", REPO_ROOT], {
			env: {
				PATH: `${sb.bin}:/usr/bin:/bin`,
				HOME: sb.root,
				TMPDIR: sb.tmp,
				MOCK_LOG: sb.log,
				HOME_CLOUD_RUNTIME_DIR: path.join(sb.root, "runtime"),
				HOME_CLOUD_SYSTEMD_DIR: path.join(sb.root, "systemd"),
				HOME_CLOUD_STATE_DIR: path.join(sb.root, "state"),
				XDG_STATE_HOME: path.join(sb.root, "state"),
			},
			encoding: "utf8",
			timeout: 120000,
		});
		const out = res.stdout + res.stderr;
		assert.match(out, /Found Node\.js v18\.19\.0/, out);
		assert.match(out, /\[DRY-RUN\] Would download Node\.js 24\.22\.2, verify its SHA256/, out);
		assert.doesNotMatch(out, /must be installed by the operator/);
		assert.ok(!fs.existsSync(path.join(sb.root, "runtime")), "dry-run must not install anything");
		console.log("  ✔ Old Node.js is detected and a private Node.js 24.22.2 install is planned, nothing written.");
	}

	// -------------------------------------------------------------------------
	console.log("\n[Test 11] Installs the latest published release, never unreleased commits");
	{
		const RELEASE = markerBlock("RELEASE HELPERS");
		const sb = makeSandbox("release");
		const resolve = (curlBody, lsRemote) => {
			writeExec(path.join(sb.bin, "curl"), curlBody);
			writeExec(path.join(sb.bin, "git"), `if [ "$1" = "ls-remote" ]; then ${lsRemote}; fi`);
			return spawnSync("bash", ["-c", `set -u\n${RELEASE}\nresolve_latest_release_tag`], {
				env: { PATH: `${sb.bin}:/usr/bin:/bin`, HOME: sb.root },
				encoding: "utf8",
			});
		};
		const tags = "printf '%s\\trefs/tags/%s\\n' a v1.0.1 b v1.9.0 c v1.10.0 d v2.0.0-rc1 e testing";

		const redirect = resolve(`printf 'https://github.com/Cypher0071/Home_Cloud/releases/tag/v1.0.1'`, tags);
		assert.equal(redirect.status, 0, redirect.stderr);
		assert.equal(redirect.stdout.trim(), "v1.0.1", "the published latest release wins over newer unreleased tags");

		const fallback = resolve("exit 22", tags);
		assert.equal(fallback.status, 0, fallback.stderr);
		assert.equal(fallback.stdout.trim(), "v1.10.0", "fallback picks the highest stable version tag");
		assert.match(fallback.stderr, /Could not reach GitHub's latest-release page/);

		// No release published yet: github.com lands on the releases list, not a tag.
		const noRelease = resolve(`printf 'https://github.com/Cypher0071/Home_Cloud/releases'`, "exit 2");
		assert.notEqual(noRelease.status, 0, "no release and no tags must fail, not install main");
		const bogus = resolve(`printf 'https://github.com/Cypher0071/Home_Cloud/releases/tag/main'`, "exit 2");
		assert.notEqual(bogus.status, 0, "a non-version tag must be refused");

		const setupSrc = setupSource;
		assert.doesNotMatch(setupSrc, /DEFAULT_CLONE_BRANCH|clone --branch "\$\{BRANCH:-/, "no fallback to main may remain");
		console.log("  ✔ Uses GitHub's latest release; falls back to the highest stable tag; never falls back to main.");
	}

	{
		// Regression: the env step reads agent/.env with the agent's dotenv package, so a fresh
		// clone (no node_modules yet) must run pnpm install before that step's first use.
		const install = setupSource.indexOf("run_as_current_user pnpm install --frozen-lockfile");
		const firstDotenvRun = setupSource.indexOf('CURRENT_JWT_STATE="$(');
		const envStep = setupSource.indexOf('echo "⚙ Configuring environment & security credentials..."');
		assert.ok(install >= 0 && firstDotenvRun >= 0 && envStep >= 0, "setup.sh install and env markers must exist");
		assert.ok(install < envStep, "pnpm install must run before the env step, which requires dotenv");
		assert.ok(install < firstDotenvRun, "pnpm install must run before dotenv is first required");
		assert.equal(setupSource.split("pnpm install --frozen-lockfile)").length - 1, 1, "dependencies are installed exactly once");
		console.log("  ✔ Dependencies are installed before the env step needs dotenv.");
	}

	console.log("\n=== ALL RUNTIME BOOTSTRAP TESTS PASSED ===");
} finally {
	for (const dir of sandboxes) fs.rmSync(dir, { recursive: true, force: true });
}
