const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { CF_CONFIG, TUNNEL_NAME, CF_DOMAIN } = require("./config");

let currentSpawn = spawn;
let activeChild = null;
let stopPromise = null;
let supervisorRunning = false;
let retryTimer = null;
let retryWakeup = null;
let isRestarting = false;

const tunnelState = {
	status: "stopped", // "connecting" | "connected" | "error" | "stopped"
	url: null,
	error: null,
};

/**
 * Returns current tunnel runtime status and public URL.
 */
function getTunnelStatus() {
	return {
		status: tunnelState.status,
		url: tunnelState.url,
		error: tunnelState.error,
	};
}

/**
 * Gracefully terminates active tunnel process and awaits its cleanup.
 * Sends SIGTERM, listens for 'close', and escalates to SIGKILL after fallback timeout.
 *
 * @param {object} [options]
 * @param {boolean} [options.stopSupervisor=true] Whether to halt the retry supervisor loop
 * @param {number} [options.sigkillTimeoutMs=3000] Fallback timeout before sending SIGKILL
 * @returns {Promise<void>}
 */
async function stopTunnel({ stopSupervisor = true, sigkillTimeoutMs = 3000 } = {}) {
	if (stopSupervisor) {
		supervisorRunning = false;
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		if (retryWakeup) {
			retryWakeup();
			retryWakeup = null;
		}
	}

	if (!activeChild) {
		tunnelState.status = "stopped";
		tunnelState.url = null;
		return;
	}

	if (stopPromise) {
		return stopPromise;
	}

	const child = activeChild;
	stopPromise = new Promise((resolve) => {
		let closed = false;
		let killTimer = null;

		const cleanupAndResolve = () => {
			if (closed) return;
			closed = true;
			if (killTimer) {
				clearTimeout(killTimer);
				killTimer = null;
			}
			if (activeChild === child) {
				activeChild = null;
			}
			tunnelState.status = "stopped";
			tunnelState.url = null;
			stopPromise = null;
			resolve();
		};

		// If child has already terminated
		if (child.exitCode !== null || child.signalCode !== null) {
			cleanupAndResolve();
			return;
		}

		child.once("close", () => {
			cleanupAndResolve();
		});

		// Fallback: SIGKILL after sigkillTimeoutMs if process doesn't exit promptly
		killTimer = setTimeout(() => {
			if (!closed && child.exitCode === null && child.signalCode === null) {
				console.warn(
					`[tunnel] cloudflared did not exit within ${sigkillTimeoutMs}ms of SIGTERM, escalating to SIGKILL`,
				);
				try {
					child.kill("SIGKILL");
				} catch (_) {}
			}
		}, sigkillTimeoutMs);
		if (killTimer && killTimer.unref) killTimer.unref();

		try {
			child.kill("SIGTERM");
		} catch (err) {
			cleanupAndResolve();
		}
	});

	return stopPromise;
}

/**
 * Starts cloudflared tunnel process.
 * Awaits termination of any existing tunnel child before spawning a new one.
 *
 * @param {object} [options]
 * @param {Function} [options.spawnFn] Optional custom spawn function for testing
 * @returns {Promise<string>} Public tunnel URL
 */
async function startTunnel(options = {}) {
	const spawnFn = options.spawnFn || currentSpawn;

	// Resolve Tech Debt #1: Await previous activeChild exit before spawning new one
	if (activeChild) {
		await stopTunnel({ stopSupervisor: false });
	}

	tunnelState.status = "connecting";
	tunnelState.error = null;

	return new Promise((resolve, reject) => {
		const child = spawnFn("cloudflared", [
			"tunnel",
			"--config",
			CF_CONFIG,
			"run",
			TUNNEL_NAME,
		]);

		activeChild = child;
		let resolved = false;

		const onData = (data) => {
			const str = data.toString();
			console.log(str);
			if (
				!resolved &&
				(str.includes("Registered tunnel connection") ||
					str.includes("INF Registered tunnel connection"))
			) {
				resolved = true;
				const url = CF_DOMAIN ? `https://dash.${CF_DOMAIN}` : null;
				tunnelState.status = "connected";
				tunnelState.url = url;
				tunnelState.error = null;
				resolve(url);
			}
		};

		if (child.stdout) child.stdout.on("data", onData);
		if (child.stderr) child.stderr.on("data", onData);

		child.on("error", (err) => {
			if (activeChild === child) {
				activeChild = null;
			}
			if (!resolved) {
				resolved = true;
				tunnelState.status = "error";
				tunnelState.error = err.message;
				tunnelState.url = null;
				reject(err);
			}
		});

		child.on("close", (code, signal) => {
			console.log(
				`[tunnel] Cloudflare process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`,
			);
			if (activeChild === child) {
				activeChild = null;
			}
			if (!resolved) {
				resolved = true;
				const err = new Error(`cloudflared exited with code ${code}`);
				tunnelState.status = "error";
				tunnelState.error = err.message;
				tunnelState.url = null;
				reject(err);
			} else {
				if (tunnelState.status !== "stopped") {
					tunnelState.status = "error";
					tunnelState.error = `cloudflared exited unexpectedly with code ${code}`;
					tunnelState.url = null;
				}
			}
		});
	});
}

/**
 * Restarts tunnel by stopping current instance and spawning fresh one.
 * Sets isRestarting flag to prevent supervisor retry storms.
 *
 * @returns {Promise<string>}
 */
async function restartTunnel() {
	isRestarting = true;
	try {
		return await startTunnel();
	} finally {
		isRestarting = false;
	}
}

/**
 * Launches tunnel startup in the background with an exponential backoff retry loop.
 * Keeps retrying until Cloudflare connects, and handles automatic recovery on disconnect.
 *
 * @param {object} [options]
 * @param {number} [options.initialDelayMs=2000] Initial retry delay
 * @param {number} [options.maxDelayMs=30000] Maximum retry backoff delay
 * @param {number} [options.factor=2] Exponential multiplication factor
 * @param {Function} [options.spawnFn] Optional custom spawn function for testing
 */
async function startTunnelWithRetry(options = {}) {
	const {
		initialDelayMs = 2000,
		maxDelayMs = 30000,
		factor = 2,
		spawnFn,
	} = options;

	if (supervisorRunning) {
		return;
	}

	// Pre-flight check: If config.yml does not exist on disk, tunnel is unconfigured.
	// Gracefully run in LAN-only mode without flooding journal with crash/exit logs every 30s.
	if (!fs.existsSync(CF_CONFIG)) {
		tunnelState.status = "unconfigured";
		tunnelState.url = null;
		tunnelState.error = null;
		console.log(
			`[tunnel] Notice: Config file not found at ${CF_CONFIG}. Remote Cloudflare tunnel is inactive; local LAN access is active.`
		);
		return;
	}

	supervisorRunning = true;
	let currentDelay = initialDelayMs;

	while (supervisorRunning) {
		try {
			console.log("[tunnel] Starting Cloudflare tunnel connection in background...");
			const url = await startTunnel(spawnFn ? { spawnFn } : {});
			console.log(`[tunnel] Tunnel successfully established: ${url}`);
			currentDelay = initialDelayMs; // Reset backoff on successful connection

			// Tunnel is running: wait for activeChild to exit
			while (supervisorRunning && activeChild) {
				await new Promise((resolve) => {
					if (!activeChild) return resolve();
					activeChild.once("close", resolve);
				});
			}

			if (!supervisorRunning) break;

			// If explicitly restarting (e.g. from ingress route changes), wait for restart
			if (isRestarting) {
				while (isRestarting && supervisorRunning) {
					await new Promise((r) => setTimeout(r, 100));
				}
				continue;
			}

			console.warn(`[tunnel] Tunnel connection lost. Retrying in ${currentDelay / 1000}s...`);
		} catch (err) {
			if (!supervisorRunning) break;
			console.error(
				`[tunnel] Tunnel connection attempt failed: ${err.message}. Retrying in ${currentDelay / 1000}s...`,
			);
		}

		if (!supervisorRunning) break;

		// Sleep with exponential backoff (wakes up instantly if stopTunnel is called)
		await new Promise((resolve) => {
			retryWakeup = resolve;
			retryTimer = setTimeout(() => {
				retryTimer = null;
				retryWakeup = null;
				resolve();
			}, currentDelay);
		});

		currentDelay = Math.min(currentDelay * factor, maxDelayMs);
	}
}

function _setSpawn(customSpawn) {
	currentSpawn = customSpawn;
}

function _resetSpawn() {
	currentSpawn = spawn;
}

module.exports = {
	startTunnel,
	stopTunnel,
	restartTunnel,
	startTunnelWithRetry,
	getTunnelStatus,
	getActiveChild: () => activeChild,
	_setSpawn,
	_resetSpawn,
};
