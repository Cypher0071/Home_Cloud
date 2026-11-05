const preferences = require("./preferences");

/**
 * Ends a long-lived HTTP response (SSE or chunked stream) as soon as the session it was
 * authorised under is revoked (logout, logout-all, password change bump the session epoch).
 *
 * Call it right after authMiddleware has set req.user. `onRevoked` runs once, before
 * res.end(), so the caller can stop its timers, child processes or Docker streams.
 * Returns an unbind function; the listener is also removed when the request or response closes.
 */
function bindStreamToSession(req, res, onRevoked) {
	const authEpoch = req.user?.epoch;
	let finished = false;

	const unbind = () => {
		preferences.epochEvents.off("revoked", onEpochRevoked);
	};

	function onEpochRevoked(newEpoch) {
		if (finished || newEpoch === authEpoch) return;
		finished = true;
		unbind();
		try {
			if (typeof onRevoked === "function") onRevoked();
		} catch (_) {}
		if (!res.writableEnded) {
			try {
				res.end();
			} catch (_) {}
		}
	}

	preferences.epochEvents.on("revoked", onEpochRevoked);
	req.on("close", unbind);
	res.on("close", unbind);
	return unbind;
}

module.exports = { bindStreamToSession };
