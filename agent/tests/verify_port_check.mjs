import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const {
	BROWSER_UNSAFE_PORTS,
	exposedTcpPorts,
	readHostListeningPorts,
	getUsedHostPorts,
	validatePortMappings,
} = require("../services/portCheck.js");

console.log("--- Running Port Check Tests ---");

// exposedTcpPorts: only tcp, numeric, sorted
assert.deepEqual(exposedTcpPorts({ Config: { ExposedPorts: { "80/tcp": {}, "53/udp": {}, "443/tcp": {}, "8080": {} } } }), [80, 443, 8080]);
assert.deepEqual(exposedTcpPorts(null), []);
assert.deepEqual(exposedTcpPorts({ Config: {} }), []);
console.log("  ✔ reads the TCP ports an image declares");

// /proc/net/tcp parsing: only LISTEN (0A) sockets count
const procTcp = [
	"  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
	"   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 1 0",
	"   1: 0100007F:0CEA 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 2 1 0",
	"   2: 0100007F:D431 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1000        0 3 1 0",
].join("\n");
const procTcp6 = [
	"  sl  local_address                         remote_address                        st",
	"   0: 00000000000000000000000000000000:0016 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 4 1 0",
].join("\n");
const fakeRead = (file) => {
	if (file === "/proc/net/tcp") return procTcp;
	if (file === "/proc/net/tcp6") return procTcp6;
	throw new Error("ENOENT");
};
assert.deepEqual([...readHostListeningPorts(fakeRead)].sort((a, b) => a - b), [22, 3306, 8080]);
assert.equal(readHostListeningPorts(() => { throw new Error("no proc"); }).size, 0);
console.log("  ✔ finds listening host ports and ignores connections");

// getUsedHostPorts: running containers by name, stopped ones reserved but inactive, host listeners
const fakeDocker = {
	async listContainers() {
		return [
			{ Id: "aaa", Names: ["/excalidraw"], State: "running", Ports: [{ PrivatePort: 80, PublicPort: 8080, Type: "tcp" }] },
			{ Id: "bbb", Names: ["/old-app"], State: "exited", Ports: [] },
		];
	},
	getContainer(id) {
		return {
			async inspect() {
				if (id === "bbb") return { HostConfig: { PortBindings: { "80/tcp": [{ HostPort: "8090" }], "53/udp": [{ HostPort: "5353" }] } } };
				return {};
			},
		};
	},
};
const used = await getUsedHostPorts(fakeDocker, { readFile: fakeRead });
// 8080 is also in /proc (docker-proxy), but the container name is the useful owner.
assert.deepEqual(used.get(8080), { owner: 'container "excalidraw"', active: true });
assert.deepEqual(used.get(8090), { owner: 'stopped container "old-app"', active: false });
assert.equal(used.has(5353), false, "udp bindings are not tcp conflicts");
assert.deepEqual(used.get(3306), { owner: "a program on this machine", active: true });
console.log("  ✔ collects ports held by containers and host programs");

// validatePortMappings
{
	const ok = validatePortMappings([
		{ hostPort: "8091", containerPort: "80" },
		{ hostPort: "", containerPort: "" },
	], used);
	assert.deepEqual(ok, { mappings: [{ hostPort: 8091, containerPort: 80 }] });

	// Two containers on container port 80 are fine: the second one just needs another host port.
	assert.equal(validatePortMappings([{ hostPort: "8090", containerPort: "80" }], used).error, undefined,
		"a stopped container's reservation doesn't block");

	const taken = validatePortMappings([{ hostPort: "8080", containerPort: "80" }], used);
	assert.equal(taken.status, 409);
	assert.match(taken.error, /8080 is already used by container "excalidraw"/);

	assert.equal(validatePortMappings([{ hostPort: "70000", containerPort: "80" }]).status, 400);
	assert.equal(validatePortMappings([{ hostPort: "80a", containerPort: "80" }]).status, 400);
	assert.equal(validatePortMappings([{ hostPort: "8080", containerPort: "" }]).status, 400, "half-filled rows are errors");
	assert.match(validatePortMappings([{ hostPort: "9000", containerPort: "80" }, { hostPort: "9000", containerPort: "81" }]).error, /mapped twice/);
	assert.match(validatePortMappings([{ hostPort: "9000", containerPort: "80" }, { hostPort: "9001", containerPort: "80" }]).error, /mapped twice/);
	assert.equal(validatePortMappings("nope").status, 400);
	assert.deepEqual(validatePortMappings(undefined), { mappings: [] });
	console.log("  ✔ validates mappings and rejects taken host ports");
}

// The dashboard keeps its own copy of the unsafe port list; they must match.
{
	const ts = readFileSync(new URL("../../dashboard/src/utils/portChecks.ts", import.meta.url), "utf8");
	const block = ts.match(/BROWSER_UNSAFE_PORTS = new Set\(\[([\s\S]*?)\]\)/);
	assert.ok(block, "dashboard unsafe port list not found");
	const dashboardPorts = block[1].split(",").map((s) => Number(s.trim())).filter(Boolean);
	assert.deepEqual(dashboardPorts, [...BROWSER_UNSAFE_PORTS]);
	assert.ok(BROWSER_UNSAFE_PORTS.has(6666));
	console.log("  ✔ dashboard and agent agree on browser-blocked ports");
}

console.log("All port check tests passed.");
