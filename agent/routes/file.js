const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs/promises");
const mime = require("mime-types");
const multer = require("multer");
const si = require("systeminformation");
const { spawn } = require("child_process");
const { resolveUnderBase, isInsideAllowedScope } = require("../paths");
const { isSystemRootAllowed } = require("../services/preferences");

const resolvePath = resolveUnderBase;
const isInsideBase = isInsideAllowedScope;

function handleFsError(err, res, defaultMsg = "Filesystem error") {
	if (err && (err.code === "EACCES" || err.code === "EPERM")) {
		return res.status(403).json({ error: "Permission denied by host OS" });
	}
	return res.status(500).json({ error: err ? err.message : defaultMsg });
}

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		const dest = resolvePath(req.query.path);
		// Block uploads outside allowed storage scope
		if (!isInsideBase(dest)) {
			return cb(
				new Error(
					"Access denied: upload destination is outside allowed storage scope",
				),
			);
		}
		cb(null, dest);
	},
	filename: (req, file, cb) => {
		const name = path.basename(file.originalname);
		if (!name || name === "." || name === "..") {
			return cb(new Error("invalid filename"));
		}
		const dest = resolvePath(req.query.path);
		const finalPath = path.resolve(dest, name);
		if (!isInsideBase(finalPath)) {
			return cb(new Error("access denied"));
		}
		cb(null, name);
	},
});

const upload = multer({ storage });

router.get("/", async (req, res) => {
	const requestedPath = resolvePath(req.query.path);
	if (!isInsideBase(requestedPath)) {
		return res.status(403).json({ error: "Access denied: path is outside allowed storage scope" });
	} else {
		try {
			const files = await fs.readdir(requestedPath);
			const metadata = await Promise.all(
				files.map(async (file) => {
					const filepath = path.join(requestedPath, file);
					try {
						let stat;
						let isDirectory = false;
						let isSymlink = false;
						let isBroken = false;

						try {
							stat = await fs.stat(filepath);
							isDirectory = stat.isDirectory();
						} catch {
							// fs.stat follows symlinks and throws ENOENT if the target is missing.
							// Fallback to fs.lstat to inspect the symlink itself without failing.
							try {
								stat = await fs.lstat(filepath);
								isSymlink = stat.isSymbolicLink();
								isBroken = true;
								isDirectory = false;
							} catch {
								return null;
							}
						}

						return {
							name: file,
							isDirectory,
							isSymlink,
							isBroken,
							size: stat.size,
							modified: stat.mtime,
							mimeType: isDirectory
								? null
								: isBroken
									? "inode/symlink"
									: mime.lookup(file) || "application/octet-stream",
						};
					} catch {
						return null;
					}
				}),
			);
			res.json({ path: requestedPath, files: metadata.filter(Boolean) });
		} catch (err) {
			if (err && (err.code === "EACCES" || err.code === "EPERM")) {
				return res.status(403).json({ error: "Permission denied by host OS" });
			}
			console.log(err);
			return res.status(403).json({ error: "Error reading directory" });
		}
	}
});

router.post("/upload", upload.single("file"), async (req, res) => {
	res.json("file uploaded successfully");
});

router.get("/download", async (req, res) => {
	const requestedPath = resolvePath(req.query.path);
	if (!isInsideBase(requestedPath)) {
		return res.status(403).json({ error: "Access denied" });
	} else {
		res.download(requestedPath);
	}
});

router.delete("/delete", async (req, res) => {
	const requestedPath = resolvePath(req.query.path);
	if (!isInsideBase(requestedPath)) {
		return res.status(403).json({ error: "Access denied" });
	} else {
		try {
			await fs.rm(requestedPath, { recursive: true, force: true });
			res.json({ success: "ok" });
		} catch (err) {
			console.error(err);
			return handleFsError(err, res, "Error deleting file");
		}
	}
});

// Filesystem types that represent real, user-relevant storage
const REAL_FS_TYPES = new Set([
	"ext4",
	"ext3",
	"ext2", // Standard Linux
	"btrfs",
	"xfs",
	"zfs",
	"f2fs",
	"jfs", // Advanced Linux
	"drvfs", // WSL Windows drive mounts (/mnt/c, /mnt/e, etc.)
	"ntfs",
	"exfat",
	"vfat",
	"fat32",
	"fat16", // Windows/USB filesystems
	"apfs",
	"hfs+", // macOS
]);

const DRIVES_CACHE_TTL_MS = 10000; // 10 seconds TTL
let cachedDrives = null;
let drivesCacheTimestamp = 0;
let drivesInFlightPromise = null;

/**
 * Retrieves and filters filesystem drives with in-memory caching and request coalescing.
 * Avoids repeated expensive system shell calls (`df`) during rapid folder navigation.
 *
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh=false] Force bypass of cache
 * @param {number} [options.ttlMs=DRIVES_CACHE_TTL_MS] Custom TTL for cache
 * @param {Function} [options.fsSizeFn] Optional mock provider for testing
 * @returns {Promise<Array>}
 */
async function getFilteredDrives(options = {}) {
	const { forceRefresh = false, ttlMs = DRIVES_CACHE_TTL_MS, fsSizeFn = si.fsSize } = options;
	const now = Date.now();

	if (!forceRefresh && cachedDrives !== null && now - drivesCacheTimestamp < ttlMs) {
		return cachedDrives;
	}

	if (drivesInFlightPromise) {
		return drivesInFlightPromise;
	}

	drivesInFlightPromise = (async () => {
		try {
			const drives = await fsSizeFn();
			const filtered = (Array.isArray(drives) ? drives : []).filter((d) => {
				// Must be a recognised real filesystem type
				if (!REAL_FS_TYPES.has((d.type || "").toLowerCase())) return false;
				// Drop WSLg paths (GUI subsystem internals)
				if (d.mount && d.mount.includes("wslg")) return false;
				// Drop paths that look like files rather than directories (e.g. /mnt/wslg/versions.txt)
				if (d.mount && /\.\w+$/.test(d.mount)) return false;
				return true;
			});

			cachedDrives = filtered;
			drivesCacheTimestamp = Date.now();
			return filtered;
		} finally {
			drivesInFlightPromise = null;
		}
	})();

	return drivesInFlightPromise;
}

function _resetDrivesCacheForTesting() {
	cachedDrives = null;
	drivesCacheTimestamp = 0;
	drivesInFlightPromise = null;
}

function _getCachedDrivesStateForTesting() {
	return {
		hasCache: cachedDrives !== null,
		cacheTimestamp: drivesCacheTimestamp,
		cachedCount: cachedDrives ? cachedDrives.length : 0,
	};
}

router.get("/drives", async (req, res) => {
	try {
		const drives = await getFilteredDrives();
		const result = [...drives];

		// If system root access is allowed, ensure a root "/" drive entry exists
		const allowRoot = isSystemRootAllowed();
		const hasRoot = result.some((d) => d.mount === "/");
		if (allowRoot && !hasRoot) {
			result.unshift({
				fs: "rootfs",
				type: "ext4",
				size: 0,
				used: 0,
				use: 0,
				mount: "/",
				isSystemRoot: true,
			});
		}

		res.json(result);
	} catch (err) {
		console.error("[files] Error retrieving filesystem drives:", err.message);
		res.status(500).json({ error: "Failed to retrieve filesystem drives" });
	}
});

router.get("/view", async (req, res) => {
	const requestedPath = resolvePath(req.query.path);
	if (!isInsideBase(requestedPath)) {
		return res.status(403).json({ error: "Access denied" });
	}
	const mimeType = mime.lookup(requestedPath) || "application/octet-stream";
	res.setHeader("Content-Disposition", "inline");
	res.setHeader("Content-Type", mimeType);
	res.sendFile(requestedPath);
});

router.post("/copy", async (req, res) => {
	const src = resolvePath(req.body.src);
	const dest = resolvePath(req.body.dest);

	if (!isInsideBase(src) || !isInsideBase(dest)) {
		return res.status(403).json({ error: "Access denied" });
	}

	// Enforce same-path check on the server
	if (src === dest) {
		return res
			.status(400)
			.json({ error: "Source and destination are the same path" });
	}

	// Enforce destination-exists check on the server
	// fs.access resolves if the path exists, throws if it doesn't
	try {
		await fs.access(dest);
		// If we reach here, dest exists — reject
		return res.status(409).json({
			error: `"${path.basename(dest)}" already exists at the destination`,
		});
	} catch {
		// dest does not exist — safe to proceed
	}

	try {
		await fs.cp(src, dest, { recursive: true });
		res.json({ success: true });
	} catch (err) {
		handleFsError(err, res, err.message);
	}
});

router.get("/search", async (req, res) => {
	const query = String(req.query.search || "");
	const currentDir = resolvePath(req.query.path);

	if (!isInsideBase(currentDir)) {
		return res.status(403).json({ error: "Access denied" });
	}

	if (!query) {
		return res.json([]);
	}
	let settled = false;
	const safeRespond = (status, data) => {
		if (settled || res.headersSent) return;
		settled = true;
		res.status(status).json(data);
	};

	// Spawn fd to recursively list all file paths (colorless, starting at currentDir)
	const fd = spawn("fdfind", ["--color", "never", ".", currentDir]);
	// Spawn fzf in filter mode to perform fast fuzzy matching on the incoming file list
	const fzf = spawn("fzf", ["-f", query]);

	// Clean up child processes safely
	const cleanup = () => {
		try {
			if (!fd.killed) fd.kill();
		} catch (_) {}
		try {
			if (!fzf.killed) fzf.kill();
		} catch (_) {}
	};

	// Catch spawn and process errors on both workers to prevent server crash
	fd.on("error", (err) => {
		cleanup();
		safeRespond(500, { error: `File searcher error: ${err.message}` });
	});

	fzf.on("error", (err) => {
		cleanup();
		safeRespond(500, { error: `Fuzzy matcher error: ${err.message}` });
	});

	// Handle broken pipe (EPIPE) gracefully if fzf closes before fdfind finishes streaming
	fzf.stdin.on("error", (err) => {
		if (err.code !== "EPIPE") {
			console.error("[file search] fzf.stdin error:", err.message);
		}
	});

	fd.stdout.on("error", (err) => {
		if (err.code !== "EPIPE") {
			console.error("[file search] fd.stdout error:", err.message);
		}
	});

	// Pipe the output of fd directly into fzf's input
	fd.stdout.pipe(fzf.stdin);

	let stdout = "";
	let stderr = "";

	fzf.stdout.on("data", (data) => {
		stdout += data;
	});

	fzf.stderr.on("data", (data) => {
		stderr += data;
	});

	fzf.on("close", async (code) => {
		// When fzf finishes, terminate fd immediately so it doesn't stay scanning as a background zombie
		try {
			if (!fd.killed) fd.kill();
		} catch (_) {}

		if (settled || res.headersSent) return;

		// fzf exits with code 1 if no matches are found, which is a normal state
		if (code !== 0 && code !== 1 && stderr) {
			console.error(`fzf search error: ${stderr}`);
			return safeRespond(500, { error: "Search failed" });
		}

		const filePaths = stdout.split("\n").filter(Boolean).slice(0, 50); // limit to top 50 matches

		try {
			const metadata = await Promise.all(
				filePaths.map(async (filepath) => {
					try {
						const abs = path.isAbsolute(filepath)
							? path.resolve(filepath)
							: path.resolve(currentDir, filepath);
						if (!isInsideBase(abs)) return null;
						const stat = await fs.stat(abs);
						return {
							name: path.basename(filepath),
							path: abs,
							isDirectory: stat.isDirectory(),
							size: stat.size,
							modified: stat.mtime,
							mimeType: stat.isDirectory()
								? null
								: mime.lookup(filepath) ||
									"application/octet-stream",
						};
					} catch {
						return null;
					}
				}),
			);
			safeRespond(200, metadata.filter(Boolean));
		} catch (err) {
			console.error(err);
			safeRespond(500, { error: "Failed to gather file metadata" });
		}
	});

	// If the client aborts the request, kill both processes immediately
	req.on("close", () => {
		cleanup();
	});
});

router.patch("/rename", async (req, res) => {
	const oldPath = resolvePath(req.body.oldPath);
	const newPath = resolvePath(req.body.newPath);

	// Validate both paths are inside allowed scope
	if (!isInsideBase(oldPath) || !isInsideBase(newPath)) {
		return res.status(403).json({ error: "Access denied" });
	}

	// Prevent renaming to the same name/path
	if (oldPath === newPath) {
		return res
			.status(400)
			.json({ error: "New path is identical to the old path" });
	}

	// Verify destination does not already exist
	try {
		await fs.access(newPath);
		return res
			.status(409)
			.json({
				error: `A file or folder named "${path.basename(newPath)}" already exists`,
			});
	} catch {
		// safe to rename
	}

	try {
		await fs.rename(oldPath, newPath);
		res.json({ success: true });
	} catch (error) {
		console.error(error);
		return handleFsError(error, res, error.message);
	}
});

router.post("/folder", async (req, res) => {
	const folderName = String(req.body.name || "").trim();
	const destination = resolvePath(req.body.path);
	const targetDir = resolvePath(path.join(destination, folderName));

	if (!isInsideBase(targetDir)) {
		return res.status(403).json({ error: "Access denied" });
	}

	if (!folderName) {
		return res.status(400).json({ error: "Folder name is required" });
	}

	// Verify folder doesn't already exist
	try {
		await fs.access(targetDir);
		return res
			.status(409)
			.json({
				error: `A file or folder named "${folderName}" already exists here`,
			});
	} catch {
		// safe to create
	}

	try {
		await fs.mkdir(targetDir, { recursive: true });
		res.json({ success: true });
	} catch (error) {
		console.error(error);
		return handleFsError(error, res, error.message);
	}
});

router.post("/file", async (req, res) => {
	const fileName = String(req.body.name || "").trim();
	const destination = resolvePath(req.body.path);
	const targetFile = resolvePath(path.join(destination, fileName));

	if (!isInsideBase(targetFile)) {
		return res.status(403).json({ error: "Access denied" });
	}

	if (!fileName) {
		return res.status(400).json({ error: "File name is required" });
	}

	// Verify file doesn't already exist
	try {
		await fs.access(targetFile);
		return res
			.status(409)
			.json({
				error: `A file or folder named "${fileName}" already exists here`,
			});
	} catch {
		// safe to create
	}

	try {
		await fs.writeFile(targetFile, "");
		res.json({ success: true });
	} catch (error) {
		console.error(error);
		return handleFsError(error, res, error.message);
	}
});

router.patch("/move", async (req, res) => {
	const src = resolvePath(req.body.oldPath);
	const dest = resolvePath(req.body.newPath);

	// Validate both paths are inside allowed scope
	if (!isInsideBase(src) || !isInsideBase(dest)) {
		return res.status(403).json({ error: "Access denied" });
	}

	if (src === dest) {
		return res.json({ success: true });
	}

	// Verify destination does not already exist
	try {
		await fs.access(dest);
		return res.status(409).json({ error: `A file or folder named "${path.basename(dest)}" already exists` });
	} catch {
		// safe to move
	}

	try {
		await fs.rename(src, dest);
		res.json({ success: true });
	} catch (err) {
		if (err.code === "EXDEV") {
			// Cross-device fallback: copy then delete original
			try {
				await fs.cp(src, dest, { recursive: true });
				await fs.rm(src, { recursive: true, force: true });
				return res.json({ success: true });
			} catch (fallbackErr) {
				return handleFsError(fallbackErr, res, fallbackErr.message);
			}
		}
		return handleFsError(err, res, err.message);
	}
});

router.getFilteredDrives = getFilteredDrives;
router._resetDrivesCacheForTesting = _resetDrivesCacheForTesting;
router._getCachedDrivesStateForTesting = _getCachedDrivesStateForTesting;
router.DRIVES_CACHE_TTL_MS = DRIVES_CACHE_TTL_MS;

module.exports = router;
