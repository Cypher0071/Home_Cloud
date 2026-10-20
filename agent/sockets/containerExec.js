const Docker = require("dockerode");
const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const cookie = require("cookie");
const jwt = require("jsonwebtoken");
const preferences = require("../services/preferences");

function handleContainerExec(ws, request) {
	const cookies = cookie.parse(request.headers.cookie || "");
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

		try {
			const url = new URL(request.url, "http://localhost");
			const containerId = url.searchParams.get("containerId");

			if (!containerId) {
				ws.send("\r\nError: Missing containerId parameter\r\n");
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
				ws.send("\r\nError: Failed to create exec stream\r\n");
				ws.close();
				return;
			}

			// Forward stdout/stderr from container stream to WebSocket
			stream.on("data", (chunk) => {
				if (ws.readyState === 1) { // WebSocket.OPEN
					ws.send(chunk.toString("utf-8"));
				}
			});

			stream.on("end", () => {
				ws.close();
			});

			stream.on("error", (err) => {
				console.error("Container exec stream error:", err);
				ws.close();
			});

			// Forward client keystrokes and resize events to container exec
			ws.on("message", (message) => {
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
				stream.write(str);
			});

			ws.on("close", () => {
				try {
					stream.end();
				} catch (e) {}
			});
		} catch (globalErr) {
			console.error("Exec connection error:", globalErr);
			ws.send(`\r\nError starting container console: ${globalErr.message}\r\n`);
			ws.close();
		}
	});
}

module.exports = {
	handleContainerExec,
};
