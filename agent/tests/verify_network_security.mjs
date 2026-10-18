import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { app } from "../index.js";

console.log("--- Running Network Security & Ping Endpoint Verification Tests ---");

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.JWT_SECRET = JWT_SECRET;

// Start ephemeral server
const testServer = http.createServer(app);
await new Promise((resolve) => testServer.listen(0, "127.0.0.1", resolve));
const address = testServer.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

const validToken = jwt.sign({ authorized: true }, JWT_SECRET, { expiresIn: "1h" });

try {
	// Test 1: GET /api/ping unauthenticated -> 200 { status: "ok" } + CORS + PNA headers
	console.log("[Test 1] GET /api/ping responds 200 with sanitized status and CORS/PNA headers");
	const pingRes = await fetch(`${baseUrl}/api/ping`);
	assert.equal(pingRes.status, 200, "Expected 200 status for /api/ping");
	assert.equal(pingRes.headers.get("access-control-allow-origin"), "*", "Expected CORS Allow-Origin: *");
	assert.equal(pingRes.headers.get("access-control-allow-private-network"), "true", "Expected PNA header");
	const pingData = await pingRes.json();
	assert.deepEqual(pingData, { status: "ok" }, "Expected payload to strictly be { status: 'ok' }");
	console.log("  ✔ /api/ping returns 200 with zero sensitive metadata.");

	// Test 2: OPTIONS /api/ping preflight -> 204 No Content with PNA header
	console.log("[Test 2] OPTIONS /api/ping handles Chromium PNA preflight correctly");
	const pingOptionsRes = await fetch(`${baseUrl}/api/ping`, {
		method: "OPTIONS",
		headers: {
			"Access-Control-Request-Method": "GET",
			"Access-Control-Request-Private-Network": "true",
			Origin: "https://dash.home-cloud.live",
		},
	});
	assert.equal(pingOptionsRes.status, 204, "Expected 204 for OPTIONS /api/ping");
	assert.equal(pingOptionsRes.headers.get("access-control-allow-private-network"), "true", "Expected PNA header on preflight");
	console.log("  ✔ OPTIONS /api/ping returns 204 with Private Network Access enabled.");

	// Test 3: GET /api/health unauthenticated -> 200 { status: "ok", shuttingDown: false } without tunnel details
	console.log("[Test 3] GET /api/health is sanitized and does NOT leak tunnel info");
	const healthRes = await fetch(`${baseUrl}/api/health`);
	assert.equal(healthRes.status, 200, "Expected 200 status for /api/health");
	const healthData = await healthRes.json();
	assert.equal(healthData.status, "ok", "Expected status ok");
	assert.equal("tunnel" in healthData, false, "Expected 'tunnel' to NOT be present in public /api/health");
	console.log("  ✔ /api/health returns sanitized healthcheck without disclosing tunnel details.");

	// Test 4: GET /api/network/info unauthenticated -> 401 Unauthorized
	console.log("[Test 4] GET /api/network/info unauthenticated returns 401 Unauthorized");
	const unauthInfoRes = await fetch(`${baseUrl}/api/network/info`);
	assert.equal(unauthInfoRes.status, 401, "Expected 401 Unauthorized for unauthenticated /api/network/info");
	const unauthInfoData = await unauthInfoRes.json();
	assert.equal(unauthInfoData.error, "Unauthorized", "Expected error: Unauthorized");
	assert.equal("baseDir" in unauthInfoData, false, "Must NOT leak baseDir");
	assert.equal("serverLocalIp" in unauthInfoData, false, "Must NOT leak serverLocalIp");
	assert.equal("tunnel" in unauthInfoData, false, "Must NOT leak tunnel");
	console.log("  ✔ Unauthenticated access to /api/network/info strictly blocked.");

	// Test 5: GET /api/network/info with invalid token -> 401 Unauthorized
	console.log("[Test 5] GET /api/network/info with invalid cookie returns 401");
	const invalidInfoRes = await fetch(`${baseUrl}/api/network/info`, {
		headers: { Cookie: "token=invalid.jwt.token" },
	});
	assert.equal(invalidInfoRes.status, 401, "Expected 401 for invalid JWT");
	console.log("  ✔ Invalid token rejected on /api/network/info.");

	// Test 6: GET /api/network/info with valid token -> 200 with full host details
	console.log("[Test 6] GET /api/network/info with valid auth cookie returns full metadata");
	const authInfoRes = await fetch(`${baseUrl}/api/network/info`, {
		headers: { Cookie: `token=${validToken}` },
	});
	assert.equal(authInfoRes.status, 200, "Expected 200 for authenticated /api/network/info");
	const authInfoData = await authInfoRes.json();
	assert.equal(authInfoData.status, "ok", "Expected status ok");
	assert.ok("serverLocalIp" in authInfoData, "Expected serverLocalIp in authenticated payload");
	assert.ok("serverLocalPort" in authInfoData, "Expected serverLocalPort in authenticated payload");
	assert.ok("baseDir" in authInfoData, "Expected baseDir in authenticated payload");
	assert.ok("cfDomain" in authInfoData, "Expected cfDomain in authenticated payload");
	assert.ok("tunnel" in authInfoData, "Expected tunnel in authenticated payload");
	console.log("  ✔ Authenticated session successfully accesses full network metadata.");

	// Test 7: GET /api/network/tunnel unauthenticated -> 401
	console.log("[Test 7] GET /api/network/tunnel unauthenticated returns 401");
	const unauthTunnelRes = await fetch(`${baseUrl}/api/network/tunnel`);
	assert.equal(unauthTunnelRes.status, 401, "Expected 401 for unauthenticated /api/network/tunnel");
	console.log("  ✔ Unauthenticated access to /api/network/tunnel strictly blocked.");

	// Test 8: GET /api/network/tunnel authenticated -> 200
	console.log("[Test 8] GET /api/network/tunnel authenticated returns 200 with tunnel status");
	const authTunnelRes = await fetch(`${baseUrl}/api/network/tunnel`, {
		headers: { Cookie: `token=${validToken}` },
	});
	assert.equal(authTunnelRes.status, 200, "Expected 200 for authenticated /api/network/tunnel");
	const authTunnelData = await authTunnelRes.json();
	assert.ok("tunnel" in authTunnelData, "Expected tunnel status in authenticated payload");
	console.log("  ✔ Authenticated session accesses tunnel status.");

	console.log("\n✅ All 8 Network Security & LAN Detection tests passed successfully!");
} finally {
	await new Promise((resolve) => testServer.close(resolve));
}
