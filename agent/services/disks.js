/**
 * Turns `df` output (systeminformation's fsSize) into the list of real disks a person cares about.
 *
 * Raw df on a Docker host lists one `overlay` mount per running container under
 * /var/lib/docker, each reporting the size of the disk it lives on, and bind mounts or btrfs
 * subvolumes repeat the same device at several paths. Shown as-is they look like extra disks and
 * multiply the total. Used by both the System Monitor metrics and the Files drive list.
 */
const path = require("path");

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

function isRealDisk(d) {
	if (!d || !d.mount || !(d.size > 0)) return false;
	const type = String(d.type || "").toLowerCase();
	// WSL2 mounts Windows drives as 9p with an "X:\" source; other 9p mounts are WSL internals.
	const windowsDrive = type === "9p" && /^[A-Za-z]:\\/.test(String(d.fs || ""));
	if (!REAL_FS_TYPES.has(type) && !windowsDrive) return false;
	// Container and WSLg internals
	if (d.mount.startsWith("/var/lib/docker/") || d.mount.includes("wslg")) return false;
	// Paths that look like files rather than directories (e.g. /mnt/wslg/versions.txt)
	if (/\.\w+$/.test(d.mount)) return false;
	return true;
}

function isUnder(child, parent) {
	const rel = path.relative(parent, child);
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Real disks, one entry per device (the shortest mount path wins, so "/" beats a bind mount of
 * the same device). With `preferPath`, the disk holding that path comes first.
 */
function filterRealDisks(drives, { preferPath } = {}) {
	const byDevice = new Map();
	for (const d of Array.isArray(drives) ? drives : []) {
		if (!isRealDisk(d)) continue;
		// Same source, type and size means the same filesystem seen at another path.
		const key = `${d.fs}|${d.type}|${d.size}`;
		const existing = byDevice.get(key);
		if (!existing || d.mount.length < existing.mount.length) byDevice.set(key, d);
	}
	const disks = [...byDevice.values()];
	if (preferPath) {
		// The deepest mount containing the path is the disk the path is actually on.
		let best = null;
		for (const d of disks) {
			if (isUnder(preferPath, d.mount) && (!best || d.mount.length > best.mount.length)) best = d;
		}
		if (best) {
			disks.splice(disks.indexOf(best), 1);
			disks.unshift(best);
		}
	}
	return disks;
}

module.exports = { REAL_FS_TYPES, isRealDisk, filterRealDisks };
