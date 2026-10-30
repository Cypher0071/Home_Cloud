const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const yaml = require("js-yaml");
const { CF_CONFIG, CF_DOMAIN } = require("../config");
const { restartTunnel } = require("../tunnel");

const CONFIG_PATH = CF_CONFIG;

// ─── Reserved Subdomains & Validation ────────────────────────────────────────

const RESERVED_SUBDOMAINS = new Set([
	"dash",
	"ssh",
	"api",
	"admin",
	"administrator",
	"root",
	"localhost",
	"gateway",
	"mail",
	"smtp",
	"pop",
	"imap",
	"dns",
	"ns1",
	"ns2",
	"tunnel",
	"cloudflared",
	"cloudflare",
	"home-cloud",
	"homecloud",
]);

/**
 * Validates and normalizes a subdomain string according to RFC 1123 DNS standards.
 * Ensures the subdomain does not collide with reserved hostnames (e.g. "dash").
 *
 * @param {string} subdomain
 * @returns {string} Cleaned, lowercase subdomain
 */
function validateSubdomain(subdomain) {
	if (!subdomain || typeof subdomain !== "string") {
		throw new Error("Subdomain is required and must be a string");
	}

	const clean = subdomain.trim().toLowerCase();

	if (clean.length < 1 || clean.length > 63) {
		throw new Error("Subdomain must be between 1 and 63 characters long");
	}

	// RFC 1123 DNS hostname segment: lowercase alphanumeric characters and hyphens,
	// cannot start or end with a hyphen
	const dnsRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
	if (!dnsRegex.test(clean)) {
		throw new Error(
			"Invalid subdomain format. Must contain only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen.",
		);
	}

	if (RESERVED_SUBDOMAINS.has(clean)) {
		throw new Error(`Subdomain '${clean}' is reserved and cannot be used.`);
	}

	return clean;
}

// ─── Asynchronous Mutex / FIFO Execution Queue ──────────────────────────────

/**
 * AsyncMutex ensures that concurrent asynchronous operations on shared resources
 * (such as config.yaml and the cloudflared process) are strictly serialized in
 * First-In, First-Out (FIFO) order, completely preventing race conditions.
 */
class AsyncMutex {
	constructor() {
		this._queue = Promise.resolve();
	}

	/**
	 * Enqueues an async task to run strictly after all prior tasks in the queue have settled.
	 *
	 * @param {() => Promise<any> | any} task
	 * @returns {Promise<any>}
	 */
	runExclusive(task) {
		const next = this._queue.then(() => task());
		// Catch errors on the internal queue promise so a failure does not halt future tasks
		this._queue = next.catch(() => {});
		return next;
	}
}

const ingressMutex = new AsyncMutex();

// ─── Atomic YAML Writing & Validation ────────────────────────────────────────

/**
 * Validates that the cloudflared config is syntactically sound.
 * If cloudflared binary is available on the system, performs real dry-run validation.
 *
 * @param {string} filePath - Path to file to validate
 */
function validateWithCloudflared(filePath) {
	try {
		execFileSync("cloudflared", ["tunnel", "--config", filePath, "ingress", "validate"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 5000,
		});
		return true;
	} catch (err) {
		if (err.code === "ENOENT") {
			return false;
		}
		const detail = err.stderr || err.stdout || err.message;
		throw new Error(`Cloudflare ingress validation failed: ${detail.trim()}`);
	}
}

/**
 * Atomically writes the configuration to disk:
 * 1. Verifies YAML syntax via js-yaml round-trip.
 * 2. Writes to a temporary file in the same directory.
 * 3. Validates the temp file using cloudflared ingress validate (if available).
 * 4. Backs up the current config to config.yml.bak.
 * 5. Atomically replaces config.yml using fs.renameSync (atomic POSIX inode swap).
 *
 * @param {object} config - Ingress configuration object
 */
function assertCfDomain() {
	if (!CF_DOMAIN) {
		throw new Error("CF_DOMAIN is not set. Ingress autowiring is disabled.");
	}
}

function safeWriteYamlConfig(config) {
	assertCfDomain();
	// 1. Dump to YAML string
	const newYaml = yaml.dump(config, { lineWidth: -1 });

	// 2. In-memory round-trip syntax verification
	const reparsed = yaml.load(newYaml);
	if (!reparsed || !Array.isArray(reparsed.ingress)) {
		throw new Error("Generated invalid YAML: missing or invalid ingress array");
	}

	const dir = path.dirname(CONFIG_PATH);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const tempPath = path.join(
		dir,
		`.config.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
	);

	try {
		// 3. Write to temporary file
		fs.writeFileSync(tempPath, newYaml, "utf8");

		// 4. Validate with cloudflared binary if installed
		try {
			validateWithCloudflared(tempPath);
		} catch (vErr) {
			// If validation specifically failed because cloudflared found bad rules, abort
			if (vErr.message.includes("ingress validation failed")) {
				throw vErr;
			}
			// If cloudflared is missing or failed to execute binary, rely on js-yaml validation
		}

		// 5. Create backup of current configuration before overwriting
		const backupPath = `${CONFIG_PATH}.bak`;
		if (fs.existsSync(CONFIG_PATH)) {
			try {
				fs.copyFileSync(CONFIG_PATH, backupPath);
			} catch (bErr) {
				console.warn("[ingress] Notice: could not update backup file:", bErr.message);
			}
		}

		// 6. Atomic swap (POSIX atomic rename)
		fs.renameSync(tempPath, CONFIG_PATH);
	} catch (err) {
		// Clean up temporary file
		try {
			if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
		} catch (_) {}
		throw err;
	}
}

/**
 * Restores the previous configuration from backup file if available.
 */
function restoreBackupConfig() {
	const backupPath = `${CONFIG_PATH}.bak`;
	if (fs.existsSync(backupPath)) {
		try {
			fs.copyFileSync(backupPath, CONFIG_PATH);
			console.log("[ingress] Restored configuration from backup (.bak)");
			return true;
		} catch (err) {
			console.error("[ingress] Failed to restore backup config:", err.message);
		}
	}
	return false;
}

// ─── Internal Unlocked Operations ───────────────────────────────────────────

function _getIngressRulesInternal() {
	try {
		if (!fs.existsSync(CONFIG_PATH)) return [];
		const file = fs.readFileSync(CONFIG_PATH, "utf8");
		const config = yaml.load(file);
		const baseDomain = CF_DOMAIN;
		return (config.ingress || [])
			.filter((r) => r.hostname && r.hostname !== `dash.${baseDomain}` && r.hostname !== `ssh.${baseDomain}`)
			.map((r) => {
				const suffix = `.${baseDomain}`;
				const subdomain = r.hostname.endsWith(suffix)
					? r.hostname.slice(0, -suffix.length)
					: r.hostname;
				const portMatch = r.service ? r.service.match(/localhost:(\d+)/) : null;
				const port = portMatch ? portMatch[1] : null;
				return {
					hostname: r.hostname,
					subdomain,
					service: r.service,
					port,
					url: `https://${r.hostname}`,
				};
			});
	} catch (e) {
		return [];
	}
}

function _addIngressRuleInternal(subdomain, localPort) {
	assertCfDomain();
	const validSubdomain = validateSubdomain(subdomain);
	const port = Number(localPort);
	if (!port || isNaN(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid local port: ${localPort}`);
	}

	if (!fs.existsSync(CONFIG_PATH)) {
		throw new Error(`Cloudflare config file not found at: ${CONFIG_PATH}`);
	}

	const file = fs.readFileSync(CONFIG_PATH, "utf8");
	const config = yaml.load(file);
	if (!config || !Array.isArray(config.ingress)) {
		throw new Error("Invalid config.yaml: missing ingress array");
	}

	const hostname = `${validSubdomain}.${CF_DOMAIN}`;
	if (config.ingress.some((r) => r.hostname === hostname)) {
		throw new Error(`Hostname '${hostname}' already exists`);
	}

	const catchAllIndex = config.ingress.findIndex((r) => !r.hostname);
	if (catchAllIndex === -1) {
		throw new Error("Invalid config.yaml: missing catch-all fallback rule");
	}

	const newRule = {
		hostname: hostname,
		service: `http://localhost:${port}`,
	};

	config.ingress.splice(catchAllIndex, 0, newRule);
	safeWriteYamlConfig(config);

	return {
		hostname,
		subdomain: validSubdomain,
		port,
		url: `https://${hostname}`,
	};
}

function _removeIngressRuleInternal(subdomain) {
	assertCfDomain();
	const clean = String(subdomain || "").trim().toLowerCase();
	if (!clean) throw new Error("Subdomain is required");

	if (RESERVED_SUBDOMAINS.has(clean)) {
		throw new Error(`Cannot remove protected system ingress rule for '${clean}'`);
	}

	if (!fs.existsSync(CONFIG_PATH)) return false;

	const file = fs.readFileSync(CONFIG_PATH, "utf8");
	const config = yaml.load(file);
	if (!config || !Array.isArray(config.ingress)) return false;

	const hostname = `${clean}.${CF_DOMAIN}`;
	const initialLen = config.ingress.length;
	config.ingress = config.ingress.filter((r) => r.hostname !== hostname);

	if (config.ingress.length !== initialLen) {
		safeWriteYamlConfig(config);
		return true;
	}
	return false;
}

function _removeIngressByPortInternal(localPort) {
	try {
		if (!CF_DOMAIN) return false;
		const portNum = Number(localPort);
		if (portNum === 22 || portNum === 3001) return false; // Protected system services
		if (!fs.existsSync(CONFIG_PATH)) return false;
		const file = fs.readFileSync(CONFIG_PATH, "utf8");
		const config = yaml.load(file);
		if (!config || !Array.isArray(config.ingress)) return false;

		const targetService = `http://localhost:${localPort}`;
		const initialLen = config.ingress.length;
		config.ingress = config.ingress.filter((r) => r.service !== targetService);

		if (config.ingress.length !== initialLen) {
			safeWriteYamlConfig(config);
			return true;
		}
	} catch (e) {
		console.error("[ingress] Failed to remove ingress rule by port:", e.message);
	}
	return false;
}

async function _reloadCloudflaredInternal() {
	try {
		await restartTunnel();
	} catch (err) {
		console.warn("[ingress] Notice: cloudflared restart failed:", err.message);
		// If tunnel restart failed, attempt to restore backup and restart
		if (restoreBackupConfig()) {
			try {
				await restartTunnel();
				console.log("[ingress] Tunnel restored and restarted with backup config");
			} catch (rErr) {
				console.error("[ingress] Critical: Failed to restart tunnel after backup restore:", rErr.message);
			}
		}
		throw err;
	}
}

// ─── Public Locked API ───────────────────────────────────────────────────────

function getIngressRules() {
	return _getIngressRulesInternal();
}

async function addIngressRule(subdomain, localPort) {
	return ingressMutex.runExclusive(async () => {
		return _addIngressRuleInternal(subdomain, localPort);
	});
}

async function removeIngressRule(subdomain) {
	return ingressMutex.runExclusive(async () => {
		return _removeIngressRuleInternal(subdomain);
	});
}

async function removeIngressByPort(localPort) {
	return ingressMutex.runExclusive(async () => {
		return _removeIngressByPortInternal(localPort);
	});
}

async function reloadCloudflared() {
	return ingressMutex.runExclusive(async () => {
		return _reloadCloudflaredInternal();
	});
}

/**
 * Atomically validates, creates an ingress rule, and reloads cloudflared in a single
 * critical section under the mutex lock.
 */
async function exposeContainer(subdomain, localPort) {
	return ingressMutex.runExclusive(async () => {
		const result = _addIngressRuleInternal(subdomain, localPort);
		try {
			await _reloadCloudflaredInternal();
		} catch (err) {
			// If reload fails, rollback rule
			_removeIngressRuleInternal(subdomain);
			throw err;
		}
		return result;
	});
}

/**
 * Atomically removes an ingress rule and reloads cloudflared in a single
 * critical section under the mutex lock.
 */
async function unexposeContainer(subdomain) {
	return ingressMutex.runExclusive(async () => {
		const removed = _removeIngressRuleInternal(subdomain);
		if (removed) {
			try {
				await _reloadCloudflaredInternal();
			} catch (err) {
				console.warn("[ingress] Notice: tunnel reload warning after unexpose:", err.message);
			}
		}
		return removed;
	});
}

module.exports = {
	validateSubdomain,
	getIngressRules,
	_getIngressRulesInternal,
	removeIngressByPort,
	addIngressRule,
	removeIngressRule,
	reloadCloudflared,
	exposeContainer,
	unexposeContainer,
	ingressMutex,
	safeWriteYamlConfig,
	restoreBackupConfig,
};
