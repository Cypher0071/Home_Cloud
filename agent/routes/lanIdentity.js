const crypto = require("node:crypto");
const express = require("express");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

const NONCE_REGEX = /^[0-9a-fA-F]{32,64}$/;
const PROOF_REGEX = /^[0-9a-fA-F]{64}$/;
const KEY_LABEL = "home-cloud:lan-identity-proof-v1";

function getDerivedKey() {
	const secret = process.env.JWT_SECRET;
	if (!secret || typeof secret !== "string") {
		return null;
	}
	// Derive per-install identity key from JWT_SECRET with fixed label
	return crypto.createHmac("sha256", secret).update(KEY_LABEL).digest();
}

function computeProof(key, nonce) {
	return crypto.createHmac("sha256", key).update(nonce.toLowerCase()).digest("hex");
}

function setCorsHeaders(res) {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");
	res.setHeader("Access-Control-Allow-Private-Network", "true");
}

// Unauthenticated challenge proof endpoint called across LAN
router.options("/proof", (req, res) => {
	setCorsHeaders(res);
	res.sendStatus(204);
});

// The proof must only be obtainable by talking to this machine directly on the LAN.
// Requests that arrive through Cloudflare Tunnel (cloudflared connects from loopback and adds
// CF-* headers) are refused; otherwise a fake LAN responder could relay the nonce through the
// public hostname and obtain a valid proof.
function isLoopbackPeer(req) {
	let addr = req.socket?.remoteAddress || "";
	if (addr.startsWith("::ffff:")) addr = addr.slice(7);
	return addr === "::1" || addr.startsWith("127.");
}

function cameThroughTunnel(req) {
	return Boolean(req.headers["cf-connecting-ip"] || req.headers["cf-ray"] || req.headers["cdn-loop"]);
}

router.get("/proof", (req, res) => {
	setCorsHeaders(res);

	if (isLoopbackPeer(req) || cameThroughTunnel(req)) {
		return res.status(403).json({ error: "LAN identity proof is only served to direct LAN clients" });
	}

	const nonce = req.query.nonce;
	if (!nonce || typeof nonce !== "string" || !NONCE_REGEX.test(nonce)) {
		return res.status(400).json({ error: "Invalid nonce: must be 32 to 64 hexadecimal characters" });
	}

	const key = getDerivedKey();
	if (!key) {
		return res.status(500).json({ error: "Server authentication key unavailable" });
	}

	const proof = computeProof(key, nonce);
	return res.json({ proof });
});

// Authenticated challenge verification endpoint called on current trusted origin
function ensureAuthenticated(req, res, next) {
	if (req.user) {
		return next();
	}
	return authMiddleware(req, res, next);
}

router.post("/verify", ensureAuthenticated, (req, res) => {
	const { nonce, proof } = req.body || {};

	if (!nonce || typeof nonce !== "string" || !NONCE_REGEX.test(nonce)) {
		return res.status(400).json({ valid: false, error: "Invalid nonce: must be 32 to 64 hexadecimal characters" });
	}

	if (!proof || typeof proof !== "string" || !PROOF_REGEX.test(proof)) {
		return res.status(400).json({ valid: false, error: "Invalid proof format: must be 64 hexadecimal characters" });
	}

	const key = getDerivedKey();
	if (!key) {
		return res.status(500).json({ valid: false, error: "Server authentication key unavailable" });
	}

	const expectedProof = computeProof(key, nonce);

	let valid = false;
	try {
		const proofBuf = Buffer.from(proof.toLowerCase(), "hex");
		const expectedBuf = Buffer.from(expectedProof, "hex");
		if (proofBuf.length === expectedBuf.length && crypto.timingSafeEqual(proofBuf, expectedBuf)) {
			valid = true;
		}
	} catch {
		valid = false;
	}

	return res.json({ valid });
});

module.exports = router;
