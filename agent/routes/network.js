const express = require("express");
const router = express.Router();
const os = require("os");
const { PORT, BASE_DIR, CF_DOMAIN } = require("../config");
const { getTunnelStatus } = require("../tunnel");

router.get("/info", (req, res) => {
	try {
		const ifaces = os.networkInterfaces();
		let serverLocalIp = null;

		for (const name of Object.keys(ifaces)) {
			// Skip Docker, veth, bridge, virtualbox, and VPN virtual interfaces
			if (/^(docker|veth|br-|vbox|vmnet|tun|tap)/i.test(name)) continue;

			for (const iface of ifaces[name]) {
				if (iface.family === "IPv4" && !iface.internal) {
					serverLocalIp = iface.address;
					break;
				}
			}
			if (serverLocalIp) break;
		}

		let user = "user";
		try {
			user = os.userInfo().username || process.env.USER || "user";
		} catch {
			user = process.env.USER || "user";
		}

		res.json({
			status: "ok",
			serverLocalIp,
			serverLocalPort: PORT,
			baseDir: BASE_DIR,
			cfDomain: CF_DOMAIN,
			tunnel: getTunnelStatus(),
			user,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

router.get("/tunnel", (req, res) => {
	try {
		res.json({
			status: "ok",
			tunnel: getTunnelStatus(),
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

module.exports = router;
