import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

// Isolate test environment
const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "home-cloud-origin-test-"));
process.env.HOME = testTmpDir;
process.env.XDG_CONFIG_HOME = path.join(testTmpDir, ".config");
process.env.HOME_CLOUD_CONFIG_DIR = path.join(testTmpDir, ".config", "home-cloud");
process.env.AGENT_ENV_FILE = path.join(testTmpDir, ".env");
process.env.CF_CONFIG = path.join(testTmpDir, ".cloudflared", "config.yml");
process.env.BASE_DIR = testTmpDir;

const require = createRequire(import.meta.url);
const agentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { assertRuntimeSecrets } = require("../config.js");
const preferences = require("../services/preferences.js");
const { shellEnvironment } = require("../sockets/terminal.js");
const { server } = require("../index.js");

console.log("--- Running Origin, Logout, and Startup Secret Tests ---");

const JWT_SECRET = "origin-test-jwt-secret-32-chars-min";
const TEST_PASSWORD = "origin-test-password";
process.env.JWT_SECRET = JWT_SECRET;
process.env.PASSWORD = TEST_PASSWORD;

function runSecretCheck(env) {
	const script = `
		const { assertRuntimeSecrets } = require("./config.js");
		assertRuntimeSecrets();
		console.log("SECRETS_OK");
	`;
	return spawnSync(process.execPath, ["-e", script], {
		cwd: agentDir,
		env: { ...process.env, ...env },
		encoding: "utf8",
		timeout: 15000,
	});
}

try {
	console.log("[Test 1] Placeholder, short, and missing secrets refuse to start");
	const placeholderPassword = runSecretCheck({
		PASSWORD: "change-me",
		JWT_SECRET,
	});
	assert.equal(placeholderPassword.status, 1, "placeholder PASSWORD must exit 1");
	assert.match(placeholderPassword.stderr, /Refusing to start/);
	assert.match(placeholderPassword.stderr, /PASSWORD/);

	const shortPassword = runSecretCheck({
		PASSWORD: "short",
		JWT_SECRET,
	});
	assert.equal(shortPassword.status, 1, "short PASSWORD must exit 1");

	const missingPassword = runSecretCheck({
		PASSWORD: "",
		JWT_SECRET,
	});
	assert.equal(missingPassword.status, 1, "missing PASSWORD must exit 1");

	const placeholderJwt = runSecretCheck({
		PASSWORD: TEST_PASSWORD,
		JWT_SECRET: "generate-a-long-random-string",
	});
	assert.equal(placeholderJwt.status, 1, "placeholder JWT_SECRET must exit 1");
	assert.match(placeholderJwt.stderr, /JWT_SECRET/);

	const shortJwt = runSecretCheck({
		PASSWORD: TEST_PASSWORD,
		JWT_SECRET: "too-short",
	});
	assert.equal(shortJwt.status, 1, "short JWT_SECRET must exit 1");

	const missingJwt = runSecretCheck({
		PASSWORD: TEST_PASSWORD,
		JWT_SECRET: "",
	});
	assert.equal(missingJwt.status, 1, "missing JWT_SECRET must exit 1");

	const accepted = runSecretCheck({
		PASSWORD: TEST_PASSWORD,
		JWT_SECRET,
	});
	assert.equal(accepted.status, 0, accepted.stderr || "valid secrets must pass");
	assert.match(accepted.stdout, /SECRETS_OK/);

	const boot = spawnSync(process.execPath, ["index.js"], {
		cwd: agentDir,
		env: {
			...process.env,
			PASSWORD: "change-me",
			JWT_SECRET,
			PORT: "0",
		},
		encoding: "utf8",
		timeout: 15000,
	});
	assert.equal(boot.status, 1, "index.js must refuse placeholder PASSWORD before listen");
	assert.match(boot.stderr, /Refusing to start/);
	assert.equal(typeof assertRuntimeSecrets, "function");
	console.log("  ✔ Startup secret check rejects placeholders, short, and missing secrets and accepts a real pair");

	console.log("[Test 2] PTY environment is an allowlist and purges secrets");
	const previousPassword = process.env.PASSWORD;
	const previousJwt = process.env.JWT_SECRET;
	process.env.GITHUB_TOKEN = "should-not-leak";
	process.env.SOME_SECRET = "should-not-leak-either";
	process.env.CUSTOM_TOKEN = "custom-token-val";
	const shellEnv = shellEnvironment();
	assert.equal(shellEnv.PASSWORD, undefined);
	assert.equal(shellEnv.JWT_SECRET, undefined);
	assert.equal(shellEnv.GITHUB_TOKEN, undefined);
	assert.equal(shellEnv.SOME_SECRET, undefined);
	assert.equal(shellEnv.CUSTOM_TOKEN, undefined);
	assert.equal(shellEnv.LC_ALL, "C.UTF-8");
	assert.ok(shellEnv.PATH || shellEnv.HOME, "allowlist still copies a basic variable when set");
	process.env.PASSWORD = previousPassword;
	process.env.JWT_SECRET = previousJwt;
	delete process.env.GITHUB_TOKEN;
	delete process.env.SOME_SECRET;
	delete process.env.CUSTOM_TOKEN;
	console.log("  ✔ Shell environment omits agent secrets");

	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const baseUrl = `http://127.0.0.1:${address.port}`;

	function waitForClose(ws) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				ws.terminate();
				reject(new Error("websocket did not close"));
			}, 4000);
			ws.once("close", (code) => {
				clearTimeout(timer);
				resolve(code);
			});
			ws.once("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});
		});
	}

	console.log("[Test 3] State-changing requests require the dashboard origin");
	const foreignLogin = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "https://grafana.example.com",
		},
		body: JSON.stringify({ password: TEST_PASSWORD }),
	});
	assert.equal(foreignLogin.status, 403);
	const foreignBody = await foreignLogin.json();
	assert.equal(foreignBody.error, "Cross-origin request rejected");

	const missingOrigin = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: TEST_PASSWORD }),
	});
	assert.equal(missingOrigin.status, 403);

	const foreignStop = await fetch(`${baseUrl}/api/docker/containers/abc/stop`, {
		method: "POST",
		headers: { Origin: "http://grafana.example.com" },
	});
	assert.equal(foreignStop.status, 403, "sibling origin must not reach docker stop");

	const forwardedSibling = await fetch(`${baseUrl}/api/docker/containers/abc/stop`, {
		method: "POST",
		headers: {
			Origin: "https://grafana.example.com",
			"X-Forwarded-Host": "dash.example.com",
			"X-Forwarded-Proto": "https",
		},
	});
	assert.equal(forwardedSibling.status, 403, "only the requested host is allowed");

	const forwardedDash = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "https://dash.example.com",
			"X-Forwarded-Host": "dash.example.com",
			"X-Forwarded-Proto": "https",
		},
		body: JSON.stringify({ password: "wrong-password-value" }),
	});
	assert.equal(forwardedDash.status, 401, "dash host origin must pass the guard");
	const forwardedBody = await forwardedDash.json();
	assert.equal(forwardedBody.error, "Invalid password");
	assert.equal("remainingAttempts" in forwardedBody, false);

	const refererLogin = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Referer: `${baseUrl}/login`,
		},
		body: JSON.stringify({ password: "wrong-password-value" }),
	});
	assert.equal(refererLogin.status, 401, "same-origin Referer may stand in for a missing Origin");

	const sameOriginStop = await fetch(`${baseUrl}/api/docker/containers/abc/stop`, {
		method: "POST",
		headers: { Origin: baseUrl },
	});
	assert.equal(sameOriginStop.status, 401, "same-origin stop passes the origin guard and hits auth");

	const ping = await fetch(`${baseUrl}/api/ping`, {
		headers: { Origin: "https://grafana.example.com" },
	});
	assert.equal(ping.status, 200);
	assert.deepEqual(await ping.json(), { status: "ok" });
	console.log("  ✔ Foreign origins are rejected and the dashboard origin still works");

	console.log("[Test 4] WebSocket upgrades require the dashboard origin");
	const foreignSocket = new WebSocket(`ws://127.0.0.1:${address.port}/terminal`, {
		origin: "https://grafana.example.com",
	});
	assert.equal(await waitForClose(foreignSocket), 1008);

	const missingSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/docker/exec`);
	assert.equal(await waitForClose(missingSocket), 1008);

	const sameSocket = new WebSocket(`ws://127.0.0.1:${address.port}/terminal`, {
		origin: baseUrl,
	});
	const sameCode = await waitForClose(sameSocket);
	assert.notEqual(sameCode, 1008, "same-origin upgrade must not be rejected as a foreign origin");
	console.log("  ✔ Foreign and missing WebSocket origins close with 1008");

	console.log("[Test 5] Logout revokes every session and keeps the cookie host-only");
	const before = preferences.getSessionEpoch();
	const anonymousLogout = await fetch(`${baseUrl}/api/auth/logout`, {
		method: "POST",
		headers: { Origin: baseUrl },
	});
	assert.equal(anonymousLogout.status, 401, "logout must require an authenticated session");
	assert.equal(preferences.getSessionEpoch(), before, "anonymous logout must not revoke active sessions");

	const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: baseUrl,
		},
		body: JSON.stringify({ password: TEST_PASSWORD }),
	});
	assert.equal(loginRes.status, 200);
	const setCookie = loginRes.headers.get("set-cookie") || "";
	assert.match(setCookie, /token=/);
	assert.equal(/;\s*Domain=/i.test(setCookie), false, "session cookie must stay host-only");
	const token = /token=([^;]+)/.exec(setCookie)?.[1];
	assert.ok(token);

	const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
		method: "POST",
		headers: {
			Origin: baseUrl,
			Cookie: `token=${token}`,
		},
	});
	assert.equal(logoutRes.status, 200);
	const logoutBody = await logoutRes.json();
	assert.equal(logoutBody.success, true);
	assert.equal(logoutBody.sessionEpoch, before + 1);

	const meRes = await fetch(`${baseUrl}/api/auth/me`, {
		headers: { Cookie: `token=${token}` },
	});
	assert.equal(meRes.status, 401, "logout must invalidate the previous JWT");
	console.log("  ✔ Logout bumps the session epoch and clears the old token");
} finally {
	await new Promise((resolve) => server.close(resolve));
	try {
		fs.rmSync(testTmpDir, { recursive: true, force: true });
	} catch (_) {}
}

console.log("✔ Origin, logout, and startup secret checks passed");
