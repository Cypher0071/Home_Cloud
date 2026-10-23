const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const Docker = require("dockerode");
const docker = new Docker();

function runCompose(args, cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn("docker", ["compose", ...args], {
			cwd: cwd || undefined,
		});
		let stderr = "";
		let stdout = "";
		let settled = false;
		if (child.stdout) {
			child.stdout.on("data", (chunk) => {
				stdout += chunk.toString("utf8");
			});
		}
		if (child.stderr) {
			child.stderr.on("data", (chunk) => {
				stderr += chunk.toString("utf8");
			});
		}
		child.on("error", (err) => {
			if (!settled) {
				settled = true;
				reject(err);
			}
		});
		child.on("close", (code) => {
			if (!settled) {
				settled = true;
				if (code === 0) {
					resolve({ stdout, stderr });
				} else {
					reject(new Error(stderr.trim() || stdout.trim() || `docker compose exited with code ${code}`));
				}
			}
		});
	});
}

function isNoContainerToStartError(error) {
	const message = error instanceof Error ? error.message : String(error || "");
	return /\bno container to start\b/i.test(message) || /\bno container found for project\b/i.test(message);
}

const COMPOSE_DIR = path.resolve(path.join(os.homedir(), ".home-cloud", "compose"));
const LEGACY_STACKS_DIR = path.resolve(path.join(os.homedir(), ".home-cloud", "stacks"));

// Backwards compatibility migration:
// If legacy ~/.home-cloud/stacks exists, migrate its contents to ~/.home-cloud/compose
const isLegacySymlink = (function () {
	try {
		return fs.existsSync(LEGACY_STACKS_DIR) && fs.lstatSync(LEGACY_STACKS_DIR).isSymbolicLink();
	} catch {
		return false;
	}
})();

if (fs.existsSync(LEGACY_STACKS_DIR) && !isLegacySymlink) {
	if (!fs.existsSync(COMPOSE_DIR)) {
		try {
			fs.renameSync(LEGACY_STACKS_DIR, COMPOSE_DIR);
			console.log("[compose] Successfully migrated ~/.home-cloud/stacks to ~/.home-cloud/compose");
		} catch (err) {
			console.warn(`[compose] Failed to rename ${LEGACY_STACKS_DIR} to ${COMPOSE_DIR}, falling back to copy:`, err.message);
			try {
				fs.cpSync(LEGACY_STACKS_DIR, COMPOSE_DIR, { recursive: true });
			} catch (cpErr) {
				console.error("[compose] Failed to copy legacy stacks to compose directory:", cpErr.message);
			}
		}
	} else {
		// Both exist: copy any missing folders from legacy stacks to compose
		try {
			const legacyEntries = fs.readdirSync(LEGACY_STACKS_DIR, { withFileTypes: true });
			for (const entry of legacyEntries) {
				if (entry.isDirectory()) {
					const targetPath = path.join(COMPOSE_DIR, entry.name);
					if (!fs.existsSync(targetPath)) {
						fs.cpSync(path.join(LEGACY_STACKS_DIR, entry.name), targetPath, { recursive: true });
						console.log(`[compose] Migrated legacy stack '${entry.name}' to compose directory`);
					}
				}
			}
		} catch (scanErr) {
			console.warn("[compose] Error scanning legacy stacks directory:", scanErr.message);
		}
	}
}

if (!fs.existsSync(COMPOSE_DIR)) {
	fs.mkdirSync(COMPOSE_DIR, { recursive: true });
}

// Maintain backward compatibility on filesystem: symlink legacy stacks -> compose if missing
if (!fs.existsSync(LEGACY_STACKS_DIR)) {
	try {
		fs.symlinkSync(COMPOSE_DIR, LEGACY_STACKS_DIR);
	} catch {
		// symlink creation non-fatal
	}
}

function isSafeProjectName(name) {
	return typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);
}

function resolveComposeFolder(name) {
	if (!isSafeProjectName(name)) return null;
	const resolved = path.resolve(COMPOSE_DIR, name);
	if (resolved === COMPOSE_DIR) return null;
	if (!resolved.startsWith(COMPOSE_DIR + path.sep)) return null;
	if (path.basename(resolved) !== name) return null;
	return resolved;
}

const COMPOSE_CANDIDATES = [
	"docker-compose.yml",
	"docker-compose.yaml",
	"compose.yml",
	"compose.yaml",
];

function findComposeFile(folder) {
	if (!folder || typeof folder !== "string") return null;
	try {
		if (!fs.existsSync(folder)) return null;
		for (const file of COMPOSE_CANDIDATES) {
			const p = path.join(folder, file);
			if (fs.existsSync(p)) return p;
		}
	} catch {
		return null;
	}
	return null;
}

function getComposeFilePath(folder) {
	const existing = findComposeFile(folder);
	if (existing) return existing;
	return path.join(folder, "docker-compose.yml");
}

// GET /api/docker/compose - List all compose projects
router.get("/", async (req, res) => {
	try {
		const containers = await docker.listContainers({ all: true });

		const composeContainersMap = {};
		for (const c of containers) {
			const project = c.Labels ? c.Labels["com.docker.compose.project"] : null;
			if (project) {
				if (!composeContainersMap[project]) {
					composeContainersMap[project] = [];
				}
				composeContainersMap[project].push({
					id: c.Id,
					name: (c.Names && c.Names[0] ? c.Names[0] : "").replace(/^\//, ""),
					service: c.Labels["com.docker.compose.service"] || "unknown",
					image: c.Image,
					state: c.State,
					status: c.Status,
				});
			}
		}

		let composeFolders = [];
		if (fs.existsSync(COMPOSE_DIR)) {
			const entries = fs.readdirSync(COMPOSE_DIR, { withFileTypes: true });
			composeFolders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
		}

		const allProjectNames = Array.from(
			new Set([...composeFolders, ...Object.keys(composeContainersMap)]),
		);

		const projects = allProjectNames.map((name) => {
			const projectFolder = resolveComposeFolder(name);
			const composePath = projectFolder ? findComposeFile(projectFolder) : null;
			const yamlExists = Boolean(composePath && fs.existsSync(composePath));
			const cList = composeContainersMap[name] || [];
			const runningCount = cList.filter((c) => c.state === "running").length;

			let status = "uncreated";
			if (cList.length > 0) {
				if (runningCount === cList.length) status = "running";
				else if (runningCount > 0) status = "partial";
				else status = "stopped";
			}

			return {
				name,
				status,
				servicesCount: cList.length,
				runningServicesCount: runningCount,
				containers: cList,
				yamlExists,
			};
		});

		// Maintain backwards and forwards compatibility
		res.json({ compose: projects, projects, stacks: projects });
	} catch (err) {
		console.error("[compose] Error listing compose projects:", err.message);
		res.status(500).json({ error: err.message });
	}
});

// GET /api/docker/compose/:name - Get project details & yaml content
router.get("/:name", async (req, res) => {
	const { name } = req.params;
	const projectFolder = resolveComposeFolder(name);
	if (!projectFolder) {
		return res.status(400).json({ error: "Invalid compose project name" });
	}
	const composePath = findComposeFile(projectFolder);

	try {
		if (!composePath || !fs.existsSync(composePath)) {
			return res.status(404).json({ error: `Compose project '${name}' not found` });
		}
		const yaml = fs.readFileSync(composePath, "utf8");

		const containers = await docker.listContainers({ all: true });
		const projectContainers = containers
			.filter((c) => c.Labels && c.Labels["com.docker.compose.project"] === name)
			.map((c) => ({
				id: c.Id,
				name: (c.Names && c.Names[0] ? c.Names[0] : "").replace(/^\//, ""),
				service: c.Labels["com.docker.compose.service"] || "unknown",
				image: c.Image,
				state: c.State,
				status: c.Status,
			}));

		res.json({ name, yaml, containers: projectContainers });
	} catch (err) {
		console.error(`[compose] Error fetching details for project '${name}':`, err.message);
		res.status(500).json({ error: err.message });
	}
});

// POST /api/docker/compose/deploy - Save & Deploy compose project with live SSE progress stream
router.post(["/deploy", "/:name/deploy"], async (req, res) => {
	const name = req.params.name || req.body.name;
	const { yaml } = req.body;

	if (!name || !yaml) {
		return res.status(400).json({ error: "Compose project name and YAML content are required" });
	}

	const projectFolder = resolveComposeFolder(name);
	if (!projectFolder) {
		return res.status(400).json({ error: "Invalid compose project name" });
	}
	const filePath = getComposeFilePath(projectFolder);

	try {
		if (!fs.existsSync(projectFolder)) {
			fs.mkdirSync(projectFolder, { recursive: true });
		}
		fs.writeFileSync(filePath, yaml, "utf8");

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.flushHeaders();

		const child = spawn("docker", ["compose", "-f", filePath, "-p", name, "up", "-d", "--remove-orphans"]);

		child.stdout.on("data", (chunk) => {
			res.write(`data: ${JSON.stringify({ text: chunk.toString("utf8") })}\n\n`);
		});

		child.stderr.on("data", (chunk) => {
			res.write(`data: ${JSON.stringify({ text: chunk.toString("utf8") })}\n\n`);
		});

		let settled = false;
		const finish = (payload) => {
			if (settled || res.writableEnded) return;
			settled = true;
			res.write(`data: ${JSON.stringify(payload)}\n\n`);
			res.end();
		};

		child.on("error", (err) => {
			console.error(`[compose] Failed to start docker compose for '${name}':`, err.message);
			finish({ status: "failed", error: `Failed to start docker compose: ${err.message}` });
		});

		child.on("close", (code, signal) => {
			if (code === 0) {
				finish({ status: "success" });
			} else {
				console.warn(`[compose] Deployment for '${name}' ended with code ${code}, signal ${signal}`);
				finish({ status: "failed", exitCode: code, signal });
			}
		});

		res.on("close", () => {
			if (!res.writableEnded && !child.killed) {
				child.kill();
			}
		});
	} catch (err) {
		console.error(`[compose] Unexpected deployment error for '${name}':`, err.message);
		if (!res.headersSent) {
			res.status(500).json({ error: err.message });
		} else {
			res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
			res.end();
		}
	}
});

// POST /api/docker/compose/:name/start - Start compose project containers
router.post("/:name/start", async (req, res) => {
	const { name } = req.params;
	const projectFolder = resolveComposeFolder(name);
	if (!projectFolder) {
		return res.status(400).json({ error: "Invalid compose project name" });
	}
	const composePath = findComposeFile(projectFolder);

	try {
		if (composePath && fs.existsSync(composePath)) {
			await runCompose(["start"], projectFolder).catch(async (err) => {
				if (isNoContainerToStartError(err)) {
					return runCompose(["up", "-d"], projectFolder);
				}
				throw err;
			});
		} else {
				await runCompose(["-p", name, "start"]).catch(async (err) => {
					if (isNoContainerToStartError(err)) {
					return runCompose(["-p", name, "up", "-d"]);
				}
				throw err;
			});
		}
		res.json({ success: true });
	} catch (err) {
		console.error(`[compose] Failed to start project '${name}':`, err.message);
		res.status(500).json({ error: err.message });
	}
});

// POST /api/docker/compose/:name/stop - Stop compose project containers
router.post("/:name/stop", async (req, res) => {
	const { name } = req.params;
	const projectFolder = resolveComposeFolder(name);
	if (!projectFolder) {
		return res.status(400).json({ error: "Invalid compose project name" });
	}
	const composePath = findComposeFile(projectFolder);

	try {
		if (composePath && fs.existsSync(composePath)) {
			await runCompose(["stop"], projectFolder);
		} else {
			await runCompose(["-p", name, "stop"]);
		}
		res.json({ success: true });
	} catch (err) {
		console.error(`[compose] Failed to stop project '${name}':`, err.message);
		res.status(500).json({ error: err.message });
	}
});

// DELETE /api/docker/compose/:name - Remove compose project containers and directory
router.delete("/:name", async (req, res) => {
	const { name } = req.params;
	const projectFolder = resolveComposeFolder(name);
	if (!projectFolder) {
		return res.status(400).json({ error: "Invalid compose project name" });
	}
	const composePath = findComposeFile(projectFolder);

	try {
		if (composePath && fs.existsSync(composePath)) {
			try {
				await runCompose(["down", "-v"], projectFolder);
			} catch {
				await runCompose(["-p", name, "down", "-v"]).catch(() => {});
			}
		} else {
			await runCompose(["-p", name, "down", "-v"]).catch(() => {});
		}

		if (fs.existsSync(projectFolder)) {
			fs.rmSync(projectFolder, { recursive: true, force: true });
		}

		res.json({ success: true });
	} catch (err) {
		console.error(`[compose] Failed to delete project '${name}':`, err.message);
		res.status(500).json({ error: err.message });
	}
});

// GET /api/docker/compose/:name/logs - Stream multi-container compose logs via SSE
router.get("/:name/logs", async (req, res) => {
	const { name } = req.params;
	const projectFolder = resolveComposeFolder(name);
	if (!projectFolder) {
		return res.status(400).json({ error: "Invalid compose project name" });
	}
	const composePath = findComposeFile(projectFolder);

	try {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.flushHeaders();

		const spawnArgs = (composePath && fs.existsSync(composePath))
			? ["compose", "-f", composePath, "-p", name, "logs", "-f", "--tail=200", "--timestamps"]
			: ["compose", "-p", name, "logs", "-f", "--tail=200", "--timestamps"];

		const child = spawn("docker", spawnArgs);

		child.stdout.on("data", (chunk) => {
			res.write(`data: ${JSON.stringify({ text: chunk.toString("utf8") })}\n\n`);
		});

		child.stderr.on("data", (chunk) => {
			res.write(`data: ${JSON.stringify({ text: chunk.toString("utf8") })}\n\n`);
		});

		child.on("error", (err) => {
			console.error(`[compose] Error streaming logs for '${name}':`, err.message);
			res.end();
		});

		res.on("close", () => {
			if (!res.writableEnded && !child.killed) {
				child.kill();
			}
		});
	} catch (err) {
		console.error(`[compose] Failed to open logs stream for '${name}':`, err.message);
		res.status(500).json({ error: err.message });
	}
});

router.isSafeProjectName = isSafeProjectName;
router.resolveComposeFolder = resolveComposeFolder;
router.findComposeFile = findComposeFile;
router.getComposeFilePath = getComposeFilePath;
router.COMPOSE_DIR = COMPOSE_DIR;
router.LEGACY_STACKS_DIR = LEGACY_STACKS_DIR;
router.runCompose = runCompose;
router.isNoContainerToStartError = isNoContainerToStartError;

module.exports = router;
