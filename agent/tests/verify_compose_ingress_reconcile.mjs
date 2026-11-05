import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

// Isolate test environment before importing agent modules
const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "home-cloud-compose-reconcile-test-"));
process.env.HOME = testTmpDir;
process.env.XDG_CONFIG_HOME = path.join(testTmpDir, ".config");
process.env.HOME_CLOUD_CONFIG_DIR = path.join(testTmpDir, ".config", "home-cloud");
process.env.AGENT_ENV_FILE = path.join(testTmpDir, ".env");
process.env.CF_CONFIG = path.join(testTmpDir, ".cloudflared", "config.yml");
process.env.BASE_DIR = testTmpDir;
process.env.CF_DOMAIN = "example.test";
process.env.JWT_SECRET = "compose-reconcile-jwt-secret-32-chars-test";
process.env.PASSWORD = "test-password-12345";
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
const cp = require("node:child_process");
const origSpawn = cp.spawn;

// Mock tunnel reload
let reloadCount = 0;
const tunnel = require("../tunnel.js");
tunnel.restartTunnel = async () => {
	reloadCount++;
	return "https://test.example";
};

// Mock child_process.spawn for compose up & logs
let onComposeUp = null;
let activeLogsProcess = null;
let activeDeployProcess = null;
let composeUpExitCode = 0;
let composeUpCloseSignal = null;
let composeUpAutoClose = true;

class MockChildProcess extends EventEmitter {
	constructor() {
		super();
		this.stdout = new PassThrough();
		this.stderr = new PassThrough();
		this.killed = false;
	}
	kill(signal) {
		this.killed = true;
		this.emit("close", 0, signal);
	}
}

cp.spawn = function (cmd, args, opts) {
	if (cmd === "docker" && Array.isArray(args)) {
		if (args.includes("up")) {
			const child = new MockChildProcess();
			activeDeployProcess = child;
			process.nextTick(() => {
				if (typeof onComposeUp === "function") {
					onComposeUp(child);
				}
				child.stdout.write("Container reconcile-web-1 Started\n");
				if (composeUpAutoClose) {
					child.emit("close", composeUpExitCode, composeUpCloseSignal);
				}
			});
			return child;
		}
		if (args.includes("logs")) {
			const child = new MockChildProcess();
			activeLogsProcess = child;
			child.kill = function (sig) {
				child.killed = true;
				if (!child.stdout.destroyed) {
					child.stdout.end();
				}
				child.emit("close", 0, sig);
			};
			process.nextTick(() => {
				child.stdout.write("Logs line 1 from test container\n");
			});
			return child;
		}
	}
	return origSpawn.call(this, cmd, args, opts);
};

// Stub Dockerode methods
const Docker = require("dockerode");
let customListContainers = null;
let containerInspectMap = {};

Docker.prototype.listContainers = async function (...args) {
	if (customListContainers) {
		return customListContainers(...args);
	}
	return [];
};

Docker.prototype.getContainer = function (id) {
	return {
		inspect: async () => {
			if (containerInspectMap[id]) return containerInspectMap[id];
			return {
				Id: id,
				State: { Running: true, Status: "running" },
				NetworkSettings: { Ports: {} },
				HostConfig: { PortBindings: {} },
			};
		},
	};
};

// Load routes & services after stubs are configured
const composeRouter = require("../routes/compose.js");
const ingressService = require("../services/ingress.js");
const preferences = require("../services/preferences.js");

// Setup Express application
const app = express();
app.use(express.json());
// Inject session user context with active session epoch
app.use((req, res, next) => {
	req.user = { epoch: preferences.getSessionEpoch() };
	next();
});
app.use("/api/docker/compose", composeRouter);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/api/docker/compose`;

async function readSseUntilDone(response) {
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let output = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		output += decoder.decode(value);
	}
	return output;
}

console.log("🧪 Running Ingress Reconcile & Session Revocation Tests for Compose...\n");

try {
	// =========================================================================
	// [Suite 1] Dropping published ports on redeploy cleans up vacated ingress rules
	// =========================================================================
	console.log("[Suite 1] Compose redeploy: dropped ports have ingress rules removed");

	const projectName = "reconcile-proj";

	// Initial ingress rules: protected system rules, 2 ports for this project, 1 port for another app
	const initialConfig = {
		tunnel: "test-tunnel-id",
		"credentials-file": "/tmp/test-tunnel.json",
		ingress: [
			{ hostname: "dash.example.test", service: "http://localhost:3000" },
			{ hostname: "ssh.example.test", service: "ssh://localhost:22" },
			{ hostname: "web1.example.test", service: "http://localhost:18081" },
			{ hostname: "web2.example.test", service: "http://localhost:18082" },
			{ hostname: "other.example.test", service: "http://localhost:19090" },
			{ service: "http_status:404" },
		],
	};
	fs.writeFileSync(configPath, yaml.dump(initialConfig, { lineWidth: -1 }), { mode: 0o600 });

	// Before up: containers publish 18081 and 18082
	customListContainers = async () => [
		{
			Id: "reconcile-web-1",
			Names: ["/reconcile_web_1"],
			Labels: {
				"com.docker.compose.project": projectName,
				"com.docker.compose.service": "web",
			},
			Ports: [{ PrivatePort: 80, PublicPort: 18081, Type: "tcp" }],
			State: "running",
		},
		{
			Id: "reconcile-api-1",
			Names: ["/reconcile_api_1"],
			Labels: {
				"com.docker.compose.project": projectName,
				"com.docker.compose.service": "api",
			},
			Ports: [{ PrivatePort: 3000, PublicPort: 18082, Type: "tcp" }],
			State: "running",
		},
	];

	containerInspectMap["reconcile-web-1"] = {
		Id: "reconcile-web-1",
		NetworkSettings: { Ports: { "80/tcp": [{ HostPort: "18081" }] } },
		HostConfig: { PortBindings: { "80/tcp": [{ HostPort: "18081" }] } },
	};
	containerInspectMap["reconcile-api-1"] = {
		Id: "reconcile-api-1",
		NetworkSettings: { Ports: { "3000/tcp": [{ HostPort: "18082" }] } },
		HostConfig: { PortBindings: { "3000/tcp": [{ HostPort: "18082" }] } },
	};

	// On up: compose updates containers so only port 18081 is published (port 18082 dropped)
	onComposeUp = () => {
		customListContainers = async () => [
			{
				Id: "reconcile-web-1",
				Names: ["/reconcile_web_1"],
				Labels: {
					"com.docker.compose.project": projectName,
					"com.docker.compose.service": "web",
				},
				Ports: [{ PrivatePort: 80, PublicPort: 18081, Type: "tcp" }],
				State: "running",
			},
		];
		delete containerInspectMap["reconcile-api-1"];
	};

	reloadCount = 0;
	const deployRes1 = await fetch(`${baseUrl}/${projectName}/deploy`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: projectName,
			yaml: "services:\n  web:\n    image: nginx\n    ports:\n      - '18081:80'\n",
		}),
	});

	assert.equal(deployRes1.status, 200, "POST /deploy should return 200 SSE stream");
	const output1 = await readSseUntilDone(deployRes1);
	assert.ok(output1.includes('"status":"success"'), `Deploy must succeed, got output: ${output1}`);

	const configAfterDeploy1 = yaml.load(fs.readFileSync(configPath, "utf8"));
	const services1 = configAfterDeploy1.ingress.map((r) => r.service);
	const hostnames1 = configAfterDeploy1.ingress.map((r) => r.hostname);

	assert.ok(!services1.includes("http://localhost:18082"), "Vacated port 18082 rule must be removed");
	assert.ok(services1.includes("http://localhost:18081"), "Retained port 18081 rule must stay");
	assert.ok(services1.includes("http://localhost:19090"), "Other stack's port 19090 rule must stay");
	assert.ok(hostnames1.includes("dash.example.test"), "Protected system rule 'dash' must stay");
	assert.ok(hostnames1.includes("ssh.example.test"), "Protected system rule 'ssh' must stay");
	assert.equal(reloadCount, 1, "reloadCloudflared must be called once when rule is removed");
	console.log("  ✔ Dropped port 18082 rule was removed, retained rules remained, cloudflared reloaded");

	// =========================================================================
	// [Suite 2] Redeploy with unchanged ports removes nothing
	// =========================================================================
	console.log("\n[Suite 2] Compose redeploy: identical ports remove nothing");

	reloadCount = 0;
	onComposeUp = () => {
		// Port 18081 still published
	};

	const deployRes2 = await fetch(`${baseUrl}/${projectName}/deploy`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: projectName,
			yaml: "services:\n  web:\n    image: nginx\n    ports:\n      - '18081:80'\n",
		}),
	});

	assert.equal(deployRes2.status, 200);
	const output2 = await readSseUntilDone(deployRes2);
	assert.ok(output2.includes('"status":"success"'));

	const configAfterDeploy2 = yaml.load(fs.readFileSync(configPath, "utf8"));
	const services2 = configAfterDeploy2.ingress.map((r) => r.service);
	assert.ok(services2.includes("http://localhost:18081"), "Retained port 18081 rule must remain intact");
	assert.equal(reloadCount, 0, "reloadCloudflared must NOT be called when no rules were removed");
	console.log("  ✔ Redeploy with identical ports kept all ingress rules and did not reload cloudflared");

	// =========================================================================
	// [Suite 3] Ingress cleanup failure does NOT fail deployment
	// =========================================================================
	console.log("\n[Suite 3] Ingress cleanup failure resilience");

	// Add another rule to remove
	initialConfig.ingress.splice(3, 0, { hostname: "temp.example.test", service: "http://localhost:18083" });
	fs.writeFileSync(configPath, yaml.dump(initialConfig, { lineWidth: -1 }), { mode: 0o600 });

	customListContainers = async () => [
		{
			Id: "reconcile-web-1",
			Names: ["/reconcile_web_1"],
			Labels: { "com.docker.compose.project": projectName },
			Ports: [
				{ PrivatePort: 80, PublicPort: 18081, Type: "tcp" },
				{ PrivatePort: 8080, PublicPort: 18083, Type: "tcp" },
			],
			State: "running",
		},
	];
	containerInspectMap["reconcile-web-1"] = {
		Id: "reconcile-web-1",
		NetworkSettings: {
			Ports: {
				"80/tcp": [{ HostPort: "18081" }],
				"8080/tcp": [{ HostPort: "18083" }],
			},
		},
		HostConfig: {
			PortBindings: {
				"80/tcp": [{ HostPort: "18081" }],
				"8080/tcp": [{ HostPort: "18083" }],
			},
		},
	};

	onComposeUp = () => {
		customListContainers = async () => [
			{
				Id: "reconcile-web-1",
				Names: ["/reconcile_web_1"],
				Labels: { "com.docker.compose.project": projectName },
				Ports: [{ PrivatePort: 80, PublicPort: 18081, Type: "tcp" }],
				State: "running",
			},
		];
	};

	const origRestart = tunnel.restartTunnel;
	tunnel.restartTunnel = async () => {
		throw new Error("Simulated reload error");
	};

	const deployRes3 = await fetch(`${baseUrl}/${projectName}/deploy`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: projectName,
			yaml: "services:\n  web:\n    image: nginx\n    ports:\n      - '18081:80'\n",
		}),
	});

	assert.equal(deployRes3.status, 200);
	const output3 = await readSseUntilDone(deployRes3);
	assert.ok(output3.includes('"status":"success"'), "Deploy must succeed even if ingress reload fails");
	tunnel.restartTunnel = origRestart;
	console.log("  ✔ Ingress reload failure was caught and deploy finished with success");

	// =========================================================================
	// [Suite 4] Compose logs stream ends after session revocation
	// =========================================================================
	console.log("\n[Suite 4] Compose logs stream session revocation");

	activeLogsProcess = null;
	const logsRes = await fetch(`${baseUrl}/${projectName}/logs`);
	assert.equal(logsRes.status, 200, "GET /:name/logs must return 200");
	assert.equal(logsRes.headers.get("content-type"), "text/event-stream");

	const reader = logsRes.body.getReader();
	const decoder = new TextDecoder();

	// Read initial chunk to ensure stream is established
	const { done: initialDone, value: initialChunk } = await reader.read();
	assert.equal(initialDone, false, "Initial read must receive data");
	const chunkText = decoder.decode(initialChunk);
	assert.ok(chunkText.includes("Logs line 1"), "Must receive streamed log chunk");
	assert.ok(activeLogsProcess, "Spawned logs process must be active");
	assert.equal(activeLogsProcess.killed, false, "Spawned logs process must not be killed initially");

	// Trigger session revocation by bumping epoch
	preferences.incrementSessionEpoch();

	// The reader should now close because bindStreamToSession ends the response
	let streamClosed = false;
	const readTimeout = setTimeout(() => {
		assert.fail("Logs stream did not end within timeout after incrementSessionEpoch");
	}, 3000);

	while (true) {
		const { done } = await reader.read();
		if (done) {
			streamClosed = true;
			break;
		}
	}
	clearTimeout(readTimeout);

	assert.ok(streamClosed, "Logs stream must end after session revocation");
	assert.equal(activeLogsProcess.killed, true, "Spawned child process must be killed on revocation");
	console.log("  ✔ Logs stream closed and spawned process killed immediately upon session epoch bump");

	// =========================================================================
	// [Suite 5] Failed deploy (exit code 1) reconciles vacated ingress rules and reports failure
	// =========================================================================
	console.log("\n[Suite 5] Failed deploy (exit code 1) reconciles vacated ingress rules and reports failure");

	const failProjectName = "reconcile-fail-proj";

	// Initial ingress rules: protected system rules + port 18084 for this project + port 19090 for another stack
	const failConfig = {
		tunnel: "test-tunnel-id",
		"credentials-file": "/tmp/test-tunnel.json",
		ingress: [
			{ hostname: "dash.example.test", service: "http://localhost:3000" },
			{ hostname: "ssh.example.test", service: "ssh://localhost:22" },
			{ hostname: "fail-web.example.test", service: "http://localhost:18084" },
			{ hostname: "other.example.test", service: "http://localhost:19090" },
			{ service: "http_status:404" },
		],
	};
	fs.writeFileSync(configPath, yaml.dump(failConfig, { lineWidth: -1 }), { mode: 0o600 });

	// Before up: containers publish 18084
	customListContainers = async () => [
		{
			Id: "reconcile-fail-1",
			Names: ["/reconcile_fail_1"],
			Labels: {
				"com.docker.compose.project": failProjectName,
				"com.docker.compose.service": "web",
			},
			Ports: [{ PrivatePort: 80, PublicPort: 18084, Type: "tcp" }],
			State: "running",
		},
	];
	containerInspectMap["reconcile-fail-1"] = {
		Id: "reconcile-fail-1",
		NetworkSettings: { Ports: { "80/tcp": [{ HostPort: "18084" }] } },
		HostConfig: { PortBindings: { "80/tcp": [{ HostPort: "18084" }] } },
	};

	// On up: port 18084 is vacated, but deploy child exits with code 1
	composeUpExitCode = 1;
	composeUpCloseSignal = null;
	composeUpAutoClose = true;
	onComposeUp = () => {
		customListContainers = async () => [];
		delete containerInspectMap["reconcile-fail-1"];
	};

	reloadCount = 0;
	const failDeployRes = await fetch(`${baseUrl}/${failProjectName}/deploy`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: failProjectName,
			yaml: "services:\n  web:\n    image: nginx\n",
		}),
	});

	assert.equal(failDeployRes.status, 200, "POST /deploy should return 200 SSE stream even if deploy fails");
	const failOutput = await readSseUntilDone(failDeployRes);
	assert.ok(failOutput.includes('"status":"failed"'), `Deploy SSE payload must report failed, got: ${failOutput}`);
	assert.ok(failOutput.includes('"exitCode":1'), `Deploy SSE payload must report exitCode 1, got: ${failOutput}`);
	assert.ok(!failOutput.includes('"status":"success"'), "Deploy SSE payload must not report success on code 1");

	const configAfterFailDeploy = yaml.load(fs.readFileSync(configPath, "utf8"));
	const failServices = configAfterFailDeploy.ingress.map((r) => r.service);
	const failHostnames = configAfterFailDeploy.ingress.map((r) => r.hostname);

	assert.ok(!failServices.includes("http://localhost:18084"), "Vacated port 18084 rule must be removed even on deploy failure");
	assert.ok(failServices.includes("http://localhost:19090"), "Other stack's port 19090 rule must stay");
	assert.ok(failHostnames.includes("dash.example.test"), "Protected system rule 'dash' must stay");
	assert.ok(failHostnames.includes("ssh.example.test"), "Protected system rule 'ssh' must stay");
	assert.equal(reloadCount, 1, "reloadCloudflared must be called once when rule is removed on deploy failure");
	composeUpExitCode = 0;
	console.log("  ✔ Deploy child exiting with code 1 still removed vacated port rule, reloaded cloudflared once, and reported failure");

	// =========================================================================
	// [Suite 6] Deploy SSE stream ends promptly on session revocation without killing child, reconcile runs on completion
	// =========================================================================
	console.log("\n[Suite 6] Compose deploy stream ends on session revocation without killing child, reconcile runs on completion");

	const revokeProjectName = "reconcile-revoke-proj";

	// Initial ingress rules: system rules + port 18085 for this project + port 19090 for another stack
	const revokeConfig = {
		tunnel: "test-tunnel-id",
		"credentials-file": "/tmp/test-tunnel.json",
		ingress: [
			{ hostname: "dash.example.test", service: "http://localhost:3000" },
			{ hostname: "ssh.example.test", service: "ssh://localhost:22" },
			{ hostname: "revoke-web.example.test", service: "http://localhost:18085" },
			{ hostname: "other.example.test", service: "http://localhost:19090" },
			{ service: "http_status:404" },
		],
	};
	fs.writeFileSync(configPath, yaml.dump(revokeConfig, { lineWidth: -1 }), { mode: 0o600 });

	// Before up: containers publish 18085
	customListContainers = async () => [
		{
			Id: "reconcile-revoke-1",
			Names: ["/reconcile_revoke_1"],
			Labels: {
				"com.docker.compose.project": revokeProjectName,
				"com.docker.compose.service": "web",
			},
			Ports: [{ PrivatePort: 80, PublicPort: 18085, Type: "tcp" }],
			State: "running",
		},
	];
	containerInspectMap["reconcile-revoke-1"] = {
		Id: "reconcile-revoke-1",
		NetworkSettings: { Ports: { "80/tcp": [{ HostPort: "18085" }] } },
		HostConfig: { PortBindings: { "80/tcp": [{ HostPort: "18085" }] } },
	};

	// Prevent auto close so child stays alive while we test session revocation
	composeUpAutoClose = false;
	composeUpExitCode = 0;
	composeUpCloseSignal = null;
	activeDeployProcess = null;

	onComposeUp = () => {
		// Port 18085 vacated during up
		customListContainers = async () => [];
		delete containerInspectMap["reconcile-revoke-1"];
	};

	reloadCount = 0;
	const revokeDeployRes = await fetch(`${baseUrl}/${revokeProjectName}/deploy`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: revokeProjectName,
			yaml: "services:\n  web:\n    image: nginx\n",
		}),
	});

	assert.equal(revokeDeployRes.status, 200, "POST /deploy must return 200 SSE stream");
	const revokeReader = revokeDeployRes.body.getReader();
	const revokeDecoder = new TextDecoder();

	// Read initial chunk to ensure stream is established
	const { done: initialRevokeDone, value: initialRevokeChunk } = await revokeReader.read();
	assert.equal(initialRevokeDone, false, "Initial deploy SSE chunk must be received");
	assert.ok(activeDeployProcess, "Deploy child process must be active");
	assert.equal(activeDeployProcess.killed, false, "Deploy child process must not be killed initially");

	// Trigger session revocation by bumping epoch
	preferences.incrementSessionEpoch();

	// Deploy stream should close promptly
	let deployStreamEnded = false;
	const revokeTimeout = setTimeout(() => {
		assert.fail("Deploy stream did not end within timeout after incrementSessionEpoch");
	}, 3000);

	while (true) {
		const { done } = await revokeReader.read();
		if (done) {
			deployStreamEnded = true;
			break;
		}
	}
	clearTimeout(revokeTimeout);

	assert.ok(deployStreamEnded, "Deploy SSE stream must end promptly after session revocation");
	assert.equal(activeDeployProcess.killed, false, "Mock deploy child must NOT be killed on revocation");

	// Child writes data after stream ended to verify res.write does not throw ERR_STREAM_WRITE_AFTER_END
	activeDeployProcess.stdout.write("Stdout chunk after client revoked\n");
	activeDeployProcess.stderr.write("Stderr chunk after client revoked\n");

	// Child later finishes and closes with code 0
	activeDeployProcess.emit("close", 0);

	// Allow microtasks and reconcile async operations to settle
	await new Promise((r) => setTimeout(r, 50));

	const configAfterRevokeDeploy = yaml.load(fs.readFileSync(configPath, "utf8"));
	const revokeServices = configAfterRevokeDeploy.ingress.map((r) => r.service);
	assert.ok(!revokeServices.includes("http://localhost:18085"), "Vacated port 18085 rule must be removed after child closes");
	assert.equal(reloadCount, 1, "reloadCloudflared must be called once");

	composeUpAutoClose = true;
	console.log("  ✔ Deploy stream ended on session revocation, child was NOT killed, and later close reconciled vacated port rule without throwing");

	server.close();
	console.log("\n🎉 All Compose Ingress Reconcile & Session Revocation Tests Passed Successfully!");
} catch (err) {
	server.close();
	console.error("\n❌ Test Failed:", err);
	process.exit(1);
}
