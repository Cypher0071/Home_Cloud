const Docker = require("dockerode");
const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const cookie = require("cookie");
const jwt = require("jsonwebtoken");
const preferences = require("../services/preferences");

function handleContainerExec(ws, request) {
	if (typeof ws.on === "function") {
		ws.on("error", (err) => {
			console.warn("[ws/containerExec] socket error:", err?.message || err);
			try {
				ws.terminate();
			} catch (_) {}
		});
	}

	const cookies = cookie.parse(request.headers?.cookie || "");
	const token = cookies.token;
	if (!token) {
		ws.close();
		return;
	}

	jwt.verify(token, process.env.JWT_SECRET, async (err, decodedtoken) => {
		if (err || !decodedtoken || decodedtoken.epoch !== preferences.getSessionEpoch()) {
			ws.close();
			return;
		}

		const authEpoch = decodedtoken.epoch;

		try {
			const url = new URL(request.url, "http://localhost");
			const containerId = url.searchParams.get("containerId");

			if (!containerId) {
				try {
					ws.send("\r\nError: Missing containerId parameter\r\n");
				} catch (_) {}
				ws.close();
				return;
			}

			const container = docker.getContainer(containerId);

			// Launch shell with automatic fallback: uses /bin/bash if available, else /bin/sh
			const exec = await container.exec({
				AttachStdin: true,
				AttachStdout: true,
				AttachStderr: true,
				Tty: true,
				Env: ["TERM=xterm-256color"],
				Cmd: ["/bin/sh", "-c", "if [ -x /bin/bash ]; then exec /bin/bash; else exec /bin/sh; fi"],
			});

			const stream = await exec.start({
				hijack: true,
				stdin: true,
				Tty: true,
			});

			if (!stream) {
				try {
					ws.send("\r\nError: Failed to create exec stream\r\n");
				} catch (_) {}
				ws.close();
				return;
			}

			let isRevoked = false;
			const terminateExec = () => {
				if (isRevoked) return;
				isRevoked = true;
				try {
					stream.destroy();
				} catch (_) {
					try {
						stream.end();
					} catch (_) {}
				}
				try {
					ws.close(4401, "Session revoked");
				} catch (_) {}
			};

			const onRevoked = (newEpoch) => {
				if (newEpoch !== authEpoch) {
					preferences.epochEvents.off("revoked", onRevoked);
					terminateExec();
				}
			};

			preferences.epochEvents.on("revoked", onRevoked);

			// Forward stdout/stderr from container stream to WebSocket
			stream.on("data", (chunk) => {
				if (ws.readyState === 1) { // WebSocket.OPEN
					try {
						ws.send(chunk.toString("utf-8"));
					} catch (_) {}
				}
			});

			stream.on("end", () => {
				preferences.epochEvents.off("revoked", onRevoked);
				try {
					ws.close();
				} catch (_) {}
			});

			stream.on("error", (err) => {
				console.error("Container exec stream error:", err);
				preferences.epochEvents.off("revoked", onRevoked);
				try {
					ws.close();
				} catch (_) {}
			});

			// Forward client keystrokes and resize events to container exec
			if (typeof ws.on === "function") {
				ws.on("message", (message) => {
					if (preferences.getSessionEpoch() !== authEpoch) {
						preferences.epochEvents.off("revoked", onRevoked);
						terminateExec();
						return;
					}
					const str = message.toString();
					try {
						const parsed = JSON.parse(str);
						if (parsed.type === "resize" && parsed.cols && parsed.rows) {
							exec.resize({ w: parsed.cols, h: parsed.rows }).catch(() => {});
							return;
						}
					} catch (e) {
						// Not JSON, treat as standard stdin input
					}
					try {
						stream.write(str);
					} catch (_) {}
				});

				ws.on("close", () => {
					preferences.epochEvents.off("revoked", onRevoked);
					try {
						stream.end();
					} catch (e) {}
				});
			}
		} catch (globalErr) {
			console.error("Exec connection error:", globalErr);
			try {
				ws.send(`\r\nError starting container console: ${globalErr.message}\r\n`);
			} catch (_) {}
			try {
				ws.close();
			} catch (_) {}
		}
	});
}

module.exports = {
	handleContainerExec,
};
