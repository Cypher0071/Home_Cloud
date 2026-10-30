import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const suites = {
	agent: [
		"agent/tests/verify_auth.mjs",
		"agent/tests/verify_origin.mjs",
		"agent/tests/verify_network_security.mjs",
		"agent/tests/verify_drives_cache.mjs",
		"agent/tests/verify_setup_tunnel.mjs",
		"agent/tests/verify_setup_interruption.mjs",
		"agent/tests/verify_compose.mjs",
		"agent/tests/verify_storage_scope.mjs",
		"agent/tests/verify_session_revocation.mjs",
		"agent/tests/verify_password_settings.mjs",
		"agent/tests/verify_update_manager.mjs",
		"agent/tests/verify_personalization_settings.mjs",
		"agent/tests/verify_ingress.mjs",
	],
	e2e: [
		".agents/tests/terminal_e2e.test.mjs",
		".agents/tests/compose_refactor_e2e.test.mjs",
	],
};

const suiteName = process.argv[2];
if (!Object.hasOwn(suites, suiteName)) {
	console.error("Usage: node .agents/tests/run_isolated_suite.mjs <agent|e2e>");
	process.exit(2);
}

let failures = 0;
for (const testPath of suites[suiteName]) {
	const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "home-cloud-test-home-"));
	const childEnv = {
		...process.env,
		HOME: testHome,
		XDG_CONFIG_HOME: path.join(testHome, ".config"),
		XDG_DATA_HOME: path.join(testHome, ".local", "share"),
		XDG_CACHE_HOME: path.join(testHome, ".cache"),
		HOME_CLOUD_CONFIG_DIR: path.join(testHome, ".config", "home-cloud"),
		AGENT_ENV_FILE: path.join(testHome, ".env"),
		CF_CONFIG: path.join(testHome, ".cloudflared", "config.yml"),
		BASE_DIR: testHome,
	};
	for (const name of Object.keys(childEnv)) {
		if (/^(PASSWORD|JWT_SECRET|GITHUB_TOKEN|CF_DOMAIN|CLOUDFLARE_BASE_DOMAIN)$|_(SECRET|TOKEN)$/.test(name)) {
			delete childEnv[name];
		}
	}

	console.log(`\n[suite:${suiteName}] ${testPath}`);
	try {
		const result = spawnSync(process.execPath, [testPath], {
			cwd: repoRoot,
			env: childEnv,
			stdio: "inherit",
		});
		if (result.error) throw result.error;
		if (result.status !== 0) {
			failures += 1;
			console.error(`[suite:${suiteName}] failed: ${testPath} (status ${result.status ?? "unknown"})`);
		}
	} catch (error) {
		failures += 1;
		console.error(`[suite:${suiteName}] failed to run ${testPath}: ${error.message}`);
	} finally {
		fs.rmSync(testHome, { recursive: true, force: true });
	}
}

console.log(`\n[suite:${suiteName}] ${suites[suiteName].length - failures}/${suites[suiteName].length} test files passed.`);
process.exitCode = failures === 0 ? 0 : 1;
