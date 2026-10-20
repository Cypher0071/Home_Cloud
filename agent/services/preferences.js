const fs = require("fs");
const path = require("path");
const os = require("os");

const PREFERENCES_DIR = path.join(os.homedir(), ".config", "home-cloud");
const PREFERENCES_FILE = path.join(PREFERENCES_DIR, "preferences.json");

const DEFAULT_PREFERENCES = {
	allowSystemRoot: false,
	customStoragePaths: [],
	sessionEpoch: 1,
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
			const epochNum = Number(parsed.sessionEpoch);
			const sessionEpoch =
				Number.isInteger(epochNum) && epochNum >= 1
					? epochNum
					: DEFAULT_PREFERENCES.sessionEpoch;
			inMemoryPreferences = {
				...DEFAULT_PREFERENCES,
				...parsed,
				sessionEpoch,
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

	ensurePreferencesDir();
	const tmpFile = `${PREFERENCES_FILE}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
	fs.writeFileSync(tmpFile, JSON.stringify(updated, null, 2), "utf8");
	fs.renameSync(tmpFile, PREFERENCES_FILE);

	inMemoryPreferences = updated;
	return { ...updated };
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
	PREFERENCES_FILE,
	PREFERENCES_DIR,
	_resetForTesting,
};
