import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const SETUP_SH = path.join(REPO_ROOT, "setup.sh");

console.log("--- Running Cloudflare Automated Tunnel Setup Verification Tests ---");

// Helper to create sandbox directory structure
function createSandbox(testName) {
	const sandboxDir = path.join(__dirname, "sandbox", testName);
	fs.rmSync(sandboxDir, { recursive: true, force: true });
	const homeDir = path.join(sandboxDir, "home");
	const binDir = path.join(sandboxDir, "bin");
	const agentDir = path.join(sandboxDir, "repo", "agent");
	const cfDir = path.join(homeDir, ".cloudflared");

	fs.mkdirSync(homeDir, { recursive: true });
	fs.mkdirSync(binDir, { recursive: true });
	fs.mkdirSync(agentDir, { recursive: true });
	fs.mkdirSync(cfDir, { recursive: true });

	return { sandboxDir, homeDir, binDir, agentDir, cfDir };
}

function cleanupSandbox(sandboxDir) {
	fs.rmSync(sandboxDir, { recursive: true, force: true });
}

// Helper to run setup_cloudflare_tunnel with custom mock environment
function runTunnelSetup(options) {
	const {
		homeDir,
		binDir,
		agentDir,
		env = {},
		stdin = "",
		mockMissingCf = false,
	} = options;

	const script = `
        SETUP_SH="${SETUP_SH}"
        eval "$(awk '/^run_as_current_user\\(\\)/,/# 2\\. Install/' "$SETUP_SH" | head -n -1)"
        eval "$(awk '/^setup_cloudflare_tunnel\\(\\)/,/^setup_cloudflare_tunnel$/' "$SETUP_SH" | head -n -1)"
        ${mockMissingCf ? `
        command() {
            if [ "$1" = "-v" ] && [ "$2" = "cloudflared" ]; then return 1; fi
            builtin command "$@"
        }
        ` : ""}
        setup_cloudflare_tunnel
    `;

	const customPath = binDir ? `${binDir}:${process.env.PATH}` : process.env.PATH;
	const runEnv = {
		...process.env,
		PATH: customPath,
		CURRENT_HOME: homeDir,
		CURRENT_USER: process.env.USER || "testuser",
		CURRENT_GROUP: process.env.USER || "testuser",
		SCRIPT_DIR: path.resolve(agentDir, ".."),
		NODE_PATH: process.execPath,
		ACTIVE_IP: "192.168.1.100",
		...env,
	};

	const res = spawnSync("bash", ["-c", script], {
		env: runEnv,
		input: stdin,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});

	return {
		code: res.status,
		stdout: res.stdout || "",
		stderr: res.stderr || "",
		output: (res.stdout || "") + (res.stderr || ""),
	};
}

// -----------------------------------------------------------------------------
// Test 1: cloudflared is not installed -> reports LAN-only mode without errors
// -----------------------------------------------------------------------------
console.log("\n[Test 1] cloudflared is not installed");
{
	const { sandboxDir, homeDir, agentDir } = createSandbox("test1_no_cf");
	try {
		const res = runTunnelSetup({
			homeDir,
			binDir: null,
			agentDir,
			mockMissingCf: true,
		});

		assert.equal(res.code, 0, "Expected exit code 0 when cloudflared missing");
		assert.match(
			res.output,
			/cloudflared is not installed\. Home Cloud will run in LAN-only mode/i,
			"Expected notice that cloudflared is not installed and LAN mode active",
		);
		console.log("  ✔ Detected missing cloudflared and notified LAN-only mode.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

// -----------------------------------------------------------------------------
// Test 2: Existing config.yml detected -> skips prompts & syncs CF_DOMAIN to agent/.env
// -----------------------------------------------------------------------------
console.log("\n[Test 2] Existing config.yml detected");
{
	const { sandboxDir, homeDir, binDir, agentDir, cfDir } = createSandbox("test2_existing_config");
	try {
		// Create mock cloudflared
		const mockCf = path.join(binDir, "cloudflared");
		fs.writeFileSync(mockCf, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

		// Pre-populate existing config.yml
		const configYml = path.join(cfDir, "config.yml");
		fs.writeFileSync(
			configYml,
			`tunnel: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
credentials-file: ${cfDir}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json
ingress:
  - hostname: dash.my-preconfigured-domain.org
    service: http://localhost:3000
  - service: http_status:404
`,
		);

		// Pre-populate agent/.env without CF_DOMAIN
		const envFile = path.join(agentDir, ".env");
		fs.writeFileSync(
			envFile,
			`PASSWORD=secret123\nJWT_SECRET=topsecretjwt\nPORT=3000\n`,
			{ mode: 0o600 },
		);

		const res = runTunnelSetup({
			homeDir,
			binDir,
			agentDir,
			stdin: "",
		});

		assert.equal(res.code, 0);
		assert.match(
			res.output,
			/Existing Cloudflare Tunnel configuration detected/i,
			"Expected message detecting existing config",
		);
		assert.match(
			res.output,
			/Synced CF_DOMAIN=my-preconfigured-domain\.org/i,
			"Expected message confirming CF_DOMAIN sync to agent/.env",
		);

		const updatedEnv = fs.readFileSync(envFile, "utf8");
		assert.match(updatedEnv, /^CF_DOMAIN=my-preconfigured-domain\.org$/m);
		assert.match(updatedEnv, /^TUNNEL_NAME=home-cloud$/m);
		assert.match(updatedEnv, /^PASSWORD=secret123$/m, "Original PASSWORD preserved");
		assert.match(updatedEnv, /^JWT_SECRET=topsecretjwt$/m, "Original JWT_SECRET preserved");
		console.log("  ✔ Existing config.yml parsed and synced CF_DOMAIN to agent/.env safely.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

// -----------------------------------------------------------------------------
// Test 3: config.yml missing, user declines setup
// -----------------------------------------------------------------------------
console.log("\n[Test 3] config.yml missing, user declines setup");
{
	const { sandboxDir, homeDir, binDir, agentDir, cfDir } = createSandbox("test3_user_declines");
	try {
		const mockCf = path.join(binDir, "cloudflared");
		fs.writeFileSync(mockCf, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

		const res = runTunnelSetup({
			homeDir,
			binDir,
			agentDir,
			env: { SETUP_FORCE_INTERACTIVE: "true" },
			stdin: "n\n",
		});

		assert.equal(res.code, 0);
		assert.match(res.output, /Cloudflare Tunnel setup skipped/i);
		assert.match(res.output, /Home Cloud will run in LAN-only mode/i);
		assert.equal(
			fs.existsSync(path.join(cfDir, "config.yml")),
			false,
			"config.yml should not have been created",
		);
		console.log("  ✔ User decline handled cleanly with LAN-only mode notice.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

// -----------------------------------------------------------------------------
// Test 4: Headless mode without domain or cert.pem -> fallback to LAN-only
// -----------------------------------------------------------------------------
console.log("\n[Test 4] Headless mode without cert.pem");
{
	const { sandboxDir, homeDir, binDir, agentDir, cfDir } = createSandbox("test4_headless_no_cert");
	try {
		const mockCf = path.join(binDir, "cloudflared");
		fs.writeFileSync(mockCf, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

		// Non-interactive (empty stdin, no TTY) with CF_DOMAIN passed in env
		const res = runTunnelSetup({
			homeDir,
			binDir,
			agentDir,
			env: { CF_DOMAIN: "auto.example.com" },
			stdin: "",
		});

		assert.equal(res.code, 0);
		assert.match(res.output, /Non-interactive mode detected and .*cert\.pem not found/i);
		assert.match(res.output, /Home Cloud will run in LAN-only mode/i);
		assert.equal(
			fs.existsSync(path.join(cfDir, "config.yml")),
			false,
			"config.yml should not have been created without cert",
		);
		console.log("  ✔ Non-interactive missing cert handled gracefully without hanging.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

// -----------------------------------------------------------------------------
// Test 5: Full automated setup flow (login -> tunnel create -> config.yml -> route dns -> .env)
// -----------------------------------------------------------------------------
console.log("\n[Test 5] Full automated setup flow");
{
	const { sandboxDir, homeDir, binDir, agentDir, cfDir } = createSandbox("test5_full_flow");
	try {
		const logFile = path.join(sandboxDir, "mock_cloudflared.log");
		const mockCf = path.join(binDir, "cloudflared");

		// Mock cloudflared recording calls and performing file writes
		fs.writeFileSync(
			mockCf,
			`#!/usr/bin/env bash
set -e
echo "$@" >> "${logFile}"
case "$1" in
    tunnel)
        case "$2" in
            login)
                echo "Please open https://dash.cloudflare.com/argotunnel?..."
                touch "${cfDir}/cert.pem"
                echo "Successfully downloaded credentials"
                exit 0
                ;;
            list)
                # First check, tunnel does not exist
                echo "ID NAME CREATED CONNECTIONS"
                exit 0
                ;;
            create)
                TUNNEL_NAME="$3"
                UUID="11223344-5566-7788-9900-aabbccddeeff"
                cat << EOF > "${cfDir}/\${UUID}.json"
{"AccountTag":"tag123","TunnelSecret":"sec","TunnelID":"\${UUID}"}
EOF
                echo "Tunnel credentials written to ${cfDir}/\${UUID}.json. cloudflared has given you a Tunnel ID of \${UUID}"
                exit 0
                ;;
            route)
                echo "Route DNS called: $@"
                exit 0
                ;;
        esac
        ;;
    *)
        exit 0
        ;;
esac
`,
			{ mode: 0o755 },
		);

		// Setup initial agent/.env
		const envFile = path.join(agentDir, ".env");
		fs.writeFileSync(
			envFile,
			`PASSWORD=productionpass\nJWT_SECRET=randomjwtstring\nPORT=3000\n`,
			{ mode: 0o600 },
		);

		// Input: 'y' for setup prompt, 'https://myserver.live/' for domain (tests url cleanup)
		const res = runTunnelSetup({
			homeDir,
			binDir,
			agentDir,
			env: { SETUP_FORCE_INTERACTIVE: "true" },
			stdin: "y\nhttps://myserver.live/\n",
		});

		assert.equal(res.code, 0, `Execution failed: ${res.output}`);
		assert.match(res.output, /✔ Successfully generated .*config\.yml/i);
		assert.match(res.output, /✔ DNS routing configured for dash\.myserver\.live/i);
		assert.match(res.output, /✔ Updated agent\/\.env with CF_DOMAIN=myserver\.live/i);

		// Verify cert.pem created
		assert.equal(fs.existsSync(path.join(cfDir, "cert.pem")), true);

		// Verify config.yml content
		const configPath = path.join(cfDir, "config.yml");
		assert.equal(fs.existsSync(configPath), true);
		const configContent = fs.readFileSync(configPath, "utf8");

		const expectedConfig = `tunnel: 11223344-5566-7788-9900-aabbccddeeff
credentials-file: ${cfDir}/11223344-5566-7788-9900-aabbccddeeff.json

ingress:
  - hostname: dash.myserver.live
    service: http://localhost:3000
  - service: http_status:404
`;
		assert.equal(configContent.trim(), expectedConfig.trim());

		// Verify agent/.env content
		const envContent = fs.readFileSync(envFile, "utf8");
		assert.match(envContent, /^CF_DOMAIN=myserver\.live$/m);
		assert.match(envContent, /^TUNNEL_NAME=home-cloud$/m);
		assert.match(envContent, /^PASSWORD=productionpass$/m);
		assert.match(envContent, /^JWT_SECRET=randomjwtstring$/m);

		// Verify cloudflared invocation calls in log
		const logs = fs.readFileSync(logFile, "utf8");
		assert.match(logs, /tunnel login/);
		assert.match(logs, /tunnel create home-cloud/);
		assert.match(logs, /tunnel route dns (--overwrite-dns )?home-cloud dash\.myserver\.live/);

		console.log("  ✔ Full automated Cloudflare tunnel flow completed successfully.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

// -----------------------------------------------------------------------------
// Test 6: Reusing existing tunnel from tunnel list (no redundant tunnel create)
// -----------------------------------------------------------------------------
console.log("\n[Test 6] Reusing existing tunnel from tunnel list");
{
	const { sandboxDir, homeDir, binDir, agentDir, cfDir } = createSandbox("test6_reuse_tunnel");
	try {
		const mockCf = path.join(binDir, "cloudflared");
		const existingUUID = "99887766-5544-3322-1100-ffeeddccbbaa";

		// cert.pem already exists
		fs.writeFileSync(path.join(cfDir, "cert.pem"), "dummy-cert");
		fs.writeFileSync(path.join(cfDir, `${existingUUID}.json`), "{}");

		fs.writeFileSync(
			mockCf,
			`#!/usr/bin/env bash
case "$2" in
    list)
        echo "ID                                   NAME       CREATED"
        echo "${existingUUID} home-cloud 2026-01-01T00:00:00Z"
        exit 0
        ;;
    create)
        echo "ERROR: create should NOT have been called!" >&2
        exit 1
        ;;
    route)
        exit 0
        ;;
esac
`,
			{ mode: 0o755 },
		);

		const envFile = path.join(agentDir, ".env");
		fs.writeFileSync(envFile, "PORT=3000\n", { mode: 0o600 });

		const res = runTunnelSetup({
			homeDir,
			binDir,
			agentDir,
			env: { CF_DOMAIN: "reuse-domain.xyz", SETUP_FORCE_INTERACTIVE: "true" },
			stdin: "y\n",
		});

		assert.equal(res.code, 0, `Execution failed: ${res.output}`);
		assert.match(res.output, /Found existing tunnel 'home-cloud' with ID/i);

		const configContent = fs.readFileSync(path.join(cfDir, "config.yml"), "utf8");
		assert.match(configContent, new RegExp(`tunnel: ${existingUUID}`));
		assert.match(configContent, /hostname: dash\.reuse-domain\.xyz/);

		console.log("  ✔ Existing tunnel reused without duplicate creation.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

// -----------------------------------------------------------------------------
// Test 7: Headless automated provisioning with CF_DOMAIN & existing cert.pem
// -----------------------------------------------------------------------------
console.log("\n[Test 7] Headless automated setup with CF_DOMAIN & existing cert.pem");
{
	const { sandboxDir, homeDir, binDir, agentDir, cfDir } = createSandbox("test7_headless_automated");
	try {
		const mockCf = path.join(binDir, "cloudflared");
		const newUUID = "12345678-1234-1234-1234-123456789abc";

		fs.writeFileSync(path.join(cfDir, "cert.pem"), "dummy-cert");

		fs.writeFileSync(
			mockCf,
			`#!/usr/bin/env bash
case "$2" in
    list)
        echo "ID NAME CREATED"
        exit 0
        ;;
    create)
        touch "${cfDir}/${newUUID}.json"
        echo "Tunnel credentials written to ${cfDir}/${newUUID}.json. cloudflared has given you a Tunnel ID of ${newUUID}"
        exit 0
        ;;
    route)
        exit 0
        ;;
esac
`,
			{ mode: 0o755 },
		);

		const envFile = path.join(agentDir, ".env");
		fs.writeFileSync(envFile, "PORT=3000\n", { mode: 0o600 });

		// Non-interactive (stdin empty, no prompts)
		const res = runTunnelSetup({
			homeDir,
			binDir,
			agentDir,
			env: { CF_DOMAIN: "headless-cloud.io" },
			stdin: "",
		});

		assert.equal(res.code, 0, `Headless setup failed: ${res.output}`);
		assert.match(res.output, /✔ Successfully generated .*config\.yml/);

		const configContent = fs.readFileSync(path.join(cfDir, "config.yml"), "utf8");
		assert.match(configContent, new RegExp(`tunnel: ${newUUID}`));
		assert.match(configContent, /hostname: dash\.headless-cloud\.io/);

		const envContent = fs.readFileSync(envFile, "utf8");
		assert.match(envContent, /CF_DOMAIN=headless-cloud\.io/);
		assert.match(envContent, /TUNNEL_NAME=home-cloud/);

		console.log("  ✔ Headless automated provisioning succeeded without any interactive prompts.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

// -----------------------------------------------------------------------------
// Test 8: End-of-install banner outputs remote HTTPS URL if CF_DOMAIN configured
// -----------------------------------------------------------------------------
console.log("\n[Test 8] End-of-install banner with remote HTTPS URL");
{
	const { sandboxDir, homeDir, agentDir, cfDir } = createSandbox("test8_banner");
	try {
		fs.writeFileSync(path.join(cfDir, "config.yml"), "dummy");
		fs.writeFileSync(
			path.join(agentDir, ".env"),
			"CF_DOMAIN=superhome.online\n",
			{ mode: 0o600 },
		);

		const bannerScript = `
            SCRIPT_DIR="${path.resolve(agentDir, "..")}"
            CURRENT_HOME="${homeDir}"
            ACTIVE_IP="192.168.1.50"
            ACTIVE_CF_DOMAIN="$(grep -E "^CF_DOMAIN=" "$SCRIPT_DIR/agent/.env" 2>/dev/null | cut -d'=' -f2- || true)"
            echo "  Access locally at:  http://$ACTIVE_IP:3000"
            if [ -n "$ACTIVE_CF_DOMAIN" ] && [ -f "$CURRENT_HOME/.cloudflared/config.yml" ]; then
                echo "  Access remotely at: https://dash.$ACTIVE_CF_DOMAIN"
            fi
        `;

		const res = spawnSync("bash", ["-c", bannerScript], { encoding: "utf8" });
		assert.match(res.stdout, /Access locally at:\s+http:\/\/192\.168\.1\.50:3000/);
		assert.match(res.stdout, /Access remotely at:\s+https:\/\/dash\.superhome\.online/);

		console.log("  ✔ Banner correctly renders both local LAN and remote Cloudflare HTTPS URLs.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

// -----------------------------------------------------------------------------
// Test 9: Orphaned remote tunnel without local credentials file -> deletes & re-creates
// -----------------------------------------------------------------------------
console.log("\n[Test 9] Orphaned remote tunnel without local credentials file");
{
	const { sandboxDir, homeDir, binDir, agentDir, cfDir } = createSandbox("test9_orphan_tunnel");
	try {
		const mockCf = path.join(binDir, "cloudflared");
		const logFile = path.join(sandboxDir, "cloudflared.log");
		const orphanedUUID = "deadbeef-dead-beef-dead-beefdeadbeef";
		const newUUID = "cafebabe-cafe-babe-cafe-babecafebabe";

		fs.writeFileSync(path.join(cfDir, "cert.pem"), "dummy-cert");

		fs.writeFileSync(
			mockCf,
			`#!/usr/bin/env bash
echo "$@" >> "${logFile}"
case "$2" in
    list)
        if [ -f "${sandboxDir}/tunnel_deleted" ]; then
            echo "ID NAME CREATED"
        else
            echo "ID NAME CREATED"
            echo "${orphanedUUID} home-cloud 2026-01-01"
        fi
        exit 0
        ;;
    delete)
        touch "${sandboxDir}/tunnel_deleted"
        echo "Deleted tunnel home-cloud"
        exit 0
        ;;
    create)
        cat << EOF > "${cfDir}/${newUUID}.json"
{"AccountTag":"tag","TunnelSecret":"sec","TunnelID":"${newUUID}"}
EOF
        echo "Tunnel credentials written to ${cfDir}/${newUUID}.json. Tunnel ID ${newUUID}"
        exit 0
        ;;
    route)
        exit 0
        ;;
esac
`,
			{ mode: 0o755 },
		);

		const envFile = path.join(agentDir, ".env");
		fs.writeFileSync(envFile, "PORT=3000\n", { mode: 0o600 });

		const res = runTunnelSetup({
			homeDir,
			binDir,
			agentDir,
			env: { CF_DOMAIN: "fresh-cloud.org" },
			stdin: "",
		});

		assert.equal(res.code, 0, `Execution failed: ${res.output}`);
		assert.match(res.output, /Removing orphaned remote tunnel and generating new credentials/i);
		assert.match(res.output, /✔ Successfully generated .*config\.yml/i);

		const configContent = fs.readFileSync(path.join(cfDir, "config.yml"), "utf8");
		assert.match(configContent, new RegExp(`tunnel: ${newUUID}`));
		assert.match(configContent, new RegExp(`credentials-file: .*${newUUID}\\.json`));
		assert.match(configContent, /hostname: dash\.fresh-cloud\.org/);

		assert.equal(fs.existsSync(path.join(cfDir, `${newUUID}.json`)), true);

		const logContent = fs.readFileSync(logFile, "utf8");
		assert.match(logContent, /tunnel delete -f home-cloud/);
		assert.match(logContent, /tunnel create home-cloud/);

		console.log("  ✔ Orphaned remote tunnel detected, cleanly purged, and recreated with local credentials.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

// -----------------------------------------------------------------------------
// Test 10: Headless mode domain normalization (protocol, port, path, uppercase, dash. prefix)
// -----------------------------------------------------------------------------
console.log("\n[Test 10] Headless mode domain normalization");
{
	const { sandboxDir, homeDir, binDir, agentDir, cfDir } = createSandbox("test10_headless_normalization");
	try {
		const mockCf = path.join(binDir, "cloudflared");
		const uuid = "44332211-0000-1111-2222-333344445555";

		fs.writeFileSync(path.join(cfDir, "cert.pem"), "dummy-cert");

		fs.writeFileSync(
			mockCf,
			`#!/usr/bin/env bash
case "$2" in
    list)
        echo "ID NAME CREATED"
        exit 0
        ;;
    create)
        touch "${cfDir}/${uuid}.json"
        echo "Tunnel credentials written to ${cfDir}/${uuid}.json. Tunnel ID ${uuid}"
        exit 0
        ;;
    route)
        echo "Route call: $@"
        exit 0
        ;;
esac
`,
			{ mode: 0o755 },
		);

		const envFile = path.join(agentDir, ".env");
		fs.writeFileSync(envFile, "PORT=3000\n", { mode: 0o600 });

		const res = runTunnelSetup({
			homeDir,
			binDir,
			agentDir,
			env: { CF_DOMAIN: "https://DASH.Production-Cloud.IO:8443/custom/path" },
			stdin: "",
		});

		assert.equal(res.code, 0, `Execution failed: ${res.output}`);
		assert.match(res.output, /Routing DNS for dash\.production-cloud\.io/);
		assert.match(res.output, /CF_DOMAIN=production-cloud\.io/);

		const configContent = fs.readFileSync(path.join(cfDir, "config.yml"), "utf8");
		assert.match(configContent, /hostname: dash\.production-cloud\.io/);

		const envContent = fs.readFileSync(envFile, "utf8");
		assert.match(envContent, /^CF_DOMAIN=production-cloud\.io$/m);

		console.log("  ✔ Headless domain input thoroughly sanitized and normalized.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

// -----------------------------------------------------------------------------
// Test 11: Existing config.yml updates outdated/pre-existing CF_DOMAIN in agent/.env
// -----------------------------------------------------------------------------
console.log("\n[Test 11] Existing config.yml updates outdated CF_DOMAIN in agent/.env");
{
	const { sandboxDir, homeDir, binDir, agentDir, cfDir } = createSandbox("test11_existing_config_update");
	try {
		const mockCf = path.join(binDir, "cloudflared");
		fs.writeFileSync(mockCf, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

		const configYml = path.join(cfDir, "config.yml");
		fs.writeFileSync(
			configYml,
			`tunnel: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
credentials-file: ${cfDir}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json
ingress:
  - hostname: dash.updated-target-domain.org
    service: http://localhost:3000
  - service: http_status:404
`,
		);

		const envFile = path.join(agentDir, ".env");
		fs.writeFileSync(
			envFile,
			`PASSWORD=secret123\nCF_DOMAIN=stale-old-domain.com\nTUNNEL_NAME=old-tunnel\nPORT=3000\n`,
			{ mode: 0o600 },
		);

		const res = runTunnelSetup({
			homeDir,
			binDir,
			agentDir,
			stdin: "",
		});

		assert.equal(res.code, 0);
		assert.match(res.output, /Synced CF_DOMAIN=updated-target-domain\.org/);

		const updatedEnv = fs.readFileSync(envFile, "utf8");
		assert.match(updatedEnv, /^CF_DOMAIN=updated-target-domain\.org$/m);
		assert.match(updatedEnv, /^TUNNEL_NAME=home-cloud$/m);
		assert.doesNotMatch(updatedEnv, /stale-old-domain\.com/);
		assert.match(updatedEnv, /^PASSWORD=secret123$/m);

		console.log("  ✔ Existing config.yml overrides outdated CF_DOMAIN in agent/.env safely.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

// -----------------------------------------------------------------------------
// Test 12: Interactive domain prompt with dash. prefix and mixed casing
// -----------------------------------------------------------------------------
console.log("\n[Test 12] Interactive domain prompt with dash. prefix and mixed casing");
{
	const { sandboxDir, homeDir, binDir, agentDir, cfDir } = createSandbox("test12_interactive_dash_prefix");
	try {
		const mockCf = path.join(binDir, "cloudflared");
		const uuid = "77665544-3322-1100-aa99-ffeeddccbbaa";

		fs.writeFileSync(
			mockCf,
			`#!/usr/bin/env bash
case "$2" in
    login)
        touch "${cfDir}/cert.pem"
        exit 0
        ;;
    list)
        echo "ID NAME CREATED"
        exit 0
        ;;
    create)
        touch "${cfDir}/${uuid}.json"
        echo "Created tunnel ${uuid}"
        exit 0
        ;;
    route)
        exit 0
        ;;
esac
`,
			{ mode: 0o755 },
		);

		const envFile = path.join(agentDir, ".env");
		fs.writeFileSync(envFile, "PORT=3000\n", { mode: 0o600 });

		const res = runTunnelSetup({
			homeDir,
			binDir,
			agentDir,
			env: { SETUP_FORCE_INTERACTIVE: "true" },
			stdin: "y\nhttps://DASH.MyInteractiveCloud.NET/\n",
		});

		assert.equal(res.code, 0, `Execution failed: ${res.output}`);
		assert.match(res.output, /Routing DNS for dash\.myinteractivecloud\.net/);

		const configContent = fs.readFileSync(path.join(cfDir, "config.yml"), "utf8");
		assert.match(configContent, /hostname: dash\.myinteractivecloud\.net/);

		const envContent = fs.readFileSync(envFile, "utf8");
		assert.match(envContent, /^CF_DOMAIN=myinteractivecloud\.net$/m);

		console.log("  ✔ Interactive dash. prefix stripped to prevent double-subdomain.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

// -----------------------------------------------------------------------------
// Test 13: EOF handling on interactive prompts under set -e
// -----------------------------------------------------------------------------
console.log("\n[Test 13] EOF handling on interactive prompts under set -e");
{
	const { sandboxDir, homeDir, binDir, agentDir } = createSandbox("test13_eof_handling");
	try {
		const mockCf = path.join(binDir, "cloudflared");
		fs.writeFileSync(mockCf, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

		const res = runTunnelSetup({
			homeDir,
			binDir,
			agentDir,
			env: { SETUP_FORCE_INTERACTIVE: "true" },
			stdin: "",
		});

		assert.equal(res.code, 0, `Expected clean exit 0 on EOF, got ${res.code}: ${res.output}`);
		assert.match(res.output, /Cloudflare Tunnel setup skipped/i);
		assert.match(res.output, /Home Cloud will run in LAN-only mode/i);

		console.log("  ✔ EOF on interactive read handled gracefully without set -e script abort.");
	} finally {
		cleanupSandbox(sandboxDir);
	}
}

console.log("\n--- ALL CLOUDFLARE AUTOMATED SETUP VERIFICATION TESTS PASSED SUCCESSFULLY ---");

