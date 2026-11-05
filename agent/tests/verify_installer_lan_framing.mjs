import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const SETUP_SH = path.join(REPO_ROOT, "setup.sh");

console.log("=== Running Installer, LAN Identity & Security Headers Verification Tests ===");

// =============================================================================
// Section 1: setup.sh Password Flags & argv Warning Tests
// =============================================================================
console.log("\n[Section 1] setup.sh Password Handling & argv Deprecation Warnings");

function runSetup(args, options = {}) {
	const { env = {}, stdin = "" } = options;
	return spawnSync("bash", [SETUP_SH, ...args], {
		cwd: REPO_ROOT,
		input: stdin,
		env: {
			...process.env,
			NON_INTERACTIVE: "true",
			DRY_RUN: "true",
			...env,
		},
		encoding: "utf8",
		timeout: 15000,
	});
}

// 1.1 --password-file accepts valid readable file
{
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hc-pw-test-"));
	try {
		const pwFile = path.join(tmpDir, "password.txt");
		fs.writeFileSync(pwFile, "super-secret-password-123\n", { mode: 0o600 });

		const res = runSetup(["--password-file", pwFile]);
		assert.equal(res.status, 0, `Failed with code ${res.status}: ${res.stderr}`);
		assert.doesNotMatch(res.stderr, /Warning:.*visible to other local users/);
		console.log("  ✔ --password-file loads password without argv warnings");
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

// 1.2 --password-file rejects unreadable or missing file
{
	const resMissing = runSetup(["--password-file", "/nonexistent/path/to/pass.txt"]);
	assert.equal(resMissing.status, 1);
	assert.match(resMissing.stderr, /Error: --password-file requires a readable file\./);

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hc-pw-unreadable-"));
	try {
		// Directory instead of file
		const resDir = runSetup(["--password-file", tmpDir]);
		assert.equal(resDir.status, 1);
		assert.match(resDir.stderr, /Error: --password-file requires a readable file\./);
		console.log("  ✔ --password-file strictly refuses nonexistent or directory targets");
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

// 1.3 --password-stdin reads from stdin
{
	const res = runSetup(["--password-stdin"], { stdin: "stdin-master-password-456\n" });
	assert.equal(res.status, 0, `Failed with code ${res.status}: ${res.stderr}`);
	assert.doesNotMatch(res.stderr, /Warning:.*visible to other local users/);
	console.log("  ✔ --password-stdin reads password safely without argv warnings");
}

// 1.4 -p / --password emits visible-in-/proc stderr warning
{
	const resShort = runSetup(["-p", "compat-pass-789"]);
	assert.equal(resShort.status, 0);
	assert.match(resShort.stderr, /Warning: -p is visible to other local users via \/proc/);

	const resLong = runSetup(["--password", "compat-pass-789"]);
	assert.equal(resLong.status, 0);
	assert.match(resLong.stderr, /Warning: --password is visible to other local users via \/proc/);

	const resEqual = runSetup(["--password=compat-pass-789"]);
	assert.equal(resEqual.status, 0);
	assert.match(resEqual.stderr, /Warning: --password is visible to other local users via \/proc/);
	console.log("  ✔ -p, --password, and --password= emit deprecation warnings to stderr");
}

// 1.5 Password length enforcement
{
	const resShort = runSetup(["--password-stdin"], { stdin: "short\n" });
	assert.equal(resShort.status, 1);
	assert.match(resShort.stderr, /Error: password must be at least 8 characters\./);
	console.log("  ✔ Password minimum 8-character length is enforced");
}

// =============================================================================
// Section 2: OpenSSH Loopback Hardening & Tunnel Ingress Tests
// =============================================================================
console.log("\n[Section 2] OpenSSH Loopback Hardening Drop-in & Tunnel Ingress");

function createSshSandbox(name) {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hc-ssh-test-${name}-`));
	const home = path.join(tmpDir, "home");
	const bin = path.join(tmpDir, "bin");
	const repo = path.join(tmpDir, "repo");
	const cfDir = path.join(home, ".cloudflared");
	const etcSsh = path.join(tmpDir, "etc", "ssh");
	const sshdConfigD = path.join(etcSsh, "sshd_config.d");
	const stateDir = path.join(home, ".state");

	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(bin, { recursive: true });
	fs.mkdirSync(repo, { recursive: true });
	fs.mkdirSync(cfDir, { recursive: true });
	fs.mkdirSync(sshdConfigD, { recursive: true });
	fs.mkdirSync(stateDir, { recursive: true });

	// Mock sudo
	fs.writeFileSync(
		path.join(bin, "sudo"),
		`#!/usr/bin/env bash\nif [ "\${1:-}" = "-u" ]; then shift 2; fi\nif [ "\${1:-}" = "-H" ]; then shift; fi\nexec "$@"\n`,
		{ mode: 0o755 },
	);

	// Mock systemctl
	fs.writeFileSync(
		path.join(bin, "systemctl"),
		`#!/usr/bin/env bash\necho "systemctl $*" >> "${path.join(tmpDir, "systemctl.log")}"\nexit 0\n`,
		{ mode: 0o755 },
	);

	return { tmpDir, home, bin, repo, cfDir, etcSsh, sshdConfigD, stateDir };
}

function runTunnelInSandbox(sb, options = {}) {
	const {
		env = {},
		sshdFails = false,
		mockCloudflared = true,
	} = options;

	if (mockCloudflared) {
		const mockCf = path.join(sb.bin, "cloudflared");
		const uuid = "12345678-abcd-ef01-2345-6789abcdef01";
		fs.writeFileSync(
			mockCf,
			`#!/usr/bin/env bash\ncase "$2" in\n  list) echo "ID NAME CREATED"; echo "${uuid} home-cloud 2026-01-01"; exit 0 ;;\n  route) exit 0 ;;\n  *) exit 0 ;;\nesac\n`,
			{ mode: 0o755 },
		);
		fs.writeFileSync(path.join(sb.cfDir, "cert.pem"), "dummy-cert");
		fs.writeFileSync(path.join(sb.cfDir, `${uuid}.json`), `{"TunnelID":"${uuid}"}`);
	}

	const mockSshd = path.join(sb.bin, "sshd");
	fs.writeFileSync(
		mockSshd,
		`#!/usr/bin/env bash\necho "sshd $*" >> "${path.join(sb.tmpDir, "sshd.log")}"\nif [ "${sshdFails ? "1" : "0"}" = "1" ]; then exit 1; fi\nexit 0\n`,
		{ mode: 0o755 },
	);

	const script = `
        SETUP_SH="${SETUP_SH}"
        eval "$(awk '/^run_as_current_user\\(\\)/,/# 2\\. Install/' "$SETUP_SH" | head -n -1)"
        eval "$(awk '/^setup_cloudflare_tunnel\\(\\)/,/^setup_cloudflare_tunnel$/' "$SETUP_SH" | head -n -1)"
        setup_cloudflare_tunnel
    `;

	const runEnv = {
		...process.env,
		PATH: `${sb.bin}:${process.env.PATH}`,
		CURRENT_HOME: sb.home,
		CURRENT_USER: "testuser",
		CURRENT_GROUP: "testuser",
		ACTIVE_IP: "192.168.1.100",
		HOME_CLOUD_STATE_DIR: sb.stateDir,
		HOME_CLOUD_SSHD_CONFIG: path.join(sb.etcSsh, "sshd_config"),
		HOME_CLOUD_SSHD_CONFIG_DIR: sb.sshdConfigD,
		CF_DOMAIN: "test.example.com",
		DRY_RUN: "false",
		NON_INTERACTIVE: "true",
		...env,
	};

	return spawnSync("bash", ["-c", script], {
		cwd: sb.repo,
		env: runEnv,
		encoding: "utf8",
		timeout: 15000,
	});
}

// 2.1 Authorized keys + Include directive -> drop-in installed, validated, ssh ingress published
{
	const sb = createSshSandbox("happy-ssh");
	try {
		// Valid authorized_keys
		const sshDir = path.join(sb.home, ".ssh");
		fs.mkdirSync(sshDir, { recursive: true });
		fs.writeFileSync(path.join(sshDir, "authorized_keys"), "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host\n");

		// Valid sshd_config with Include
		fs.writeFileSync(
			path.join(sb.etcSsh, "sshd_config"),
			"Include /etc/ssh/sshd_config.d/*.conf\nPort 22\n",
		);

		const res = runTunnelInSandbox(sb);
		assert.equal(res.status, 0, `Execution failed: ${res.stderr}\n${res.stdout}`);

		// Drop-in written
		const dropinPath = path.join(sb.sshdConfigD, "60-home-cloud-tunnel.conf");
		assert.equal(fs.existsSync(dropinPath), true, "sshd drop-in must exist");
		const dropinContent = fs.readFileSync(dropinPath, "utf8");
		assert.match(dropinContent, /Match Address 127\.0\.0\.1,::1/);
		assert.match(dropinContent, /PasswordAuthentication no/);
		assert.match(dropinContent, /KbdInteractiveAuthentication no/);

		// sshd -t validation was executed
		const sshdLog = fs.readFileSync(path.join(sb.tmpDir, "sshd.log"), "utf8");
		assert.match(sshdLog, /-t/);

		// systemctl reload was invoked
		const systemctlLog = fs.readFileSync(path.join(sb.tmpDir, "systemctl.log"), "utf8");
		assert.match(systemctlLog, /reload (ssh|sshd)/);

		// config.yml includes ssh ingress
		const configYml = fs.readFileSync(path.join(sb.cfDir, "config.yml"), "utf8");
		assert.match(configYml, /hostname: ssh\.test\.example\.com/);
		assert.match(configYml, /service: ssh:\/\/localhost:22/);

		console.log("  ✔ OpenSSH drop-in installed with Match Address loopback key-only restriction and ssh ingress published");
	} finally {
		fs.rmSync(sb.tmpDir, { recursive: true, force: true });
	}
}

// 2.2 Missing authorized_keys -> skips ssh ingress & gives clear setup instructions
{
	const sb = createSshSandbox("no-auth-keys");
	try {
		fs.writeFileSync(
			path.join(sb.etcSsh, "sshd_config"),
			"Include /etc/ssh/sshd_config.d/*.conf\nPort 22\n",
		);

		const res = runTunnelInSandbox(sb);
		assert.equal(res.status, 0);

		// Drop-in must NOT be created
		const dropinPath = path.join(sb.sshdConfigD, "60-home-cloud-tunnel.conf");
		assert.equal(fs.existsSync(dropinPath), false, "drop-in must not be created without authorized_keys");

		// Stderr / Stdout warning and instructions
		assert.match(res.stdout, /No non-empty ~(\/|\\)\.ssh(\/|\\)authorized_keys found/);
		assert.match(res.stdout, /ssh-copy-id/);

		// config.yml does NOT include ssh
		const configYml = fs.readFileSync(path.join(sb.cfDir, "config.yml"), "utf8");
		assert.doesNotMatch(configYml, /hostname: ssh\./);

		console.log("  ✔ Missing authorized_keys skips ssh ingress with ssh-copy-id instructions to prevent lockout");
	} finally {
		fs.rmSync(sb.tmpDir, { recursive: true, force: true });
	}
}

// 2.3 sshd_config lacking Include directive -> leaves sshd untouched and skips ssh ingress
{
	const sb = createSshSandbox("no-include");
	try {
		const sshDir = path.join(sb.home, ".ssh");
		fs.mkdirSync(sshDir, { recursive: true });
		fs.writeFileSync(path.join(sshDir, "authorized_keys"), "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host\n");

		// sshd_config without Include
		const mainConfigPath = path.join(sb.etcSsh, "sshd_config");
		fs.writeFileSync(mainConfigPath, "Port 22\nPermitRootLogin no\n");

		const res = runTunnelInSandbox(sb);
		assert.equal(res.status, 0);

		// sshd_config was not modified
		assert.equal(fs.readFileSync(mainConfigPath, "utf8"), "Port 22\nPermitRootLogin no\n");
		assert.equal(fs.existsSync(path.join(sb.sshdConfigD, "60-home-cloud-tunnel.conf")), false);
		assert.match(res.stderr, /does not include sshd_config\.d/);

		// Ingress does not have ssh
		const configYml = fs.readFileSync(path.join(sb.cfDir, "config.yml"), "utf8");
		assert.doesNotMatch(configYml, /hostname: ssh\./);

		console.log("  ✔ sshd_config lacking Include skips drop-in without mutating main sshd_config");
	} finally {
		fs.rmSync(sb.tmpDir, { recursive: true, force: true });
	}
}

// 2.4 sshd -t validation fails -> removes drop-in and leaves sshd untouched
{
	const sb = createSshSandbox("sshd-val-fail");
	try {
		const sshDir = path.join(sb.home, ".ssh");
		fs.mkdirSync(sshDir, { recursive: true });
		fs.writeFileSync(path.join(sshDir, "authorized_keys"), "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host\n");
		fs.writeFileSync(
			path.join(sb.etcSsh, "sshd_config"),
			"Include /etc/ssh/sshd_config.d/*.conf\n",
		);

		const res = runTunnelInSandbox(sb, { sshdFails: true });
		assert.equal(res.status, 0);

		// Drop-in removed upon validation failure
		const dropinPath = path.join(sb.sshdConfigD, "60-home-cloud-tunnel.conf");
		assert.equal(fs.existsSync(dropinPath), false, "drop-in must be removed if validation fails");
		assert.match(res.stderr, /OpenSSH validation \(sshd -t\) failed with drop-in/);

		const configYml = fs.readFileSync(path.join(sb.cfDir, "config.yml"), "utf8");
		assert.doesNotMatch(configYml, /hostname: ssh\./);

		console.log("  ✔ sshd -t failure cleans up drop-in and skips ssh ingress");
	} finally {
		fs.rmSync(sb.tmpDir, { recursive: true, force: true });
	}
}

// 2.5 --skip-ssh flag skips everything
{
	const sb = createSshSandbox("skip-ssh-flag");
	try {
		const sshDir = path.join(sb.home, ".ssh");
		fs.mkdirSync(sshDir, { recursive: true });
		fs.writeFileSync(path.join(sshDir, "authorized_keys"), "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host\n");
		fs.writeFileSync(
			path.join(sb.etcSsh, "sshd_config"),
			"Include /etc/ssh/sshd_config.d/*.conf\n",
		);

		const res = runTunnelInSandbox(sb, { env: { SKIP_SSH: "true" } });
		assert.equal(res.status, 0);

		const dropinPath = path.join(sb.sshdConfigD, "60-home-cloud-tunnel.conf");
		assert.equal(fs.existsSync(dropinPath), false);
		const configYml = fs.readFileSync(path.join(sb.cfDir, "config.yml"), "utf8");
		assert.doesNotMatch(configYml, /hostname: ssh\./);
		assert.match(res.stdout, /Skipping SSH tunnel ingress configuration \(--skip-ssh\)\./);

		console.log("  ✔ SKIP_SSH=true skips ssh drop-in installation and tunnel ingress");
	} finally {
		fs.rmSync(sb.tmpDir, { recursive: true, force: true });
	}
}

// =============================================================================
// Section 3: LAN Identity Challenge-Response & Proof Cryptographic Contract
// =============================================================================
console.log("\n[Section 3] LAN Identity Proof & Verify Router Contract");

const TEST_JWT_SECRET = "super-secret-jwt-key-for-testing-purposes-1234";
process.env.JWT_SECRET = TEST_JWT_SECRET;

const lanIdentityRouter = (await import("../routes/lanIdentity.js")).default || (await import("../routes/lanIdentity.js"));

const app = express();
app.use(express.json());
app.use(cookieParser());

// Mock auth cookie verification using active preferences session epoch
const preferences = (await import("../services/preferences.js")).default || (await import("../services/preferences.js"));
const validToken = jwt.sign({ user: "admin", epoch: preferences.getSessionEpoch() }, TEST_JWT_SECRET);

// The proof route refuses loopback/tunnel peers. Simulate a direct LAN peer unless the test opts out.
app.use((req, res, next) => {
	Object.defineProperty(req.socket, "remoteAddress", { value: "192.168.1.50", configurable: true });
	next();
});
app.use("/api/lan-identity", lanIdentityRouter);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

try {
	// 3.1 Proof generation contract
	const nonce = crypto.randomBytes(16).toString("hex"); // 32 hex chars
	const proofRes = await fetch(`${baseUrl}/api/lan-identity/proof?nonce=${nonce}`);
	assert.equal(proofRes.status, 200);

	// CORS headers check
	assert.equal(proofRes.headers.get("access-control-allow-origin"), "*");
	assert.equal(proofRes.headers.get("access-control-allow-private-network"), "true");

	const proofData = await proofRes.json();
	assert.ok(proofData.proof, "Proof must be present in response");
	assert.match(proofData.proof, /^[0-9a-f]{64}$/);

	// Proof must match HMAC(derivedKey, nonce)
	const derivedKey = crypto.createHmac("sha256", TEST_JWT_SECRET).update("home-cloud:lan-identity-proof-v1").digest();
	const expectedProof = crypto.createHmac("sha256", derivedKey).update(nonce).digest("hex");
	assert.equal(proofData.proof, expectedProof);

	// Proof must never leak raw JWT_SECRET
	assert.notEqual(proofData.proof, TEST_JWT_SECRET);
	assert.doesNotMatch(JSON.stringify(proofData), new RegExp(TEST_JWT_SECRET));
	console.log("  ✔ /api/lan-identity/proof returns correct HMAC without leaking JWT_SECRET");

	// 3.2 Nonce validation strictness
	const badNonces = [
		"",
		"too-short",
		"1234567890123456789012345678901", // 31 chars
		"not-hex-chars-12345678901234567890123456789012",
		"a".repeat(65), // 65 chars
	];
	for (const bad of badNonces) {
		const res = await fetch(`${baseUrl}/api/lan-identity/proof?nonce=${encodeURIComponent(bad)}`);
		assert.equal(res.status, 400, `Nonce '${bad}' should have returned 400`);
	}
	console.log("  ✔ /api/lan-identity/proof strictly rejects invalid nonces (length & charset)");

	// 3.2b Relay protection: tunnel-forwarded and loopback requests never receive a proof
	const relayNonce = crypto.randomBytes(16).toString("hex");
	const viaTunnel = await fetch(`${baseUrl}/api/lan-identity/proof?nonce=${relayNonce}`, {
		headers: { "CF-Connecting-IP": "203.0.113.9" },
	});
	assert.equal(viaTunnel.status, 403, "tunnel-forwarded proof request must be refused");

	const bareApp = express();
	bareApp.use("/api/lan-identity", lanIdentityRouter);
	const bareServer = http.createServer(bareApp);
	await new Promise((resolve) => bareServer.listen(0, "127.0.0.1", resolve));
	try {
		const loopRes = await fetch(`http://127.0.0.1:${bareServer.address().port}/api/lan-identity/proof?nonce=${relayNonce}`);
		assert.equal(loopRes.status, 403, "loopback (cloudflared) peer must be refused");
	} finally {
		bareServer.close();
	}
	console.log("  ✔ /api/lan-identity/proof refuses tunnel-forwarded and loopback peers (no relay oracle)");

	// 3.3 Verify endpoint with valid auth and matching proof
	const verifyRes = await fetch(`${baseUrl}/api/lan-identity/verify`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: `token=${validToken}`,
		},
		body: JSON.stringify({ nonce, proof: expectedProof }),
	});
	assert.equal(verifyRes.status, 200);
	const verifyData = await verifyRes.json();
	assert.equal(verifyData.valid, true);
	console.log("  ✔ /api/lan-identity/verify accepts matching challenge proof when authenticated");

	// 3.4 Verify endpoint rejects wrong proof
	const wrongProof = crypto.randomBytes(32).toString("hex");
	const badVerifyRes = await fetch(`${baseUrl}/api/lan-identity/verify`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: `token=${validToken}`,
		},
		body: JSON.stringify({ nonce, proof: wrongProof }),
	});
	assert.equal(badVerifyRes.status, 200);
	const badVerifyData = await badVerifyRes.json();
	assert.equal(badVerifyData.valid, false);
	console.log("  ✔ /api/lan-identity/verify rejects mismatched proof");

	// 3.5 Verify endpoint rejects unauthenticated request
	const unauthRes = await fetch(`${baseUrl}/api/lan-identity/verify`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ nonce, proof: expectedProof }),
	});
	assert.equal(unauthRes.status, 401);
	console.log("  ✔ /api/lan-identity/verify rejects unauthenticated callers with 401");
} finally {
	server.close();
}

// =============================================================================
// Section 4: Security Headers (Anti-Framing & Sibling Clickjacking)
// =============================================================================
console.log("\n[Section 4] Security Headers (Anti-Framing & Sibling Clickjacking)");

const securityHeadersMiddleware = (await import("../middleware/securityHeaders.js")).default || (await import("../middleware/securityHeaders.js"));

const headerApp = express();
headerApp.use(securityHeadersMiddleware);
headerApp.get("/test", (req, res) => res.send("OK"));

const headerServer = http.createServer(headerApp);
await new Promise((resolve) => headerServer.listen(0, "127.0.0.1", resolve));
const headerPort = headerServer.address().port;

try {
	const res = await fetch(`http://127.0.0.1:${headerPort}/test`);
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
	assert.equal(res.headers.get("content-security-policy"), "frame-ancestors 'self'");
	assert.equal(res.headers.get("x-content-type-options"), "nosniff");
	console.log("  ✔ Security headers present: X-Frame-Options: SAMEORIGIN, CSP: frame-ancestors 'self', X-Content-Type-Options: nosniff");
} finally {
	headerServer.close();
}

console.log("\n=== ALL INSTALLER, LAN IDENTITY & SECURITY HEADER TESTS PASSED ===");
