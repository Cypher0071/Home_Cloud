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
