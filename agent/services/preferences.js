const fs = require("fs");
const path = require("path");
const os = require("os");

const PREFERENCES_DIR = path.join(os.homedir(), ".config", "home-cloud");
const PREFERENCES_FILE = path.join(PREFERENCES_DIR, "preferences.json");

const DEFAULT_PREFERENCES = {
	allowSystemRoot: false,
	customStoragePaths: [],
};

let inMemoryPreferences = null;

function ensurePreferencesDir() {
	if (!fs.existsSync(PREFERENCES_DIR)) {
		fs.mkdirSync(PREFERENCES_DIR, { recursive: true });
	}
}

function getPreferences() {
	if (inMemoryPreferences !== null) {
		return { ...inMemoryPreferences };
	}

	try {
		ensurePreferencesDir();
		if (fs.existsSync(PREFERENCES_FILE)) {
			const raw = fs.readFileSync(PREFERENCES_FILE, "utf8");
			const parsed = JSON.parse(raw);
			inMemoryPreferences = {
				...DEFAULT_PREFERENCES,
				...parsed,
			};
		} else {
			inMemoryPreferences = { ...DEFAULT_PREFERENCES };
			// Write default file
			fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(inMemoryPreferences, null, 2), "utf8");
		}
	} catch (err) {
		console.warn("[preferences] Notice: could not load preferences.json, using defaults:", err.message);
		inMemoryPreferences = { ...DEFAULT_PREFERENCES };
	}

	// Environment variable override takes precedence if set
	if (process.env.ALLOW_SYSTEM_ROOT !== undefined) {
		inMemoryPreferences.allowSystemRoot = process.env.ALLOW_SYSTEM_ROOT === "true";
	}

	return { ...inMemoryPreferences };
}

function updatePreferences(partial = {}) {
	const current = getPreferences();
	const updated = {
		...current,
		...partial,
	};

	if (typeof partial.allowSystemRoot === "boolean") {
		updated.allowSystemRoot = partial.allowSystemRoot;
	}

	if (Array.isArray(partial.customStoragePaths)) {
		updated.customStoragePaths = partial.customStoragePaths.map(String);
	}

	ensurePreferencesDir();
	const tmpFile = `${PREFERENCES_FILE}.${Date.now()}.tmp`;
	fs.writeFileSync(tmpFile, JSON.stringify(updated, null, 2), "utf8");
	fs.renameSync(tmpFile, PREFERENCES_FILE);

	inMemoryPreferences = updated;
	return { ...updated };
}

function isSystemRootAllowed() {
	return Boolean(getPreferences().allowSystemRoot);
}

function _resetForTesting(customPrefs = null) {
	inMemoryPreferences = customPrefs ? { ...customPrefs } : null;
}

module.exports = {
	getPreferences,
	updatePreferences,
	isSystemRootAllowed,
	PREFERENCES_FILE,
	PREFERENCES_DIR,
	_resetForTesting,
};
