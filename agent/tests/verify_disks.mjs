import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { filterRealDisks } = require("../services/disks.js");

console.log("--- Running Disk Filter Tests ---");
const GB = 1e9;
// What df reports on a Docker host with two running containers and a bind mount.
const raw = [
	{ fs: "/dev/nvme0n1p2", type: "ext4", mount: "/", size: 100 * GB, used: 40 * GB, available: 55 * GB, use: 42.1 },
	{ fs: "/dev/nvme0n1p1", type: "vfat", mount: "/boot/efi", size: 0.5 * GB, used: 0.01 * GB, available: 0.49 * GB, use: 2 },
	{ fs: "overlay", type: "overlay", mount: "/var/lib/docker/overlay2/aaa/merged", size: 100 * GB, used: 40 * GB, available: 55 * GB, use: 42.1 },
	{ fs: "overlay", type: "overlay", mount: "/var/lib/docker/overlay2/bbb/merged", size: 100 * GB, used: 40 * GB, available: 55 * GB, use: 42.1 },
	{ fs: "/dev/nvme0n1p2", type: "ext4", mount: "/srv/shared", size: 100 * GB, used: 40 * GB, available: 55 * GB, use: 42.1 },
	{ fs: "/dev/sdb1", type: "ext4", mount: "/mnt/media", size: 2000 * GB, used: 900 * GB, available: 1000 * GB, use: 47.4 },
	{ fs: "tmpfs", type: "tmpfs", mount: "/run", size: 1 * GB, used: 0, available: 1 * GB, use: 0 },
	{ fs: "/dev/loop3", type: "squashfs", mount: "/snap/core/1", size: 0.1 * GB, used: 0.1 * GB, available: 0, use: 100 },
];

const disks = filterRealDisks(raw);
assert.deepEqual(disks.map((d) => d.mount), ["/", "/boot/efi", "/mnt/media"]);
const total = disks.reduce((a, d) => a + d.size, 0);
assert.equal(total, 2100.5 * GB, "the root disk is counted once, not once per container");
console.log("  ✔ drops Docker overlays, bind-mount duplicates and virtual filesystems");

assert.equal(filterRealDisks(raw, { preferPath: "/mnt/media/photos" })[0].mount, "/mnt/media");
assert.equal(filterRealDisks(raw, { preferPath: "/home/cypher" })[0].mount, "/");
console.log("  ✔ puts the disk holding the storage folder first");

// WSL2: Windows drives are 9p with an X:\ source; WSL's own 9p and overlay mounts are not disks.
const wsl = filterRealDisks([
	{ fs: "/dev/sdd", type: "ext4", mount: "/", size: 1081 * GB },
	{ fs: "C:\\", type: "9p", mount: "/mnt/c", size: 511 * GB },
	{ fs: "drivers", type: "9p", mount: "/usr/lib/wsl/drivers", size: 511 * GB },
	{ fs: "none", type: "overlay", mount: "/mnt/wslg/doc", size: 6 * GB },
]);
assert.deepEqual(wsl.map((d) => d.mount), ["/", "/mnt/c"]);
assert.deepEqual(filterRealDisks(null), []);
console.log("  ✔ handles WSL drives and bad input");
console.log("All disk filter tests passed.");
