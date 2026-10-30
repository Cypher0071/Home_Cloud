import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "home-cloud-ingress-test-"));
process.env.HOME = testHome;
process.env.BASE_DIR = testHome;
process.env.CF_CONFIG = path.join(testHome, ".cloudflared", "config.yml");
delete process.env.CF_DOMAIN;
delete process.env.CLOUDFLARE_BASE_DOMAIN;

const configPath = process.env.CF_CONFIG;
const originalConfig = [
	"tunnel: test-id",
	"credentials-file: /tmp/test-id.json",
	"ingress:",
	"  - hostname: dash.example.test",
	"    service: http://localhost:3000",
	"  - service: http_status:404",
	"",
].join("\n");
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, originalConfig, { mode: 0o600 });
process.once("exit", () => fs.rmSync(testHome, { recursive: true, force: true }));

const require = createRequire(import.meta.url);
const ingress = require("../services/ingress.js");

console.log("--- Running Missing CF_DOMAIN Ingress Guard Tests ---");
assert.throws(
	() => ingress.safeWriteYamlConfig({ ingress: [{ service: "http_status:404" }] }),
	/CF_DOMAIN is not set\. Ingress autowiring is disabled\./,
);
await assert.rejects(
	() => ingress.addIngressRule("photos", 8080),
	/CF_DOMAIN is not set\. Ingress autowiring is disabled\./,
);
await assert.rejects(
	() => ingress.removeIngressRule("photos"),
	/CF_DOMAIN is not set\. Ingress autowiring is disabled\./,
);
await assert.rejects(
	() => ingress.exposeContainer("photos", 8080),
	/CF_DOMAIN is not set\. Ingress autowiring is disabled\./,
);
assert.equal(await ingress.removeIngressByPort(8080), false);
assert.equal(fs.readFileSync(configPath, "utf8"), originalConfig);
assert.equal(fs.existsSync(`${configPath}.bak`), false);
console.log("✔ Missing CF_DOMAIN leaves the existing cloudflared config unchanged");

console.log("\n--- Running Subdomain Validation & Reserved Subdomain Tests ---");
// Reserved subdomains must throw error
assert.throws(
	() => ingress.validateSubdomain("ssh"),
	/Subdomain 'ssh' is reserved and cannot be used\./,
);
assert.throws(
	() => ingress.validateSubdomain("SSH"),
	/Subdomain 'ssh' is reserved and cannot be used\./,
);
assert.throws(
	() => ingress.validateSubdomain("dash"),
	/Subdomain 'dash' is reserved and cannot be used\./,
);
assert.throws(
	() => ingress.validateSubdomain("api"),
	/Subdomain 'api' is reserved and cannot be used\./,
);
assert.throws(
	() => ingress.validateSubdomain("cloudflared"),
	/Subdomain 'cloudflared' is reserved and cannot be used\./,
);

// Valid subdomains should succeed and normalize
assert.equal(ingress.validateSubdomain("photos"), "photos");
assert.equal(ingress.validateSubdomain("MY-APP"), "my-app");
assert.equal(ingress.validateSubdomain("  nextcloud  "), "nextcloud");

// Invalid format / RFC 1123 checks
assert.throws(
	() => ingress.validateSubdomain(""),
	/Subdomain is required and must be a string/,
);
assert.throws(
	() => ingress.validateSubdomain("-invalid"),
	/Invalid subdomain format\./,
);
assert.throws(
	() => ingress.validateSubdomain("invalid-"),
	/Invalid subdomain format\./,
);
assert.throws(
	() => ingress.validateSubdomain("in_valid"),
	/Invalid subdomain format\./,
);
console.log("✔ Subdomain validation and reserved subdomain checks passed");

console.log("\n--- Running Ingress Rules Filtering Tests (_getIngressRulesInternal) ---");
// Set up CF_DOMAIN and reload modules
delete require.cache[require.resolve("../config.js")];
delete require.cache[require.resolve("../services/ingress.js")];
process.env.CF_DOMAIN = "example.test";
const ingressWithDomain = require("../services/ingress.js");

// Write a test cloudflared config that contains dash, ssh, custom services, and catch-all
const multiConfig = [
	"tunnel: test-id",
	"credentials-file: /tmp/test-id.json",
	"ingress:",
	"  - hostname: dash.example.test",
	"    service: http://localhost:3000",
	"  - hostname: ssh.example.test",
	"    service: ssh://localhost:22",
	"  - hostname: photos.example.test",
	"    service: http://localhost:8080",
	"  - hostname: files.example.test",
	"    service: http://localhost:9000",
	"  - service: http_status:404",
	"",
].join("\n");
fs.writeFileSync(configPath, multiConfig, { mode: 0o600 });

// Verify _getIngressRulesInternal excludes ssh.<domain> as well as dash.<domain>
const rules = ingressWithDomain._getIngressRulesInternal();
assert.equal(rules.length, 2, "Should exclude both dash.example.test and ssh.example.test");
assert.deepEqual(rules.map((r) => r.subdomain), ["photos", "files"]);
assert.deepEqual(rules.map((r) => r.hostname), ["photos.example.test", "files.example.test"]);
assert.deepEqual(rules.map((r) => r.port), ["8080", "9000"]);
assert.ok(
	!rules.some((r) => r.subdomain === "ssh" || r.hostname === "ssh.example.test"),
	"ssh.example.test must be excluded from ingress rules",
);
assert.ok(
	!rules.some((r) => r.subdomain === "dash" || r.hostname === "dash.example.test"),
	"dash.example.test must be excluded from ingress rules",
);

// Verify public getIngressRules() matches _getIngressRulesInternal()
const publicRules = ingressWithDomain.getIngressRules();
assert.deepEqual(publicRules, rules);
console.log("✔ _getIngressRulesInternal() strictly excludes ssh.<domain> and dash.<domain>");

console.log("\n--- Running addIngressRule Reserved Subdomain Guard Tests ---");
await assert.rejects(
	() => ingressWithDomain.addIngressRule("ssh", 22),
	/Subdomain 'ssh' is reserved and cannot be used\./,
);
await assert.rejects(
	() => ingressWithDomain.addIngressRule("SSH", 2222),
	/Subdomain 'ssh' is reserved and cannot be used\./,
);
await assert.rejects(
	() => ingressWithDomain.addIngressRule("dash", 3000),
	/Subdomain 'dash' is reserved and cannot be used\./,
);

// Adding an unreserved valid subdomain should succeed
const added = await ingressWithDomain.addIngressRule("vault", 8200);
assert.equal(added.subdomain, "vault");
assert.equal(added.hostname, "vault.example.test");
assert.equal(added.port, 8200);
assert.equal(added.url, "https://vault.example.test");

// Verify updated rules include vault but still exclude dash and ssh
const updatedRules = ingressWithDomain.getIngressRules();
assert.equal(updatedRules.length, 3);
assert.deepEqual(updatedRules.map((r) => r.subdomain), ["photos", "files", "vault"]);
assert.ok(!updatedRules.some((r) => r.subdomain === "ssh"));
assert.ok(!updatedRules.some((r) => r.subdomain === "dash"));
console.log("✔ addIngressRule prevents reserved 'ssh' and 'dash' subdomains and permits valid ones");

console.log("\n--- Running removeIngressRule Reserved Subdomain Guard Tests ---");
await assert.rejects(
	() => ingressWithDomain.removeIngressRule("ssh"),
	/Cannot remove protected system ingress rule for 'ssh'/,
);
await assert.rejects(
	() => ingressWithDomain.removeIngressRule("SSH"),
	/Cannot remove protected system ingress rule for 'ssh'/,
);
await assert.rejects(
	() => ingressWithDomain.removeIngressRule("dash"),
	/Cannot remove protected system ingress rule for 'dash'/,
);
assert.equal(await ingressWithDomain.removeIngressByPort(22), false);
assert.equal(await ingressWithDomain.removeIngressByPort(3001), false);

// Deleting an allowed custom rule should succeed
const removedVault = await ingressWithDomain.removeIngressRule("vault");
assert.equal(removedVault, true);
const postRemoveRules = ingressWithDomain.getIngressRules();
assert.equal(postRemoveRules.length, 2);
assert.deepEqual(postRemoveRules.map((r) => r.subdomain), ["photos", "files"]);
console.log("✔ removeIngressRule and removeIngressByPort protect system services 'ssh' and 'dash' while allowing custom rules");
