const path = require("path");
const fsSync = require("fs");
const { BASE_DIR } = require("./config");
const { isSystemRootAllowed, getPreferences } = require("./services/preferences");

const VIRTUAL_FS_PREFIXES = ["/proc", "/sys", "/dev"];
const DEFAULT_STORAGE_ROOTS = ["/mnt", "/media", "/run/media", "/srv"];

function isVirtualFs(resolved) {
	if (!resolved) return false;
	const norm = path.normalize(resolved);
	return VIRTUAL_FS_PREFIXES.some(
		(prefix) => norm === prefix || norm.startsWith(prefix + path.sep),
	);
}

function resolveUnderBase(userPath) {
	const p = String(userPath || "");
	return path.isAbsolute(p) ? path.resolve(p) : path.resolve(BASE_DIR, p);
}

function canonicalize(resolved) {
	try {
		return fsSync.realpathSync(resolved);
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
		const suffixes = [];
		let current = resolved;
		while (current !== path.dirname(current)) {
			suffixes.unshift(path.basename(current));
			current = path.dirname(current);
			try {
				return path.join(fsSync.realpathSync(current), ...suffixes);
			} catch (err2) {
				if (err2.code !== "ENOENT") throw err2;
			}
		}
		return resolved;
	}
}

/**
 * Checks whether a resolved path falls within the allowed storage scope.
 * - Under Safe Server Mode (default): permits $HOME, mounted drives (/mnt, /media, /srv), and custom storage paths.
 * - Under Full System Root Mode: permits any path across the filesystem except virtual pseudo-filesystems (/proc, /sys, /dev).
 *
 * @param {string} resolved
 * @param {object} [options]
 * @param {boolean} [options.allowSystemRoot]
 * @returns {boolean}
 */
function isInsideAllowedScope(resolved, options = {}) {
	let canon;
	try {
		canon = canonicalize(resolved);
	} catch {
		return false;
	}

	// Always block virtual kernel filesystems across all modes to prevent process hangs
	if (isVirtualFs(canon)) {
		return false;
	}

	const systemRootAllowed =
		options.allowSystemRoot !== undefined
			? Boolean(options.allowSystemRoot)
			: isSystemRootAllowed();

	if (systemRootAllowed) {
		return true;
	}

	// 1. User Home Directory (BASE_DIR)
	if (canon === BASE_DIR || canon.startsWith(BASE_DIR + path.sep)) {
		return true;
	}

	// 2. Mounted Storage Drives & Server Pools (/mnt, /media, /run/media, /srv)
	for (const root of DEFAULT_STORAGE_ROOTS) {
		if (canon === root || canon.startsWith(root + path.sep)) {
			return true;
		}
	}

	// 3. User configured storage paths from preferences
	try {
		const prefs = getPreferences();
		if (Array.isArray(prefs.customStoragePaths)) {
			for (const custom of prefs.customStoragePaths) {
				const cleanCustom = path.resolve(custom);
				if (canon === cleanCustom || canon.startsWith(cleanCustom + path.sep)) {
					return true;
				}
			}
		}
	} catch (_) {}

	return false;
}

/**
 * Backward compatibility alias for isInsideAllowedScope
 */
function isInsideBase(resolved, options = {}) {
	return isInsideAllowedScope(resolved, options);
}

function jailPath(userPath, options = {}) {
	const resolved = resolveUnderBase(userPath);
	if (!isInsideAllowedScope(resolved, options)) return null;
	try {
		return canonicalize(resolved);
	} catch {
		return null;
	}
}

module.exports = {
	BASE_DIR,
	resolveUnderBase,
	canonicalize,
	isInsideBase,
	isInsideAllowedScope,
	isVirtualFs,
	jailPath,
	DEFAULT_STORAGE_ROOTS,
	VIRTUAL_FS_PREFIXES,
};
