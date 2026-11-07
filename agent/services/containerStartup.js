/**
 * Detects containers that die (or start crash-looping under a restart policy) right after
 * being started, so the API can report the real reason instead of a false "success".
 */

const DEFAULT_WATCH_MS = 3000;
const DEFAULT_POLL_MS = 500;
const LOG_TAIL_LINES = 30;

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Splits Docker's multiplexed (non-TTY) log buffer into plain text.
 * Each frame: [stream, 0, 0, 0, size (uint32 BE)] followed by `size` bytes.
 */
function demuxLogBuffer(buf) {
	if (!Buffer.isBuffer(buf)) return String(buf ?? "");
	const looksMultiplexed =
		buf.length >= 8 && buf[0] <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
	if (!looksMultiplexed) return buf.toString("utf8");

	const parts = [];
	let offset = 0;
	while (offset + 8 <= buf.length) {
		const size = buf.readUInt32BE(offset + 4);
		const start = offset + 8;
		const end = Math.min(start + size, buf.length);
		parts.push(buf.subarray(start, end).toString("utf8"));
		offset = end;
	}
	return parts.join("");
}

/** Picks the most useful single line from a crash log: the first error line, else the last line. */
function pickReason(logs) {
	const lines = String(logs)
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	if (lines.length === 0) return "";
	const errorLine = lines.find((l) => /\b(error|fatal|panic|exception)\b/i.test(l));
	return (errorLine ?? lines[lines.length - 1]).slice(0, 300);
}

function hasFailed(info) {
	const state = info?.State ?? {};
	return !state.Running || state.Restarting === true || (info.RestartCount ?? 0) > 0;
}

/**
 * Watches a just-started container for `watchMs`. Returns null when it stayed up, or
 * { exitCode, logs, reason } when it exited or began restarting.
 */
async function watchContainerStartup(container, options = {}) {
	const watchMs = options.watchMs ?? DEFAULT_WATCH_MS;
	const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
	const sleep = options.sleep ?? sleepMs;
	const now = options.now ?? Date.now;

	// Wall-clock deadline: `docker inspect` itself can be slow while a container initialises.
	const deadline = now() + watchMs;
	let info = null;
	for (;;) {
		try {
			info = await container.inspect();
		} catch {
			return null; // Can't tell (e.g. container vanished); don't invent a failure.
		}
		if (hasFailed(info)) break;
		const remaining = deadline - now();
		if (remaining <= 0) return null;
		await sleep(Math.min(pollMs, remaining));
	}

	let logs = "";
	try {
		const raw = await container.logs({
			stdout: true,
			stderr: true,
			follow: false,
			tail: LOG_TAIL_LINES,
		});
		logs = info.Config?.Tty ? Buffer.from(raw ?? "").toString("utf8") : demuxLogBuffer(raw);
	} catch {
		// Logs are best-effort.
	}

	// While a restart policy is looping, Docker has already started the next attempt, so
	// State.ExitCode no longer belongs to the crash; only report it for a plain exit.
	const state = info.State ?? {};
	const restarting = state.Running === true || state.Restarting === true;
	return {
		exitCode: restarting ? null : (state.ExitCode ?? null),
		restarting,
		logs: logs.trim(),
		reason: pickReason(logs),
	};
}

/** Builds the user-facing error for a startup failure. */
function describeStartupFailure(failure, { removed = false } = {}) {
	let msg = failure.restarting
		? "Container kept crashing and restarting, so it was stopped"
		: "Container stopped right after starting";
	if (failure.exitCode !== null && failure.exitCode !== undefined) {
		msg += ` (exit code ${failure.exitCode})`;
	}
	if (failure.reason) msg += `: ${failure.reason.replace(/[.\s]+$/, "")}`;
	msg += ".";
	if (removed) msg += " It was removed so you can fix the settings and run it again.";
	return msg;
}

module.exports = {
	watchContainerStartup,
	describeStartupFailure,
	demuxLogBuffer,
	pickReason,
};
