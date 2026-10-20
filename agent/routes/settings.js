const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const { constantTimeCompare } = require("./auth");
const {
	getPreferences,
	updatePreferences,
	isSystemRootAllowed,
	incrementSessionEpoch,
	getSessionEpoch,
} = require("../services/preferences");
const { BASE_DIR, DEFAULT_STORAGE_ROOTS } = require("../paths");

/**
 * Safely and atomically updates the PASSWORD in the .env file.
 * Creates .env from .env.example or defaults if .env does not exist.
 */
function updateEnvPassword(envPath, newPassword) {
	let content = "";
	if (fs.existsSync(envPath)) {
		content = fs.readFileSync(envPath, "utf8");
		if (/^PASSWORD=/m.test(content)) {
			content = content.replace(/^PASSWORD=.*$/m, () => `PASSWORD=${newPassword}`);
		} else {
			content += `\nPASSWORD=${newPassword}\n`;
		}
	} else {
		const examplePath = path.resolve(__dirname, "../.env.example");
		const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
		if (fs.existsSync(examplePath)) {
			content = fs.readFileSync(examplePath, "utf8");
			if (/^PASSWORD=/m.test(content)) {
				content = content.replace(/^PASSWORD=.*$/m, () => `PASSWORD=${newPassword}`);
			} else {
				content += `\nPASSWORD=${newPassword}\n`;
			}
			if (/^JWT_SECRET=/m.test(content)) {
				content = content.replace(/^JWT_SECRET=.*$/m, () => `JWT_SECRET=${jwtSecret}`);
			} else {
				content += `\nJWT_SECRET=${jwtSecret}\n`;
			}
		} else {
			content = `PASSWORD=${newPassword}\nJWT_SECRET=${jwtSecret}\n`;
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
		if (trimmedNewPassword.length < 8) {
			return res.status(400).json({ error: "New password must be at least 8 characters long" });
		}

		if (trimmedNewPassword === (process.env.PASSWORD || "")) {
			return res.status(400).json({ error: "New password must be different from current password" });
		}

		const envPath = path.resolve(__dirname, "../.env");
		updateEnvPassword(envPath, trimmedNewPassword);

		process.env.PASSWORD = trimmedNewPassword;
		const newEpoch = incrementSessionEpoch();
		res.clearCookie("token");

		return res.json({
			success: true,
			message: "Password updated successfully. All sessions revoked.",
			sessionEpoch: newEpoch,
		});
	} catch (err) {
		return res.status(500).json({ error: err.message || "Failed to update password" });
	}
});

router.updateEnvPassword = updateEnvPassword;

module.exports = router;
