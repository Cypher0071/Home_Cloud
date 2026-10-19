require("dotenv").config();
const express = require("express");
const app = express();
const http = require("http");
const ws = require("ws");
const path = require("path");
const fs = require("fs");
const { PORT } = require("./config");
const {
	startTunnel,
	stopTunnel,
	startTunnelWithRetry,
} = require("./tunnel");
const cookieParser = require("cookie-parser");
const auth = require("./routes/auth");
const authMiddleware = require("./middleware/auth");
const { handleSystemTerminal, closeAllSessions } = require("./sockets/terminal");
const { handleContainerExec } = require("./sockets/containerExec");

const server = http.createServer(app);
const WebSocketServer = ws.WebSocketServer;
const wss = new WebSocketServer({ server });

let isShuttingDown = false;

// Master WebSocket Router: isolates host terminal and container exec connections deterministically
wss.on("connection", (socket, request) => {
	if (isShuttingDown) {
		socket.close(1001, "Server is shutting down");
		return;
	}
	let pathname = "";
	try {
		pathname = new URL(request.url || "", "http://localhost").pathname;
	} catch {
		socket.close();
		return;
	}
	if (pathname === "/ws/docker/exec") {
		handleContainerExec(socket, request);
	} else if (pathname === "/terminal") {
		handleSystemTerminal(socket, request);
	} else {
		socket.close();
	}
});

// Middleware to refuse new requests during graceful shutdown
app.use((req, res, next) => {
	if (isShuttingDown) {
		res.setHeader("Connection", "close");
		return res.status(503).json({ error: "Server is shutting down" });
	}
	next();
});

app.use(express.json());
app.use(cookieParser());

// Public endpoints (no auth required)
app.use("/api/auth", auth);

// Public Ping endpoint for Local LAN micro-ping detection with CORS & Private Network Access support
app.all("/api/ping", (req, res) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "*");
	res.setHeader("Access-Control-Allow-Private-Network", "true");
	if (req.method === "OPTIONS") {
		return res.sendStatus(204);
	}
	res.json({ status: "ok" });
});

// Public Healthcheck endpoint with CORS & Private Network Access support
app.all("/api/health", (req, res) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "*");
	res.setHeader("Access-Control-Allow-Private-Network", "true");
	if (req.method === "OPTIONS") {
		return res.sendStatus(204);
	}
	res.json({
		status: "ok",
		shuttingDown: isShuttingDown,
	});
});

// Authenticated endpoints
app.use("/api", authMiddleware);
app.use("/api/network", require("./routes/network"));
app.use("/api/metrics", require("./routes/metrics"));
app.use("/api/files", require("./routes/file"));
app.use("/api/settings", require("./routes/settings"));
const composeRoutes = require("./routes/compose");
app.use("/api/docker/compose", composeRoutes);
app.use("/api/docker/stacks", composeRoutes);
app.use("/api/docker", require("./routes/docker"));
app.use(express.static(path.join(__dirname, "../dashboard/dist")));

const distIndexPath = path.join(__dirname, "../dashboard/dist", "index.html");

app.get("/{*path}", (req, res) => {
	if (fs.existsSync(distIndexPath)) {
		return res.sendFile(distIndexPath);
	}

	// In development, redirect to the Vite dev server if port 3000 is directly hit
	if (process.env.NODE_ENV !== "production") {
		return res.redirect(`http://localhost:5173${req.originalUrl}`);
	}

	res.status(503).send("Dashboard is not built. Please run 'pnpm run build'.");
});

/**
 * Handles graceful shutdown upon SIGTERM or SIGINT signals.
 * Stops accepting new connections, drains existing connections, closes WebSockets,
 * cleans up active terminal PTY sessions, stops the Cloudflare tunnel, and exits cleanly.
 *
 * @param {string} signal
 * @param {object} [options]
 * @param {boolean} [options.exitProcess=true] Whether to trigger process.exit
 * @returns {Promise<void>}
 */
async function gracefulShutdown(signal, { exitProcess = true } = {}) {
	if (isShuttingDown) {
		console.log(`[agent] Shutdown already in progress (${signal})...`);
		return;
	}
	isShuttingDown = true;
	console.log(`[agent] Received ${signal}. Starting graceful shutdown...`);

	// Safety timeout: 10s unref'd timer to prevent hanging if anything gets stuck
	const forceExitTimer = setTimeout(() => {
		console.error("[agent] Graceful shutdown timed out after 10s. Forcing exit.");
		if (exitProcess) {
			process.exit(1);
		}
	}, 10000);
	if (forceExitTimer && forceExitTimer.unref) forceExitTimer.unref();

	try {
		// 1. Close HTTP server so no new incoming connections are accepted
		const serverClosePromise = new Promise((resolve) => {
			if (!server.listening) {
				resolve();
				return;
			}
			server.close((err) => {
				if (err) {
					console.error("[agent] Error closing HTTP server:", err.message);
				} else {
					console.log("[agent] HTTP server closed successfully.");
				}
				resolve();
			});
		});

		// Close any idle keep-alive connections if supported by Node runtime
		if (server.listening && typeof server.closeIdleConnections === "function") {
			server.closeIdleConnections();
		}

		// 2. Close all connected WebSockets gracefully
		console.log(`[agent] Closing ${wss.clients.size} active WebSocket client(s)...`);
		for (const client of wss.clients) {
			try {
				client.close(1001, "Server shutting down");
			} catch (err) {
				console.error("[agent] Error closing WebSocket client:", err.message);
			}
		}

		// 3. Clean up active host terminal PTY sessions so no orphaned bash processes survive
		console.log("[agent] Cleaning up active host terminal PTY sessions...");
		const closedPtys = closeAllSessions();
		console.log(`[agent] Terminated ${closedPtys} active terminal PTY session(s).`);

		// 4. Await stopTunnel() to gracefully terminate cloudflared process
		console.log("[agent] Stopping Cloudflare tunnel process...");
		await stopTunnel();

		// Await server close
		await serverClosePromise;

		console.log("[agent] Graceful shutdown completed cleanly.");
		clearTimeout(forceExitTimer);
		if (exitProcess) {
			process.exit(0);
		}
	} catch (err) {
		console.error("[agent] Error during graceful shutdown:", err);
		clearTimeout(forceExitTimer);
		if (exitProcess) {
			process.exit(1);
		}
	}
}

function _resetShutdownForTesting() {
	isShuttingDown = false;
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Non-blocking server startup: HTTP server listens immediately so local LAN (:3000)
// is accessible instantly on boot, while Cloudflare tunnel runs in background with retry.
if (require.main === module) {
	server.listen(PORT, () => {
		console.log(`Agent is running on port: ${PORT}`);
		startTunnelWithRetry().catch((err) => {
			console.error("[tunnel] Unexpected supervisor error:", err.message);
		});
	});
}

module.exports = {
	app,
	server,
	wss,
	gracefulShutdown,
	getIsShuttingDown: () => isShuttingDown,
	_resetShutdownForTesting,
};
