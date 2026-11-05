/**
 * Binds cookie-authenticated browser calls to the host that served them.
 * The session cookie stays host-only. Sibling names such as grafana.example.com
 * are a different origin and must not be able to drive dash.example.com.
 */

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function headerValue(value) {
	if (typeof value !== "string") return "";
	return value.split(",")[0].trim();
}

function requestProto(req) {
	const forwarded = req.headers && headerValue(req.headers["x-forwarded-proto"]);
	if (forwarded) return forwarded;
	if (req.socket && req.socket.encrypted) return "https";
	return "http";
}

function requestHost(req) {
	const raw = (req.headers && (headerValue(req.headers["x-forwarded-host"]) || headerValue(req.headers.host))) || "";
	if (!raw) return "";
	const proto = requestProto(req);
	if (proto === "https" && raw.endsWith(":443")) return raw.slice(0, -4);
	if (proto === "http" && raw.endsWith(":80")) return raw.slice(0, -3);
	return raw;
}

function originMatchesRequest(originValue, req) {
	if (!originValue || typeof originValue !== "string") return false;
	let parsed;
	try {
		parsed = new URL(originValue);
	} catch {
		return false;
	}
	const host = requestHost(req);
	if (!host) return false;
	return parsed.protocol === `${requestProto(req)}:` && parsed.host === host;
}

function stateChangingOriginAllowed(req) {
	if (!STATE_CHANGING.has(req.method)) return true;
	if (req.headers && req.headers.origin) return originMatchesRequest(req.headers.origin, req);
	const referer = req.headers && (req.headers.referer || req.headers.referrer);
	if (typeof referer === "string" && referer) {
		try {
			return originMatchesRequest(new URL(referer).origin, req);
		} catch {
			return false;
		}
	}
	return false;
}

function originGuard(req, res, next) {
	// Defense-in-depth: Reject cookie-authenticated /api requests with Sec-Fetch-Site: cross-site for ANY method (including GET)
	const pathname = req.path || (req.url ? new URL(req.url, "http://localhost").pathname : "");
	const isApi = pathname.startsWith("/api/") || pathname === "/api";
	const hasAuthCookie = Boolean(
		(req.cookies && req.cookies.token) ||
		(req.headers && typeof req.headers.cookie === "string" && /(?:^|;\s*)token=/.test(req.headers.cookie))
	);
	const secFetchSite = req.headers && req.headers["sec-fetch-site"];

	if (isApi && hasAuthCookie && typeof secFetchSite === "string" && secFetchSite.trim().toLowerCase() === "cross-site") {
		return res.status(403).json({ error: "Cross-site request rejected" });
	}

	if (!stateChangingOriginAllowed(req)) {
		return res.status(403).json({ error: "Cross-origin request rejected" });
	}
	next();
}

function websocketOriginAllowed(request) {
	return originMatchesRequest(request.headers && request.headers.origin, request);
}

module.exports = {
	originGuard,
	originMatchesRequest,
	stateChangingOriginAllowed,
	websocketOriginAllowed,
};
