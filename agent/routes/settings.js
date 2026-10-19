const express = require("express");
const router = express.Router();
const {
	getPreferences,
	updatePreferences,
	isSystemRootAllowed,
} = require("../services/preferences");
const { BASE_DIR, DEFAULT_STORAGE_ROOTS } = require("../paths");

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

module.exports = router;
