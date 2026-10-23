const fs = require("fs");
const path = require("path");
const os = require("os");

function getPreferencesDir() {
	return (
		process.env.HOME_CLOUD_CONFIG_DIR ||
		(process.env.XDG_CONFIG_HOME
			? path.join(process.env.XDG_CONFIG_HOME, "home-cloud")
			: path.join(os.homedir(), ".config", "home-cloud"))
	);
}

function getPreferencesFile() {
	return (
		process.env.HOME_CLOUD_PREFERENCES_FILE ||
		path.join(getPreferencesDir(), "preferences.json")
	);
}

function getWallpaperFilePrefix() {
	return path.join(getPreferencesDir(), "wallpaper");
}

const SUPPORTED_WALLPAPER_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

const DEFAULT_PREFERENCES = {
	allowSystemRoot: false,
	customStoragePaths: [],
	sessionEpoch: 1,
	personalization: {
		presetId: "macos-sonoma",
		fit: "cover",
		hasCustomWallpaper: false,
		customWallpaperExt: null,
	},
};

let inMemoryPreferences = null;

function ensurePreferencesDir() {
	const dir = getPreferencesDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function getPreferences() {
	if (inMemoryPreferences !== null) {
		return {
			...inMemoryPreferences,
			personalization: {
				...DEFAULT_PREFERENCES.personalization,
				...(inMemoryPreferences.personalization || {}),
			},
			customStoragePaths: [...(inMemoryPreferences.customStoragePaths || [])],
		};
	}

	try {
		ensurePreferencesDir();
		const prefFile = getPreferencesFile();
		if (fs.existsSync(prefFile)) {
			const raw = fs.readFileSync(prefFile, "utf8");
			const parsed = JSON.parse(raw);
			const epochNum = Number(parsed.sessionEpoch);
			const sessionEpoch =
				Number.isInteger(epochNum) && epochNum >= 1
					? epochNum
					: DEFAULT_PREFERENCES.sessionEpoch;
			const personalization = {
				...DEFAULT_PREFERENCES.personalization,
				...(parsed.personalization && typeof parsed.personalization === "object"
					? parsed.personalization
					: {}),
			};
			inMemoryPreferences = {
				...DEFAULT_PREFERENCES,
				...parsed,
				sessionEpoch,
				personalization,
			};
		} else {
			inMemoryPreferences = {
				...DEFAULT_PREFERENCES,
				personalization: { ...DEFAULT_PREFERENCES.personalization },
				customStoragePaths: [...DEFAULT_PREFERENCES.customStoragePaths],
			};
			// Write default file
			fs.writeFileSync(prefFile, JSON.stringify(inMemoryPreferences, null, 2), "utf8");
		}
	} catch (err) {
		console.warn("[preferences] Notice: could not load preferences.json, using defaults:", err.message);
		inMemoryPreferences = {
			...DEFAULT_PREFERENCES,
			personalization: { ...DEFAULT_PREFERENCES.personalization },
			customStoragePaths: [...DEFAULT_PREFERENCES.customStoragePaths],
		};
	}

	// Environment variable override takes precedence if set
	if (process.env.ALLOW_SYSTEM_ROOT !== undefined) {
		inMemoryPreferences.allowSystemRoot = process.env.ALLOW_SYSTEM_ROOT === "true";
	}

	return {
		...inMemoryPreferences,
		personalization: {
			...DEFAULT_PREFERENCES.personalization,
			...(inMemoryPreferences.personalization || {}),
		},
		customStoragePaths: [...(inMemoryPreferences.customStoragePaths || [])],
	};
}

function updatePreferences(partial = {}, options = {}) {
	const current = getPreferences();
	const updated = {
		...current,
		...partial,
	};
	delete updated.allowWallpaperExt;

	if (typeof partial.allowSystemRoot === "boolean") {
		updated.allowSystemRoot = partial.allowSystemRoot;
	}

	if (Array.isArray(partial.customStoragePaths)) {
		updated.customStoragePaths = partial.customStoragePaths.map(String).filter(Boolean);
	}

	if (partial.sessionEpoch !== undefined) {
		const parsedEpoch = Number(partial.sessionEpoch);
		if (Number.isInteger(parsedEpoch) && parsedEpoch >= 1) {
			updated.sessionEpoch = parsedEpoch;
		} else {
			updated.sessionEpoch = current.sessionEpoch ?? DEFAULT_PREFERENCES.sessionEpoch;
		}
	} else if (!Number.isInteger(Number(updated.sessionEpoch)) || Number(updated.sessionEpoch) < 1) {
		updated.sessionEpoch = current.sessionEpoch ?? DEFAULT_PREFERENCES.sessionEpoch;
	}

	if (partial.personalization && typeof partial.personalization === "object") {
		const incoming = { ...partial.personalization };
		if (!options.allowWallpaperExt) {
			delete incoming.customWallpaperExt;
		}
		updated.personalization = {
			...(current.personalization || DEFAULT_PREFERENCES.personalization),
			...incoming,
		};
	} else {
		updated.personalization = {
			...(current.personalization || DEFAULT_PREFERENCES.personalization),
		};
	}

	ensurePreferencesDir();
	const prefFile = getPreferencesFile();
	const tmpFile = `${prefFile}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
	fs.writeFileSync(tmpFile, JSON.stringify(updated, null, 2), "utf8");
	fs.renameSync(tmpFile, prefFile);

	inMemoryPreferences = updated;
	return {
		...updated,
		personalization: { ...updated.personalization },
		customStoragePaths: [...(updated.customStoragePaths || [])],
	};
}

function isSystemRootAllowed() {
	return Boolean(getPreferences().allowSystemRoot);
}

function getSessionEpoch() {
	const prefs = getPreferences();
	const epoch = Number(prefs.sessionEpoch);
	if (Number.isInteger(epoch) && epoch >= 1) {
		return epoch;
	}
	return DEFAULT_PREFERENCES.sessionEpoch;
}

function incrementSessionEpoch() {
	const currentEpoch = getSessionEpoch();
	const newEpoch = currentEpoch + 1;
	updatePreferences({ sessionEpoch: newEpoch });
	return newEpoch;
}

function wallpaperPathForExt(ext) {
	if (!SUPPORTED_WALLPAPER_EXTENSIONS.includes(ext)) return null;
	const dir = path.resolve(getPreferencesDir());
	const full = path.resolve(dir, `wallpaper${ext}`);
	if (full !== path.join(dir, `wallpaper${ext}`)) return null;
	if (full !== dir && !full.startsWith(dir + path.sep)) return null;
	return full;
}

function getWallpaperPath() {
	ensurePreferencesDir();

	const prefs = getPreferences();
	const rawExt = prefs.personalization && prefs.personalization.customWallpaperExt;
	if (typeof rawExt === "string" && rawExt) {
		const ext = (rawExt.startsWith(".") ? rawExt : `.${rawExt}`).toLowerCase();
		const specificPath = wallpaperPathForExt(ext);
		if (specificPath && fs.existsSync(specificPath) && fs.statSync(specificPath).isFile()) {
			return specificPath;
		}
	}

	for (const ext of SUPPORTED_WALLPAPER_EXTENSIONS) {
		const candidate = wallpaperPathForExt(ext);
		if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
			return candidate;
		}
	}

	return null;
}

function removeCustomWallpaperFiles() {
	ensurePreferencesDir();
	try {
		const dir = getPreferencesDir();
		if (fs.existsSync(dir)) {
			const files = fs.readdirSync(dir);
			for (const file of files) {
				if (file.startsWith("wallpaper.")) {
					const full = path.join(dir, file);
					try {
						if (fs.statSync(full).isFile()) {
							fs.unlinkSync(full);
						}
					} catch (_) {}
				}
			}
		}
	} catch (_) {}
}

function _resetForTesting(customPrefs = null) {
	if (customPrefs) {
		const epochNum = Number(customPrefs.sessionEpoch);
		const sessionEpoch =
			Number.isInteger(epochNum) && epochNum >= 1
				? epochNum
				: (customPrefs.sessionEpoch !== undefined ? DEFAULT_PREFERENCES.sessionEpoch : DEFAULT_PREFERENCES.sessionEpoch);
		inMemoryPreferences = {
			...DEFAULT_PREFERENCES,
			...customPrefs,
			sessionEpoch,
			personalization: {
				...DEFAULT_PREFERENCES.personalization,
				...(customPrefs.personalization || {}),
			},
		};
	} else {
		inMemoryPreferences = null;
	}
}

module.exports = {
	getPreferences,
	updatePreferences,
	isSystemRootAllowed,
	getSessionEpoch,
	incrementSessionEpoch,
	get PREFERENCES_FILE() {
		return getPreferencesFile();
	},
	get PREFERENCES_DIR() {
		return getPreferencesDir();
	},
	DEFAULT_PREFERENCES,
	get WALLPAPER_FILE_PREFIX() {
		return getWallpaperFilePrefix();
	},
	SUPPORTED_WALLPAPER_EXTENSIONS,
	getWallpaperPath,
	removeCustomWallpaperFiles,
	_resetForTesting,
};
