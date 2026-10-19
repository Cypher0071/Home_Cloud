const Docker = require("dockerode");
const docker = new Docker();
const express = require("express");
const router = express.Router();
const {
	getIngressRules,
	removeIngressByPort,
	addIngressRule,
	removeIngressRule,
	reloadCloudflared,
	exposeContainer,
	unexposeContainer,
	validateSubdomain,
} = require("../services/ingress");
const { CF_DOMAIN } = require("../config");
const { BASE_DIR, jailPath } = require("../paths");

router.get("/containers", async (req, res) => {
	try {
		const containers = await docker.listContainers({ all: true });
		const ingressRules = getIngressRules();

		const enriched = containers.map((c) => {
			let exposedRule = null;
			if (c.Ports && Array.isArray(c.Ports)) {
				for (const p of c.Ports) {
					if (p.PublicPort) {
						const match = ingressRules.find(
							(r) => String(r.port) === String(p.PublicPort),
						);
						if (match) {
							exposedRule = match;
							break;
						}
					}
				}
			}
			return { ...c, exposedRule };
		});

		res.json({ containers: enriched });
	} catch (err) {
		return res.status(500).json({ error: err.message });
	}
});

router.post("/containers/:id/start", async (req, res) => {
	const container = docker.getContainer(req.params.id);

	try {
		await container.start();
		res.json({ success: true });
	} catch (err) {
		if (err.statusCode === 304)
			return res
				.status(409)
				.json({ error: "Container is already running" });
		return res.status(500).json({ error: err.message });
	}
});

router.post("/containers/:id/stop", async (req, res) => {
	const container = docker.getContainer(req.params.id);

	try {
		await container.stop();
		res.json({ success: true });
	} catch (err) {
		if (err.statusCode === 304)
			return res
				.status(409)
				.json({ error: "Container is already stopped" });
		return res.status(500).json({ error: err.message });
	}
});

router.post("/containers/:id/restart", async (req, res) => {
	const container = docker.getContainer(req.params.id);

	try {
		await container.restart();
		res.json({ success: true });
	} catch (err) {
		return res.status(500).json({ error: err.message });
	}
});

router.delete("/containers/:id/delete", async (req, res) => {
	const container = docker.getContainer(req.params.id);

	try {
		const info = await container.inspect().catch(() => null);
		await container.remove();

		if (info && info.NetworkSettings && info.NetworkSettings.Ports) {
			const ports = info.NetworkSettings.Ports;
			let removedAny = false;
			for (const key in ports) {
				if (ports[key] && ports[key].length > 0) {
					const hostPort = ports[key][0].HostPort;
					if (hostPort && (await removeIngressByPort(hostPort))) {
						removedAny = true;
					}
				}
			}
			if (removedAny) {
				await reloadCloudflared();
			}
		}

		res.json({ success: true });
	} catch (err) {
		if (err.statusCode === 409)
			return res
				.status(409)
				.json({ error: "Stop the container before deleting it" });
		return res.status(500).json({ error: err.message });
	}
});

router.get("/containers/:id/stats", async (req, res) => {
	const container = docker.getContainer(req.params.id);

	try {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});

		res.flushHeaders();

		const statsStream = await container.stats({ stream: true });

		statsStream.on("data", (chunk) => {
			res.write(`data: ${chunk.toString("utf8")}\n\n`);
		});

		statsStream.on("end", () => {
			res.end();
		});

		statsStream.on("error", (err) => {
			console.error("[stats stream] error:", err.message);
			res.end();
		});

		req.on("close", () => {
			statsStream.destroy();
		});
	} catch (err) {
		return res.status(500).json({ error: err.message });
	}
});

router.get("/containers/:id/inspect", async (req, res) => {
	const container = docker.getContainer(req.params.id);

	try {
		const data = await container.inspect();
		res.json({ data: data });
	} catch (err) {
		return res.status(500).json({ error: err.message });
	}
});

router.get("/containers/:id/logs", async (req, res) => {
	const container = docker.getContainer(req.params.id);

	try {
		const inspect = await container.inspect();

		const isTty = inspect.Config?.Tty ?? false;

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});

		res.flushHeaders();

		const logsStream = await container.logs({
			stdout: true,
			stderr: true,
			follow: true,
			tail: 200,
			timestamps: true, // Let's send timestamps so client can parse/toggle them
		});

		if (isTty) {
			// Raw stream - direct forwarding
			logsStream.on("data", (chunk) => {
				res.write(`data: ${chunk.toString("utf8")}\n\n`);
			});
		} else {
			// Multiplexed stream - must demux
			const { Writable } = require("stream");
			const sseStream = new Writable({
				write(chunk, encoding, callback) {
					res.write(`data: ${chunk.toString("utf8")}\n\n`);
					callback();
				},
			});
			container.modem.demuxStream(logsStream, sseStream, sseStream);
		}

		logsStream.on("end", () => {
			res.end();
		});

		logsStream.on("error", (err) => {
			console.error("[stats stream] error:", err.message);
			res.end();
		});

		req.on("close", () => {
			logsStream.destroy();
		});
	} catch (err) {
		return res.status(500).json({ error: err.message });
	}
});

router.get("/containers/:id/logs/download", async (req, res) => {
	const container = docker.getContainer(req.params.id);

	try {
		const inspect = await container.inspect();
		const isTty = inspect.Config?.Tty ?? false;

		const name = (inspect.Name ?? req.params.id).replace(/^\//, "");

		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${name}-logs.txt"`,
		);
		res.setHeader("Content-Type", "text/plain");
		const logsStream = await container.logs({
			stdout: true,
			stderr: true,
			follow: false, // get history and close
			timestamps: true,
		});
		if (isTty) {
			logsStream.pipe(res);
		} else {
			// Pipes the demuxed stdout/stderr text chunks directly into the HTTP response
			container.modem.demuxStream(logsStream, res, res);
		}
	} catch (err) {
		return res.status(500).json({ error: err.message });
	}
});

router.get("/images", async (req, res) => {
	try {
		const images = await docker.listImages({ all: true });
		res.json({ images: images });
	} catch (err) {
		return res.status(500).json({ error: err.message });
	}
});

router.delete("/images/:id", async (req, res) => {
	const image = docker.getImage(req.params.id);
	try {
		await image.remove();
		res.json({ success: true });
	} catch (err) {
		if (err.statusCode === 409)
			return res.status(409).json({
				error: "Image is in use by a container. Remove the container first.",
			});
		return res.status(500).json({ error: err.message });
	}
});

router.post("/images/prune", async (req, res) => {
	try {
		const pruneAll = req.body?.all !== false && req.query?.all !== "false";
		const opts = {
			filters: {
				dangling: [pruneAll ? "false" : "true"],
			},
		};
		const result = await docker.pruneImages(opts);
		const deletedCount = (result && Array.isArray(result.ImagesDeleted)) ? result.ImagesDeleted.length : 0;
		const spaceReclaimed = (result && typeof result.SpaceReclaimed === "number") ? result.SpaceReclaimed : 0;
		res.json({
			success: true,
			deletedCount,
			spaceReclaimed,
			result,
		});
	} catch (err) {
		return res.status(500).json({ error: err.message });
	}
});

router.get("/images/pull", async (req, res) => {
	const imageName = req.query.image;
	if (!imageName) {
		return res.status(400).json({ error: "Missing image query parameter" });
	}
	try {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});

		res.flushHeaders();

		const stream = await docker.pull(imageName);
		docker.modem.followProgress(
			stream,
			(err, output) => {
				if (err) {
					res.write(
						`data: ${JSON.stringify({ error: err.message })}\n\n`,
					);
				} else {
					res.write(
						`data: ${JSON.stringify({ status: "success" })}\n\n`,
					);
				}
				res.end();
			},
			(event) => {
				res.write(`data: ${JSON.stringify(event)}\n\n`);
			},
		);
		req.on("close", () => {
			if (stream && typeof stream.destroy === "function") {
				stream.destroy();
			}
		});
	} catch (err) {
		if (res.headersSent) {
			res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
			res.end();
		} else {
			return res.status(500).json({ error: err.message });
		}
	}
});

router.post("/containers/create", async (req, res) => {
	if (!req.body?.image) {
		return res.status(400).json({ error: "Image name is required" });
	}

	const exposedPorts = {};
	const portBindings = {};

	if (Array.isArray(req.body.ports)) {
		req.body.ports.forEach((p) => {
			if (p.containerPort && p.hostPort) {
				const containerKey = `${p.containerPort}/tcp`; // e.g. "80/tcp"
				exposedPorts[containerKey] = {};
				portBindings[containerKey] = [{ HostPort: String(p.hostPort) }];
			}
		});
	}

function isNamedVolume(val) {
	if (!val || typeof val !== "string") return false;
	const trimmed = val.trim();
	if (
		trimmed.startsWith("/") ||
		trimmed.startsWith(".") ||
		trimmed.startsWith("~") ||
		trimmed.includes("/") ||
		trimmed.includes("\\")
	) {
		return false;
	}
	return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(trimmed);
}

	const bindsArray = [];

	if (Array.isArray(req.body.volumes)) {
		for (const v of req.body.volumes) {
			if (!v.hostPath || !v.containerPath) continue;
			const rawHost = String(v.hostPath).trim();
			const rawContainer = String(v.containerPath).trim();
			if (!rawHost || !rawContainer) continue;

			if (isNamedVolume(rawHost)) {
				// Native Docker named volume (e.g., pgdata, redis_data)
				bindsArray.push(`${rawHost}:${rawContainer}:rw`);
			} else {
				// Host filesystem bind mount -> must be jailed inside BASE_DIR
				const host = jailPath(rawHost);
				if (!host) {
					return res.status(403).json({
						error: `Host path must be inside allowed storage scope`,
					});
				}
				bindsArray.push(`${host}:${rawContainer}:rw`);
			}
		}
	}

	const options = {
		Image: req.body.image,
		name: req.body.name || undefined,
		Env: Array.isArray(req.body.env) ? req.body.env : undefined,
		ExposedPorts: exposedPorts,
		HostConfig: {
			PortBindings: portBindings,
			Binds: bindsArray,
			RestartPolicy: {
				Name: req.body.restartPolicy || "no",
			},
		},
	};
	try {
		const container = await docker.createContainer(options);
		await container.start();
		res.json({ success: true, containerId: container.id });
	} catch (err) {
		if (err.statusCode === 409) {
			return res.status(409).json({ error: "A container with this name already exists" });
		}
		if (err.statusCode === 404) {
			return res.status(404).json({ error: `Image '${req.body.image}' not found locally. Please pull it first.` });
		}
		return res.status(500).json({ error: err.message });
	}
});

router.post("/containers/:id/expose", async (req, res) => {
	const { id } = req.params;
	const { subdomain } = req.body;

	if (!subdomain) {
		return res.status(400).json({ error: "Subdomain is required" });
	}

	try {
		// Validate and normalize subdomain format and check reserved words early
		const cleanSubdomain = validateSubdomain(subdomain);

		const container = docker.getContainer(id);
		const info = await container.inspect();
		const ports = info.NetworkSettings.Ports || {};
		let hostPort = null;

		for (const key in ports) {
			if (ports[key] && ports[key].length > 0) {
				hostPort = ports[key][0].HostPort;
				break;
			}
		}

		if (!hostPort) {
			return res
				.status(400)
				.json({ error: "Container does not have any mapped host ports" });
		}

		const result = await exposeContainer(cleanSubdomain, hostPort);

		return res.json({
			success: true,
			url: result.url,
			subdomain: result.subdomain,
			hostPort,
		});
	} catch (err) {
		return res.status(400).json({ error: err.message });
	}
});

router.post("/containers/:id/unexpose", async (req, res) => {
	const { subdomain } = req.body;

	if (!subdomain) {
		return res.status(400).json({ error: "Subdomain is required" });
	}

	try {
		const cleanSubdomain = String(subdomain).trim().toLowerCase();
		await unexposeContainer(cleanSubdomain);
		return res.json({ success: true });
	} catch (err) {
		return res.status(400).json({ error: err.message });
	}
});

module.exports = router;
