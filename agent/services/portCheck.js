/**
 * Port checks for creating containers.
 *
 * Every container has its own network, so two containers can both listen on port 80 inside.
 * Only the HOST side of a mapping has to be unique, so that is what is checked here.
 */
const fs = require("fs");

// Ports Chrome and Firefox refuse to open (ERR_UNSAFE_PORT). A web UI published on one of these
// can't be opened in a browser over the LAN. Keep in sync with dashboard/src/utils/portChecks.ts.
const BROWSER_UNSAFE_PORTS = new Set([
	1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
	103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
	512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
	995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
	6669, 6679, 6697, 10080,
]);

function parsePort(value) {
	const s = String(value ?? "").trim();
	if (!/^\d{1,5}$/.test(s)) return null;
	const n = Number(s);
	return n >= 1 && n <= 65535 ? n : null;
}

/** TCP ports the image declares in its Dockerfile (EXPOSE), sorted. */
function exposedTcpPorts(imageInfo) {
	const exposed = imageInfo?.Config?.ExposedPorts || {};
	return Object.keys(exposed)
		.map((key) => key.split("/"))
		.filter(([, proto]) => !proto || proto === "tcp")
		.map(([port]) => parsePort(port))
		.filter((p) => p !== null)
		.sort((a, b) => a - b);
}

/** Ports with a TCP socket in LISTEN state on the host, from /proc/net/tcp{,6}. */
function readHostListeningPorts(readFile = (p) => fs.readFileSync(p, "utf8")) {
	const ports = new Set();
	for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
		let text;
		try {
			text = readFile(file);
		} catch {
			continue;
		}
		for (const line of text.split("\n").slice(1)) {
			const cols = line.trim().split(/\s+/);
			// cols[1] = local "ADDR:PORT" (hex), cols[3] = state, 0A = LISTEN
			if (cols.length < 4 || cols[3] !== "0A") continue;
			const port = parseInt(cols[1].split(":").pop(), 16);
			if (port > 0) ports.add(port);
		}
	}
	return ports;
}

function containerName(c) {
	return (c.Names?.[0] || c.Id?.slice(0, 12) || "a container").replace(/^\//, "");
}

/**
 * Host ports that are already taken: Map<port, { owner, active }>.
 * `active: false` means a stopped container has it reserved; creating a new container on it
 * works, but the stopped one then can't start again.
 */
async function getUsedHostPorts(docker, { readFile } = {}) {
	const used = new Map();
	const containers = await docker.listContainers({ all: true });
	for (const c of containers) {
		const name = containerName(c);
		if (c.State === "running") {
			for (const p of c.Ports || []) {
				if (p.PublicPort && p.Type !== "udp") used.set(p.PublicPort, { owner: `container "${name}"`, active: true });
			}
			continue;
		}
		// Stopped containers don't list their ports; their bindings are in the config.
		const info = await docker.getContainer(c.Id).inspect().catch(() => null);
		for (const [key, bindings] of Object.entries(info?.HostConfig?.PortBindings || {})) {
			if (key.endsWith("/udp")) continue;
			for (const b of bindings || []) {
				const port = parsePort(b?.HostPort);
				if (port && !used.has(port)) used.set(port, { owner: `stopped container "${name}"`, active: false });
			}
		}
	}
	for (const port of readHostListeningPorts(readFile)) {
		const existing = used.get(port);
		if (!existing || !existing.active) used.set(port, { owner: "a program on this machine", active: true });
	}
	return used;
}

/**
 * Validates the `ports` array of a create request. Returns { mappings, error, status }.
 * Rows with both fields empty are ignored; anything else must be a complete, valid mapping.
 */
function validatePortMappings(ports, used = new Map()) {
	if (ports === undefined || ports === null) return { mappings: [] };
	if (!Array.isArray(ports)) return { error: "ports must be a list", status: 400 };
	const mappings = [];
	const hostSeen = new Set();
	const containerSeen = new Set();
	for (const row of ports) {
		const rawHost = String(row?.hostPort ?? "").trim();
		const rawContainer = String(row?.containerPort ?? "").trim();
		if (!rawHost && !rawContainer) continue;
		const hostPort = parsePort(rawHost);
		const containerPort = parsePort(rawContainer);
		if (!hostPort) return { error: `Host port "${rawHost}" must be a number from 1 to 65535`, status: 400 };
		if (!containerPort) return { error: `Container port "${rawContainer}" must be a number from 1 to 65535`, status: 400 };
		if (hostSeen.has(hostPort)) return { error: `Host port ${hostPort} is mapped twice`, status: 400 };
		if (containerSeen.has(containerPort)) return { error: `Container port ${containerPort} is mapped twice`, status: 400 };
		const taken = used.get(hostPort);
		if (taken?.active) return { error: `Host port ${hostPort} is already used by ${taken.owner}`, status: 409 };
		hostSeen.add(hostPort);
		containerSeen.add(containerPort);
		mappings.push({ hostPort, containerPort });
	}
	return { mappings };
}

module.exports = {
	BROWSER_UNSAFE_PORTS,
	parsePort,
	exposedTcpPorts,
	readHostListeningPorts,
	getUsedHostPorts,
	validatePortMappings,
};
