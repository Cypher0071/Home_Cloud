const pty = require("node-pty");
const os = require("os");
const cookie = require("cookie");
const jwt = require("jsonwebtoken");
const preferences = require("../services/preferences");

const BUFFER_BYTES = 5 * 1024 * 1024;
const MAX_SESSIONS = 16;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const sessions = new Map();

preferences.epochEvents.on("revoked", () => {
	closeAllSessions();
});

const SHELL_ENV_KEYS = [
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"TERM",
	"LANG",
	"LC_ALL",
	"XDG_RUNTIME_DIR",
	"TMPDIR",
	"TMP",
	"TEMP",
];

function shellEnvironment() {
	const env = {};
	for (const key of SHELL_ENV_KEYS) {
		if (process.env[key]) env[key] = process.env[key];
	}
	env.LANG = env.LANG || "C.UTF-8";
	env.LC_ALL = "C.UTF-8";
	env.TERM = env.TERM || "xterm-256color";
	env.PROMPT_EOL_MARK = "";
	for (const key of Object.keys(env)) {
		if (key.endsWith("_SECRET") || key.endsWith("_TOKEN") || key === "PASSWORD") {
			delete env[key];
		}
	}
	delete env.PASSWORD;
	delete env.JWT_SECRET;
	delete env.GITHUB_TOKEN;
	return env;
}

class TerminalBuffer {
	constructor(maxBytes = BUFFER_BYTES) {
		this.maxBytes = maxBytes;
		this.buf = Buffer.allocUnsafe(maxBytes);
		this.start = 0;
		this.length = 0;
	}

	write(data) {
		if (data == null || data === "") return;
		const chunk = Buffer.isBuffer(data)
			? data
			: Buffer.from(String(data), "utf8");
		if (chunk.length === 0) return;

		if (chunk.length >= this.maxBytes) {
			chunk.copy(this.buf, 0, chunk.length - this.maxBytes);
			this.start = 0;
			this.length = this.maxBytes;
			return;
		}

		const overflow = this.length + chunk.length - this.maxBytes;
		if (overflow > 0) {
			this.start = (this.start + overflow) % this.maxBytes;
			this.length -= overflow;
		}

		const writePos = (this.start + this.length) % this.maxBytes;
		const firstPart = Math.min(chunk.length, this.maxBytes - writePos);
		chunk.copy(this.buf, writePos, 0, firstPart);
		if (firstPart < chunk.length) {
			chunk.copy(this.buf, 0, firstPart);
		}
		this.length += chunk.length;
	}

	get() {
		if (this.length === 0) return "";

		let skip = 0;
		while (skip < this.length && skip < 4) {
			const byte = this.buf[(this.start + skip) % this.maxBytes];
			if ((byte & 0xc0) !== 0x80) break;
			skip++;
		}

		const len = this.length - skip;
		if (len === 0) return "";
		const start = (this.start + skip) % this.maxBytes;

		if (start + len <= this.maxBytes) {
			return this.buf.toString("utf8", start, start + len);
		}

		const first = this.buf.subarray(start, this.maxBytes);
		const second = this.buf.subarray(0, start + len - this.maxBytes);
		return Buffer.concat([first, second]).toString("utf8");
	}
}

class TerminalSession {
	constructor(idOrWs, authEpoch) {
		if (typeof idOrWs === "string") {
			this.id = idOrWs;
			this.clients = new Set();
		} else if (idOrWs && typeof idOrWs === "object") {
			this.id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			this.clients = new Set([idOrWs]);
			this.ws = idOrWs;
		} else {
			this.id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			this.clients = new Set();
		}

		this.authEpoch = authEpoch;
		this.terminal = null;
		this.buffer = new TerminalBuffer();
		this.cols = 100;
		this.rows = 30;
		this.lastRespawnTime = 0;
		this.respawnCount = 0;
		this.shell =
			os.platform() === "win32"
				? "powershell.exe"
				: process.env.SHELL || "bash";

		sessions.set(this.id, this);
	}

	ensurePTY(cols = 100, rows = 30) {
		if (cols > 0 && rows > 0) {
			this.cols = cols;
			this.rows = rows;
		}

		if (this.terminal) {
			this.resize(cols, rows);
			return;
		}

		const isZsh = /zsh$/i.test(this.shell);
		const args = isZsh ? ["-o", "NO_PROMPT_SP", "-o", "NO_PROMPT_CR"] : [];
		let ptyInstance;
		try {
			ptyInstance = pty.spawn(this.shell, args, {
				name: "xterm-256color",
				cols: this.cols || 100,
				rows: this.rows || 30,
				cwd: process.env.HOME || process.cwd(),
				env: shellEnvironment(),
			});
		} catch (err) {
			console.error(`[Terminal] Failed to spawn PTY for session ${this.id}:`, err);
			return;
		}

		this.terminal = ptyInstance;

		if (typeof ptyInstance.on === "function") {
			ptyInstance.on("error", (err) => {
				console.error(`[Terminal] PTY error for session ${this.id}:`, err?.message || err);
			});
		}

		ptyInstance.onData((data) => {
			if (this.terminal !== ptyInstance) return;
			this.buffer.write(data);
			this._broadcast(data);
		});

		ptyInstance.onExit(() => {
			if (this.terminal !== ptyInstance) return;
			this.terminal = null;
			this._onProcessExit();
		});
	}

	createPTY(cols = 100, rows = 30) {
		this.ensurePTY(cols, rows);
	}

	attach(ws) {
		this.clients.add(ws);

		const snapshot = this.buffer.get();
		const restored = Boolean(this.terminal);
		try {
			ws.send(JSON.stringify({ type: "session", restored }));
			if (restored && snapshot) {
				ws.send(snapshot);
			}
		} catch {}
	}

	detach(ws) {
		this.clients.delete(ws);
	}

	_pruneClients() {
		for (const client of this.clients) {
			if (client.readyState !== 1) {
				this.clients.delete(client);
			}
		}
		return this.clients.size;
	}

	_broadcast(data) {
		for (const client of this.clients) {
			if (client.readyState === 1) {
				try {
					client.send(data);
				} catch {}
			}
		}
	}

	resize(cols, rows) {
		if (cols > 0 && rows > 0) {
			this.cols = cols;
			this.rows = rows;
			if (this.terminal) {
				try {
					this.terminal.resize(cols, rows);
				} catch {}
			}
		}
	}

	write(data) {
		if (this.terminal) {
			try {
				this.terminal.write(data);
			} catch {}
		}
	}

	writeTerminal(data) {
		this.write(data);
	}

	kill() {
		const term = this.terminal;
		this.terminal = null;
		if (term) {
			try {
				term.kill();
			} catch {}
		}
		this._onProcessExit();
	}

	destroy() {
		if (sessions.get(this.id) === this) {
			sessions.delete(this.id);
		}
		const term = this.terminal;
		this.terminal = null;
		if (term) {
			try {
				term.kill();
			} catch {}
		}
		if (this.timer) {
			try { clearTimeout(this.timer); } catch {}
			this.timer = null;
		}
		for (const client of this.clients) {
			try {
				client.close(4401, "Session revoked");
			} catch {
				try { client.close(); } catch {}
			}
		}
		this.clients.clear();
	}

	_onProcessExit() {
		this.terminal = null;
		const activeClients = this._pruneClients();

		if (activeClients > 0) {
			const now = Date.now();
			if (now - this.lastRespawnTime < 1000) {
				this.respawnCount = (this.respawnCount || 0) + 1;
			} else {
				this.respawnCount = 0;
			}
			this.lastRespawnTime = now;

			if (this.respawnCount > 5) {
				console.error(`[Terminal] Session ${this.id} exited repeatedly, halting auto-restart.`);
				if (sessions.get(this.id) === this) {
					sessions.delete(this.id);
				}
				for (const socket of this.clients) {
					if (socket.readyState === 1) {
						try {
							socket.send(JSON.stringify({ type: "exit" }));
						} catch {}
						try {
							socket.close();
						} catch {}
					}
				}
				this.clients.clear();
				return;
			}

			// Clear scrollback buffer for fresh clean session
			this.buffer = new TerminalBuffer();
			this.ensurePTY(this.cols, this.rows);

			const payload = JSON.stringify({ type: "session", restored: false });
			for (const client of this.clients) {
				if (client.readyState === 1) {
					try {
						client.send(payload);
					} catch {}
				}
			}
		} else {
			if (sessions.get(this.id) === this) {
				sessions.delete(this.id);
			}
			this.clients.clear();
		}
	}
}

function evictDetachedSession() {
	for (const session of sessions.values()) {
		if (session.clients.size === 0) {
			sessions.delete(session.id);
			const term = session.terminal;
			session.terminal = null;
			if (term) {
				try {
					term.kill();
				} catch {}
			}
			return true;
		}
	}
	return false;
}

function handleSystemTerminal(ws, request) {
	if (typeof ws.on === "function") {
		ws.on("error", (err) => {
			console.warn("[ws/terminal] socket error:", err?.message || err);
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

	let authEpoch;
	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		if (!decoded || decoded.epoch !== preferences.getSessionEpoch()) {
			ws.close();
			return;
		}
		authEpoch = decoded.epoch;
	} catch {
		ws.close();
		return;
	}

	const url = new URL(request.url, "http://localhost");
	const sessionId = url.searchParams.get("sessionId");
	if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
		ws.close();
		return;
	}

	let session = sessions.get(sessionId);
	if (session && session.authEpoch !== authEpoch) {
		session.destroy();
		session = null;
	}

	if (!session) {
		if (sessions.size >= MAX_SESSIONS && !evictDetachedSession()) {
			ws.close();
			return;
		}
		session = new TerminalSession(sessionId, authEpoch);
	}

	session.attach(ws);

	const onRevoked = (newEpoch) => {
		if (newEpoch !== authEpoch) {
			try {
				session.detach(ws);
				session.destroy();
			} catch {
				try { session.kill(); } catch {}
			}
			try {
				ws.close(4401, "Session revoked");
			} catch {}
		}
	};

	preferences.epochEvents.on("revoked", onRevoked);

	if (typeof ws.on === "function") {
		ws.on("message", (data) => {
			if (preferences.getSessionEpoch() !== authEpoch) {
				try {
					session.detach(ws);
					session.destroy();
				} catch {
					try { session.kill(); } catch {}
				}
				try {
					ws.close(4401, "Session revoked");
				} catch {}
				return;
			}
			const msgStr = data.toString();
			try {
				const parsed = JSON.parse(msgStr);
				if (parsed && parsed.type === "resize") {
					const cols = Math.floor(Number(parsed.cols));
					const rows = Math.floor(Number(parsed.rows));
					if (cols > 0 && rows > 0) {
						session.ensurePTY(cols, rows);
					}
					return;
				}
				if (parsed && parsed.type === "kill") {
					session.kill();
					return;
				}
			} catch {}
			session.ensurePTY();
			session.write(msgStr);
		});

		ws.on("close", () => {
			preferences.epochEvents.off("revoked", onRevoked);
			session.detach(ws);
			if (!session.terminal && sessions.get(sessionId) === session) {
				sessions.delete(sessionId);
			}
		});
	}
}

/**
 * Clean up all active host terminal PTY sessions.
 * Called during graceful shutdown so no orphaned node-pty processes survive.
 *
 * @returns {number} Number of sessions terminated
 */
function closeAllSessions() {
	const count = sessions.size;
	const activeList = Array.from(sessions.values());
	for (const session of activeList) {
		try {
			session.destroy();
		} catch (err) {
			console.error("[terminal] Error destroying PTY session:", err.message);
		}
	}
	sessions.clear();
	return count;
}

module.exports = {
	handleSystemTerminal,
	closeAllSessions,
	shellEnvironment,
	TerminalBuffer,
	BUFFER_BYTES,
	TerminalSession,
	PTY: TerminalSession, // alias for backwards/test compatibility
	activeSessions: sessions,
	getActiveSessionsCount: () => sessions.size,
	sessions,
	_resetTerminalForTesting: () => {
		closeAllSessions();
	},
};
