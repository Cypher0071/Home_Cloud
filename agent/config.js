const os = require("os");
const path = require("path");
const fs = require("fs");

const PORT = Number(process.env.PORT) || 3000;

const rawBase = process.env.BASE_DIR || os.homedir();
const BASE_DIR = fs.realpathSync(path.resolve(rawBase));

const CF_DOMAIN = (
	process.env.CF_DOMAIN ||
	process.env.CLOUDFLARE_BASE_DOMAIN ||
	""
).trim();

const PLACEHOLDER_PASSWORDS = new Set(["change-me"]);
const PLACEHOLDER_JWT_SECRETS = new Set(["generate-a-long-random-string"]);

function assertRuntimeSecrets() {
	const password = process.env.PASSWORD || "";
	const jwtSecret = process.env.JWT_SECRET || "";
	const problems = [];

	if (password.length < 8 || PLACEHOLDER_PASSWORDS.has(password)) {
		problems.push(
			"PASSWORD must be at least 8 characters and must not be the example value \"change-me\"",
		);
	}
	if (jwtSecret.length < 16 || PLACEHOLDER_JWT_SECRETS.has(jwtSecret)) {
		problems.push(
			"JWT_SECRET must be at least 16 characters and must not be the example value \"generate-a-long-random-string\"",
		);
	}

	if (problems.length > 0) {
		console.error("[agent] Refusing to start:");
		for (const problem of problems) {
			console.error(`[agent] - ${problem}`);
		}
		process.exit(1);
	}
}

const TUNNEL_NAME = process.env.TUNNEL_NAME || "home-cloud";

const CF_CONFIG =
	process.env.CF_CONFIG ||
	path.join(os.homedir(), ".cloudflared", "config.yml");

const COOKIE_SECURE = process.env.COOKIE_SECURE !== "false";

module.exports = {
	PORT,
	BASE_DIR,
	CF_DOMAIN,
	TUNNEL_NAME,
	CF_CONFIG,
	COOKIE_SECURE,
	assertRuntimeSecrets,
};
