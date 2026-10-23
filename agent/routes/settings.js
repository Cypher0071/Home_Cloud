const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const multer = require("multer");
const mime = require("mime-types");
const dotenv = require("dotenv");
const { constantTimeCompare, clearAuthCookie } = require("./auth");
const preferences = require("../services/preferences");
const {
	getPreferences,
	updatePreferences,
	isSystemRootAllowed,
	incrementSessionEpoch,
	getSessionEpoch,
	getWallpaperPath,
	removeCustomWallpaperFiles,
} = preferences;
const { BASE_DIR, DEFAULT_STORAGE_ROOTS } = require("../paths");
const {
	getUpdateStatus,
	checkForUpdates,
	applyUpdate,
	assertReleaseTag,
	getLastProgress,
	isUpdating,
	updateEmitter,
} = require("../services/updateManager");

const MIME_TO_EXT = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
};

const ALLOWED_MIME_TYPES = Object.keys(MIME_TO_EXT);

const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 15 * 1024 * 1024, // 15MB
	},
	fileFilter: (req, file, cb) => {
		if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
			cb(null, true);
		} else {
			const err = new Error("Invalid file type. Only JPEG, PNG, WEBP, and GIF images are allowed.");
			err.status = 400;
			cb(err);
		}
	},
});

function encodeEnvValue(value) {
	return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Safely and atomically updates the PASSWORD in the .env file.
 * Creates .env from .env.example or defaults if .env does not exist.
 * The new value is quoted and must round-trip through dotenv without changing other keys.
 */
function updateEnvPassword(envPath, newPassword) {
	if (typeof newPassword !== "string" || /[\r\n\0]/.test(newPassword)) {
		throw new Error("Password contains unsupported control characters");
	}

	let original = "";
	if (fs.existsSync(envPath)) {
		original = fs.readFileSync(envPath, "utf8");
	} else {
		const examplePath = path.resolve(__dirname, "../.env.example");
		const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
		if (fs.existsSync(examplePath)) {
			original = fs.readFileSync(examplePath, "utf8");
		} else {
			original = `JWT_SECRET=${encodeEnvValue(jwtSecret)}\n`;
		}
		if (!/^JWT_SECRET=/m.test(original)) {
			original += `\nJWT_SECRET=${encodeEnvValue(jwtSecret)}\n`;
		} else if (PLACEHOLDER_JWT.test(original)) {
			original = original.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${encodeEnvValue(jwtSecret)}`);
		}
	}

	const before = dotenv.parse(original);
	const encoded = encodeEnvValue(newPassword);
	let content;
	if (/^PASSWORD=/m.test(original)) {
		content = original.replace(/^PASSWORD=.*$/m, () => `PASSWORD=${encoded}`);
	} else {
		content = `${original.replace(/\s*$/, "")}\nPASSWORD=${encoded}\n`;
	}

	const after = dotenv.parse(content);
	if (after.PASSWORD !== newPassword) {
		throw new Error("Refusing to write .env because PASSWORD did not round-trip");
	}
	for (const key of Object.keys(before)) {
		if (key === "PASSWORD") continue;
		if (after[key] !== before[key]) {
			throw new Error(`Refusing to write .env because ${key} would change`);
		}
	}

	const dir = path.dirname(envPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const tmpFile = `${envPath}.${Date.now()}.tmp`;
	fs.writeFileSync(tmpFile, content, { mode: 0o600 });
	try {
		fs.chmodSync(tmpFile, 0o600);
	} catch (_) {}
	fs.renameSync(tmpFile, envPath);
}

const PLACEHOLDER_JWT = /^JWT_SECRET=(?:"generate-a-long-random-string"|generate-a-long-random-string)\s*$/m;

// GET /api/settings/preferences
router.get("/preferences", (req, res) => {
	try {
		const prefs = getPreferences();
		res.json({
			status: "ok",
			preferences: prefs,
		});
	} catch (err) {
		res.status(500).json({ error: err.message || "Failed to load preferences" });
	}
});

// PUT /api/settings/preferences
router.put("/preferences", (req, res) => {
	try {
		const { personalization, allowSystemRoot, customStoragePaths } = req.body || {};
		const update = {};

		if (typeof allowSystemRoot === "boolean") {
			update.allowSystemRoot = allowSystemRoot;
		}

		if (Array.isArray(customStoragePaths)) {
			update.customStoragePaths = customStoragePaths.map(String).filter(Boolean);
		}

		if (personalization && typeof personalization === "object" && !Array.isArray(personalization)) {
			update.personalization = personalization;
		}

		const updated = updatePreferences(update);
		res.json({
			status: "ok",
			preferences: updated,
		});
	} catch (err) {
		res.status(500).json({ error: err.message || "Failed to update preferences" });
	}
});

// POST /api/settings/wallpaper
router.post("/wallpaper", (req, res) => {
	upload.single("file")(req, res, (err) => {
		if (err) {
			if (err.code === "LIMIT_FILE_SIZE") {
				return res.status(400).json({ error: "File too large. Maximum size is 15MB." });
			}
			return res.status(400).json({ error: err.message || "Failed to upload wallpaper" });
		}

		try {
			if (!req.file) {
				return res.status(400).json({ error: "No image file provided" });
			}

			const ext = MIME_TO_EXT[req.file.mimetype];
			if (!ext) {
				return res.status(400).json({ error: "Invalid image format. Allowed formats: JPEG, PNG, WEBP, GIF." });
			}

			const prefDir = preferences.PREFERENCES_DIR;
			if (!fs.existsSync(prefDir)) {
				fs.mkdirSync(prefDir, { recursive: true });
			}

			// Remove any previous custom wallpaper files first
			removeCustomWallpaperFiles();

			// Save the uploaded wallpaper file
			const targetFilename = `wallpaper.${ext}`;
			const targetPath = path.join(prefDir, targetFilename);
			fs.writeFileSync(targetPath, req.file.buffer);

			// Update preferences
			const currentPrefs = getPreferences();
			updatePreferences({
				personalization: {
					...(currentPrefs.personalization || {}),
					hasCustomWallpaper: true,
					customWallpaperExt: ext,
				},
			}, { allowWallpaperExt: true });

			return res.json({
				success: true,
				url: `/api/settings/wallpaper?t=${Date.now()}`,
			});
		} catch (saveErr) {
			return res.status(500).json({ error: saveErr.message || "Failed to save wallpaper" });
		}
	});
});

// GET /api/settings/wallpaper
router.get("/wallpaper", (req, res) => {
	try {
		const wallpaperPath = getWallpaperPath();
		if (!wallpaperPath || !fs.existsSync(wallpaperPath)) {
			return res.status(404).json({ error: "Custom wallpaper not found" });
		}

		const stat = fs.statSync(wallpaperPath);
		const contentType = mime.lookup(wallpaperPath) || "image/jpeg";

		res.setHeader("Content-Type", contentType);
		res.setHeader("Content-Length", stat.size);
		res.setHeader("Cache-Control", "private, max-age=86400");
		res.setHeader("X-Content-Type-Options", "nosniff");

		const stream = fs.createReadStream(wallpaperPath);
		stream.on("error", (err) => {
			if (!res.headersSent) {
				res.status(500).json({ error: "Failed to read wallpaper file" });
			}
		});
		stream.pipe(res);
	} catch (err) {
		if (!res.headersSent) {
			res.status(500).json({ error: err.message || "Failed to retrieve wallpaper" });
		}
	}
});

// DELETE /api/settings/wallpaper
router.delete("/wallpaper", (req, res) => {
	try {
		removeCustomWallpaperFiles();

		const currentPrefs = getPreferences();
		updatePreferences({
			personalization: {
				...(currentPrefs.personalization || {}),
				hasCustomWallpaper: false,
				customWallpaperExt: null,
			},
		}, { allowWallpaperExt: true });

		return res.json({ success: true });
	} catch (err) {
		return res.status(500).json({ error: err.message || "Failed to remove wallpaper" });
	}
});

// GET /api/settings/storage
router.get("/storage", (req, res) => {
	try {
		const prefs = getPreferences();
		res.json({
			status: "ok",
			allowSystemRoot: prefs.allowSystemRoot,
			baseDir: BASE_DIR,
			defaultStorageRoots: DEFAULT_STORAGE_ROOTS,
			customStoragePaths: prefs.customStoragePaths || [],
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// PUT /api/settings/storage
router.put("/storage", (req, res) => {
	try {
		const { allowSystemRoot, customStoragePaths } = req.body || {};
		const update = {};

		if (typeof allowSystemRoot === "boolean") {
			update.allowSystemRoot = allowSystemRoot;
		}

		if (Array.isArray(customStoragePaths)) {
			update.customStoragePaths = customStoragePaths.map(String).filter(Boolean);
		}

		const updated = updatePreferences(update);
		res.json({
			status: "ok",
			success: true,
			allowSystemRoot: updated.allowSystemRoot,
			customStoragePaths: updated.customStoragePaths,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// POST /api/settings/password
router.post("/password", (req, res) => {
	try {
		const { currentPassword, newPassword } = req.body || {};

		if (
			!currentPassword ||
			!newPassword ||
			typeof currentPassword !== "string" ||
			typeof newPassword !== "string"
		) {
			return res.status(400).json({ error: "Current password and new password are required" });
		}

		if (!constantTimeCompare(process.env.PASSWORD || "", currentPassword)) {
			return res.status(401).json({ error: "Incorrect current password" });
		}

		const trimmedNewPassword = newPassword.trim();
		if (/[\r\n\0]/.test(newPassword) || /[\r\n\0]/.test(trimmedNewPassword)) {
			return res.status(400).json({ error: "Password contains unsupported control characters" });
		}
		if (trimmedNewPassword.length < 8) {
			return res.status(400).json({ error: "New password must be at least 8 characters long" });
		}

		if (trimmedNewPassword === (process.env.PASSWORD || "")) {
			return res.status(400).json({ error: "New password must be different from current password" });
		}

		const envPath = process.env.AGENT_ENV_FILE || path.resolve(__dirname, "../.env");
		updateEnvPassword(envPath, trimmedNewPassword);

		process.env.PASSWORD = trimmedNewPassword;
		const newEpoch = incrementSessionEpoch();
		clearAuthCookie(res, req);

		return res.json({
			success: true,
			message: "Password updated successfully. All sessions revoked.",
			sessionEpoch: newEpoch,
		});
	} catch (err) {
		return res.status(500).json({ error: err.message || "Failed to update password" });
	}
});

// ==========================================
// Auto-Update Engine Endpoints
// ==========================================

// GET /api/settings/update/status
router.get("/update/status", (req, res) => {
	try {
		const status = getUpdateStatus();
		res.json({
			status: "ok",
			...status,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// POST /api/settings/update/check
router.post("/update/check", async (req, res) => {
	try {
		const result = await checkForUpdates({ force: true });
		res.json({
			status: "ok",
			...result,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// POST /api/settings/update/apply
router.post("/update/apply", (req, res) => {
	try {
		if (isUpdating()) {
			return res.status(409).json({ error: "Update already in progress" });
		}

		const { targetTag } = req.body || {};
		if (targetTag !== undefined && targetTag !== null && targetTag !== "") {
			assertReleaseTag(targetTag);
		}

		// Trigger update asynchronously
		applyUpdate(null, { targetTag }).catch((err) => {
			console.error("[settings/update] Asynchronous update error:", err.message);
		});

		res.status(202).json({
			status: "ok",
			message: "Update initiated successfully",
		});
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

// GET /api/settings/update/progress
router.get("/update/progress", (req, res) => {
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	if (typeof res.flushHeaders === "function") {
		res.flushHeaders();
	}

	// Immediately send current/cached progress state
	const initial = getLastProgress() || {
		stage: isUpdating() ? "updating" : "idle",
		message: isUpdating() ? "Update in progress" : "No update in progress",
		percent: isUpdating() ? 50 : 0,
		isUpdating: isUpdating(),
	};
	res.write(`data: ${JSON.stringify(initial)}\n\n`);

	const onProgress = (data) => {
		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};

	updateEmitter.on("progress", onProgress);

	req.on("close", () => {
		updateEmitter.off("progress", onProgress);
	});
});

router.updateEnvPassword = updateEnvPassword;

module.exports = router;
