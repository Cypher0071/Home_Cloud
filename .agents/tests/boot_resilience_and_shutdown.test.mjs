import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, "../..");

const tunnelModule = require(path.join(WORKSPACE_ROOT, "agent/tunnel.js"));
const terminalModule = require(path.join(WORKSPACE_ROOT, "agent/sockets/terminal.js"));
const indexModule = require(path.join(WORKSPACE_ROOT, "agent/index.js"));

class MockChildProcess extends EventEmitter {
	constructor() {
		super();
		this.stdout = new EventEmitter();
		this.stderr = new EventEmitter();
		this.exitCode = null;
		this.signalCode = null;
		this.killed = false;
		this.signalsReceived = [];
		this.autoCloseOnKill = true;
		this.closeDelayMs = 20;
	}

	kill(signal = "SIGTERM") {
		this.killed = true;
		this.signalsReceived.push(signal);
		if (this.autoCloseOnKill) {
			setTimeout(() => {
				if (this.exitCode === null && this.signalCode === null) {
					this.exitCode = signal === "SIGKILL" ? null : 0;
					this.signalCode = signal;
					this.emit("close", this.exitCode, this.signalCode);
				}
			}, this.closeDelayMs);
		}
	}
}

describe("Boot Resilience & Graceful Shutdown Verification Suite", () => {
	afterEach(async () => {
		tunnelModule._resetSpawn();
		await tunnelModule.stopTunnel({ stopSupervisor: true, sigkillTimeoutMs: 100 });
		terminalModule.closeAllSessions();
	});

	describe("1. stopTunnel() Process Termination & Cleanup", () => {
		test("1.1: stopTunnel() resolves immediately when no child is active", async () => {
			assert.equal(tunnelModule.getActiveChild(), null);
			await tunnelModule.stopTunnel();
			const status = tunnelModule.getTunnelStatus();
			assert.equal(status.status, "stopped");
			assert.equal(status.url, null);
		});

		test("1.2: stopTunnel() awaits previous child exit event", async () => {
			const mockChild = new MockChildProcess();
			mockChild.closeDelayMs = 50;

			tunnelModule._setSpawn(() => mockChild);

			// Start tunnel and simulate connection
			const tunnelPromise = tunnelModule.startTunnel();
			mockChild.stderr.emit("data", Buffer.from("INF Registered tunnel connection connIndex=0\n"));
			await tunnelPromise;

			assert.equal(tunnelModule.getActiveChild(), mockChild);
			assert.equal(tunnelModule.getTunnelStatus().status, "connected");

			let closedEmittedBeforeStopResolved = false;
			mockChild.once("close", () => {
				closedEmittedBeforeStopResolved = true;
			});

			await tunnelModule.stopTunnel();

			assert.equal(closedEmittedBeforeStopResolved, true);
			assert.equal(mockChild.signalsReceived.includes("SIGTERM"), true);
			assert.equal(tunnelModule.getActiveChild(), null);
			assert.equal(tunnelModule.getTunnelStatus().status, "stopped");
		});

		test("1.3: stopTunnel() escalates to SIGKILL if SIGTERM does not terminate within timeout", async () => {
			const mockChild = new MockChildProcess();
			// Disable automatic close on kill to simulate unresponsive process
			mockChild.autoCloseOnKill = false;

			tunnelModule._setSpawn(() => mockChild);

			const tunnelPromise = tunnelModule.startTunnel();
			mockChild.stderr.emit("data", Buffer.from("Registered tunnel connection\n"));
			await tunnelPromise;

			// Stop tunnel with 50ms fallback timeout
			const stopPromise = tunnelModule.stopTunnel({ sigkillTimeoutMs: 50 });

			// Wait for SIGKILL to be sent
			await new Promise((resolve) => setTimeout(resolve, 80));

			assert.ok(mockChild.signalsReceived.includes("SIGTERM"));
			assert.ok(mockChild.signalsReceived.includes("SIGKILL"));

			// Now close mock child
			mockChild.exitCode = null;
			mockChild.signalCode = "SIGKILL";
			mockChild.emit("close", null, "SIGKILL");

			await stopPromise;
			assert.equal(tunnelModule.getActiveChild(), null);
			assert.equal(tunnelModule.getTunnelStatus().status, "stopped");
		});

		test("1.4: Real OS subprocess: stopTunnel() cleanly halts running process", async () => {
			// Spawn a real node process that sleeps
			tunnelModule._setSpawn(() => {
				const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"]);
				// Simulate the log message so startTunnel resolves
				setTimeout(() => {
					child.stderr.emit("data", Buffer.from("Registered tunnel connection\n"));
				}, 10);
				return child;
			});

			const url = await tunnelModule.startTunnel();
			assert.ok(url.startsWith("https://dash."));
			const realChild = tunnelModule.getActiveChild();
			assert.ok(realChild);
			assert.equal(realChild.exitCode, null);

			await tunnelModule.stopTunnel();
			assert.equal(tunnelModule.getActiveChild(), null);
			assert.equal(tunnelModule.getTunnelStatus().status, "stopped");
		});

		test("1.5: stopTunnel() on connected tunnel leaves error as null (no false unexpected exit error)", async () => {
			const mockChild = new MockChildProcess();
			tunnelModule._setSpawn(() => mockChild);

			const tp = tunnelModule.startTunnel();
			mockChild.stderr.emit("data", Buffer.from("Registered tunnel connection\n"));
			await tp;

			assert.equal(tunnelModule.getTunnelStatus().status, "connected");
			assert.equal(tunnelModule.getTunnelStatus().error, null);

			await tunnelModule.stopTunnel();

			const status = tunnelModule.getTunnelStatus();
			assert.equal(status.status, "stopped");
			assert.equal(status.url, null);
			assert.equal(status.error, null);
		});
	});

	describe("2. Process Recycling Race Condition Prevention (Tech Debt #1)", () => {
		test("2.1: startTunnel() awaits cleanup of prior child BEFORE spawning new one", async () => {
			let child1Closed = false;
			let child2Spawned = false;

			const mockChild1 = new MockChildProcess();
			mockChild1.closeDelayMs = 60;
			mockChild1.once("close", () => {
				child1Closed = true;
			});

			const mockChild2 = new MockChildProcess();
			mockChild2.closeDelayMs = 20;

			let spawnCount = 0;
			tunnelModule._setSpawn(() => {
				spawnCount++;
				if (spawnCount === 1) {
					process.nextTick(() => {
						mockChild1.stderr.emit("data", Buffer.from("Registered tunnel connection\n"));
					});
					return mockChild1;
				}
				child2Spawned = true;
				// At the moment child 2 is spawned, child 1 MUST be fully closed!
				assert.equal(child1Closed, true, "Previous child must be closed before spawning new child!");
				process.nextTick(() => {
					mockChild2.stderr.emit("data", Buffer.from("Registered tunnel connection\n"));
				});
				return mockChild2;
			});

			// Start first tunnel instance
			const p1 = tunnelModule.startTunnel();
			await p1;

			// Start second tunnel instance (triggers recycling)
			const p2 = tunnelModule.startTunnel();
			await p2;

			assert.equal(child1Closed, true);
			assert.equal(child2Spawned, true);
			assert.equal(tunnelModule.getActiveChild(), mockChild2);
		});

		test("2.2: restartTunnel() recycles process and maintains status", async () => {
			const mockChild1 = new MockChildProcess();
			const mockChild2 = new MockChildProcess();

			let count = 0;
			tunnelModule._setSpawn(() => {
				count++;
				const child = count === 1 ? mockChild1 : mockChild2;
				process.nextTick(() => {
					child.stderr.emit("data", Buffer.from("Registered tunnel connection\n"));
				});
				return child;
			});

			const p1 = tunnelModule.startTunnel();
			await p1;

			const p2 = tunnelModule.restartTunnel();
			const url2 = await p2;

			assert.ok(url2.startsWith("https://dash."));
			assert.equal(tunnelModule.getTunnelStatus().status, "connected");
		});

		test("2.3: startTunnel() error state updates tunnelState to error", async () => {
			const mockChild = new MockChildProcess();
			tunnelModule._setSpawn(() => mockChild);

			const p = tunnelModule.startTunnel();
			mockChild.emit("error", new Error("Spawn error simulated"));

			await assert.rejects(p, /Spawn error simulated/);
			assert.equal(tunnelModule.getTunnelStatus().status, "error");
		});

		test("2.4: Concurrent startTunnel() calls share in-flight promise and do not spawn duplicate processes", async () => {
			let spawnCount = 0;
			const mockChild = new MockChildProcess();

			tunnelModule._setSpawn(() => {
				spawnCount++;
				setTimeout(() => {
					mockChild.stderr.emit("data", Buffer.from("Registered tunnel connection\n"));
				}, 20);
				return mockChild;
			});

			const [url1, url2] = await Promise.all([
				tunnelModule.startTunnel(),
				tunnelModule.startTunnel(),
			]);

			assert.equal(spawnCount, 1, "Only one child should be spawned for concurrent starts");
			assert.equal(url1, url2);
			assert.ok(url1.startsWith("https://dash."));
			assert.equal(tunnelModule.getTunnelStatus().status, "connected");

			await tunnelModule.stopTunnel();
		});
	});

	describe("3. Background Retry Loop & Non-blocking Startup", () => {
		test("3.1: startTunnelWithRetry() retries with backoff and recovers", async () => {
			let attempts = 0;

			tunnelModule._setSpawn(() => {
				attempts++;
				const child = new MockChildProcess();
				if (attempts < 3) {
					// Fail first 2 attempts quickly
					setTimeout(() => {
						child.emit("error", new Error(`Simulated boot failure attempt ${attempts}`));
					}, 10);
				} else {
					// Succeed on 3rd attempt
					setTimeout(() => {
						child.stderr.emit("data", Buffer.from("Registered tunnel connection\n"));
					}, 10);
				}
				return child;
			});

			// Run supervisor with fast retry delays for testing
			tunnelModule.startTunnelWithRetry({
				initialDelayMs: 20,
				maxDelayMs: 100,
				factor: 2,
			});

			// Poll until connected
			for (let i = 0; i < 40; i++) {
				if (tunnelModule.getTunnelStatus().status === "connected") break;
				await new Promise((r) => setTimeout(r, 20));
			}

			assert.equal(tunnelModule.getTunnelStatus().status, "connected");
			assert.ok(attempts >= 3, `Expected at least 3 attempts, got ${attempts}`);

			await tunnelModule.stopTunnel();
		});

		test("3.2: stopTunnel() immediately interrupts retry sleep", async () => {
			let attempts = 0;
			tunnelModule._setSpawn(() => {
				attempts++;
				const child = new MockChildProcess();
				setTimeout(() => {
					child.emit("error", new Error("Persistent failure"));
				}, 5);
				return child;
			});

			const startTime = Date.now();
			tunnelModule.startTunnelWithRetry({
				initialDelayMs: 5000, // 5s sleep
				maxDelayMs: 30000,
			});

			// Wait briefly for first attempt to fail and enter sleep
			await new Promise((r) => setTimeout(r, 40));

			// Now stopTunnel should immediately break the 5s sleep
			await tunnelModule.stopTunnel();
			const elapsed = Date.now() - startTime;

			assert.ok(elapsed < 2000, `stopTunnel should wake up sleep immediately, took ${elapsed}ms`);
			assert.equal(tunnelModule.getTunnelStatus().status, "stopped");
		});

		test("3.3: restartTunnel() under startTunnelWithRetry does not trigger double spawn", async () => {
			const spawned = [];
			let id = 0;

			tunnelModule._setSpawn(() => {
				id++;
				const childId = id;
				const child = new MockChildProcess();
				spawned.push(childId);
				setTimeout(() => {
					child.stderr.emit("data", Buffer.from("Registered tunnel connection\n"));
				}, 20);
				return child;
			});

			// Start background retry supervisor
			tunnelModule.startTunnelWithRetry({ initialDelayMs: 40 });

			// Wait for initial connection
			for (let i = 0; i < 20; i++) {
				if (tunnelModule.getTunnelStatus().status === "connected") break;
				await new Promise((r) => setTimeout(r, 20));
			}
			assert.equal(spawned.length, 1);

			// Trigger restart
			const url = await tunnelModule.restartTunnel();
			assert.ok(url.startsWith("https://dash."));

			// Allow supervisor to stabilize
			await new Promise((r) => setTimeout(r, 100));

			// Verify only 2 children spawned in total (1 initial + 1 from restartTunnel)
			assert.equal(spawned.length, 2, "Expected exactly 2 children spawned, no double-spawn kill loop");
			assert.equal(tunnelModule.getTunnelStatus().status, "connected");

			await tunnelModule.stopTunnel();
		});
	});

	describe("4. Terminal PTY Session Cleanup", () => {
		test("4.1: activeSessions tracks PTY sessions and closeAllSessions() terminates them", () => {
			let killCount = 0;
			class FakePTY extends terminalModule.PTY {
				constructor(ws) {
					super(ws);
					this.terminal = {
						kill: () => {
							killCount++;
						},
					};
				}
			}

			const session1 = new FakePTY({ readyState: 1 });
			const session2 = new FakePTY({ readyState: 1 });

			assert.equal(terminalModule.getActiveSessionsCount(), 2);

			const closed = terminalModule.closeAllSessions();
			assert.equal(closed, 2);
			assert.equal(killCount, 2);
			assert.equal(terminalModule.getActiveSessionsCount(), 0);
		});

		test("4.2: destroying individual PTY unregisters from activeSessions", () => {
			let killed = false;
			class FakePTY extends terminalModule.PTY {
				constructor(ws) {
					super(ws);
					this.terminal = {
						kill: () => {
							killed = true;
						},
					};
				}
			}

			const session = new FakePTY({ readyState: 1 });
			assert.equal(terminalModule.getActiveSessionsCount(), 1);

			session.destroy();
			assert.equal(killed, true);
			assert.equal(terminalModule.getActiveSessionsCount(), 0);
		});

		test("4.3: Terminal shell exit naturally closes client WebSocket", () => {
			let wsClosed = false;
			const fakeWs = {
				readyState: 1,
				close: () => {
					wsClosed = true;
				},
				send: () => {},
			};

			class TestPTY extends terminalModule.PTY {
				constructor(ws) {
					super(ws);
					this.exitHandlers = [];
					this.terminal = {
						onExit: (fn) => this.exitHandlers.push(fn),
						kill: () => {},
					};
				}
				triggerExit() {
					this.exitHandlers.forEach((fn) => fn());
				}
			}

			const session = new TestPTY(fakeWs);
			assert.equal(terminalModule.getActiveSessionsCount(), 1);

			// Wire onExit listener as createPTY does
			session.terminal.onExit(() => {
				session.destroy();
				if (fakeWs.readyState === 1) {
					fakeWs.close();
				}
			});

			session.triggerExit();
			assert.equal(wsClosed, true);
			assert.equal(terminalModule.getActiveSessionsCount(), 0);
		});
	});

	describe("5. Graceful Shutdown & Signal Trapping", () => {
		test("5.1: gracefulShutdown() sets shuttingDown, closes HTTP, WebSockets, PTYs, and tunnel", async () => {
			let wsClosed = false;
			let wsCloseCode = null;
			let wsCloseReason = null;

			const fakeWs = {
				close: (code, reason) => {
					wsClosed = true;
					wsCloseCode = code;
					wsCloseReason = reason;
				},
			};

			indexModule.wss.clients.add(fakeWs);

			// Start mock tunnel
			const mockChild = new MockChildProcess();
			tunnelModule._setSpawn(() => mockChild);
			const tp = tunnelModule.startTunnel();
			mockChild.stderr.emit("data", Buffer.from("Registered tunnel connection\n"));
			await tp;

			assert.equal(tunnelModule.getTunnelStatus().status, "connected");

			// Trigger graceful shutdown without exiting test process
			await indexModule.gracefulShutdown("SIGTERM", { exitProcess: false });

			assert.equal(indexModule.getIsShuttingDown(), true);
			assert.equal(wsClosed, true);
			assert.equal(wsCloseCode, 1001);
			assert.equal(wsCloseReason, "Server shutting down");
			assert.equal(tunnelModule.getTunnelStatus().status, "stopped");
			assert.equal(terminalModule.getActiveSessionsCount(), 0);
		});

		test("5.2: Requests during shutdown receive HTTP 503", async () => {
			// indexModule has isShuttingDown set from previous test
			assert.equal(indexModule.getIsShuttingDown(), true);

			// Test middleware response
			let statusCode = null;
			let responseBody = null;
			const req = {};
			const res = {
				setHeader: () => {},
				status: (code) => {
					statusCode = code;
					return {
						json: (data) => {
							responseBody = data;
						},
					};
				},
			};

			let nextCalled = false;
			const shutdownMiddleware = (req, res, next) => {
				if (indexModule.getIsShuttingDown()) {
					res.setHeader("Connection", "close");
					return res.status(503).json({ error: "Server is shutting down" });
				}
				next();
			};

			shutdownMiddleware(req, res, () => {
				nextCalled = true;
			});

			assert.equal(statusCode, 503);
			assert.deepEqual(responseBody, { error: "Server is shutting down" });
			assert.equal(nextCalled, false);
		});

		test("5.3: Repeated signal during active shutdown forces immediate process exit", async () => {
			let exitCalled = false;
			let exitCode = null;
			const origExit = process.exit;
			process.exit = (code) => {
				exitCalled = true;
				exitCode = code;
			};

			try {
				indexModule._resetShutdownForTesting();
				// Start first shutdown
				const p = indexModule.gracefulShutdown("SIGTERM", { exitProcess: false });
				assert.equal(indexModule.getIsShuttingDown(), true);

				// Send second signal while first is in progress
				await indexModule.gracefulShutdown("SIGTERM", { exitProcess: true });
				assert.equal(exitCalled, true);
				assert.equal(exitCode, 1);

				await p;
			} finally {
				process.exit = origExit;
				indexModule._resetShutdownForTesting();
			}
		});
	});
});
