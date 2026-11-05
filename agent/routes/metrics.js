const express = require("express");
const router = express.Router();
const si = require("systeminformation");
const { bindStreamToSession } = require("../services/sessionStreams");

async function getMetrics() {
	const cpu = await si.currentLoad();
	const mem = await si.mem();
	const disk = await si.fsSize();
	const network = await si.networkStats();
	return { cpu, mem, disk, network };
}

router.get("/", (req, res) => {
	res.set("Content-Type", "text/event-stream");
	res.set("Cache-Control", "no-cache");
	res.set("Connection", "keep-alive");
	// Tell the client to wait 5 seconds before reconnecting on disconnect
	// This prevents hammering the server/tunnel on reconnect storms
	res.write("retry: 5000\n\n");
	res.flushHeaders();

	let closed = false;

	// Metrics interval — emit real data every 2 seconds
	const metricsInterval = setInterval(async () => {
		if (closed) return;
		try {
			const data = await getMetrics();
			res.write(`data: ${JSON.stringify(data)}\n\n`);
		} catch (err) {
			console.error("[metrics] Error collecting metrics:", err.message);
		}
	}, 2000);

	// Heartbeat comment every 15 seconds to keep the Cloudflare Tunnel
	// connection alive and prevent idle stream termination
	const heartbeatInterval = setInterval(() => {
		if (closed) return;
		try {
			res.write(": heartbeat\n\n");
		} catch (_) {}
	}, 15000);

	const cleanup = () => {
		if (closed) return;
		closed = true;
		clearInterval(metricsInterval);
		clearInterval(heartbeatInterval);
	};

	bindStreamToSession(req, res, cleanup);
	req.on("close", cleanup);
});

module.exports = router;
