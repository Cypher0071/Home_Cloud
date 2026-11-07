import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	watchContainerStartup,
	describeStartupFailure,
	demuxLogBuffer,
	pickReason,
} = require("../services/containerStartup.js");

// Fake clock: sleeping advances time, so watch windows are deterministic and instant.
let fakeTime = 0;
const noSleep = async (ms = 0) => { fakeTime += ms; };
const clock = { sleep: noSleep, now: () => fakeTime };

function frame(stream, text) {
	const body = Buffer.from(text, "utf8");
	const header = Buffer.alloc(8);
	header[0] = stream;
	header.writeUInt32BE(body.length, 4);
	return Buffer.concat([header, body]);
}

// What the official postgres image prints when POSTGRES_PASSWORD is missing.
const POSTGRES_NO_PASSWORD_LOG = [
	"Error: Database is uninitialized and superuser password is not specified.",
	"       You must specify POSTGRES_PASSWORD to a non-empty value for the",
	"       superuser. For example, \"-e POSTGRES_PASSWORD=password\" on \"docker run\".",
	"",
].join("\n");

function fakeContainer(states, logsBuffer = Buffer.alloc(0), { tty = false } = {}) {
	let i = 0;
	return {
		inspectCalls: 0,
		async inspect() {
			this.inspectCalls++;
			const s = states[Math.min(i++, states.length - 1)];
			return { State: s.State, RestartCount: s.RestartCount ?? 0, Config: { Tty: tty } };
		},
		async logs() {
			return logsBuffer;
		},
	};
}

// 1. demux of multiplexed (non-TTY) logs
{
	const buf = Buffer.concat([frame(2, "line one\n"), frame(1, "line two\n")]);
	assert.equal(demuxLogBuffer(buf), "line one\nline two\n");
	assert.equal(demuxLogBuffer(Buffer.from("plain tty output\n")), "plain tty output\n");
	console.log("✓ demuxLogBuffer handles multiplexed and raw output");
}

// 2. reason picks the error line, not the trailing hint lines
{
	assert.equal(
		pickReason(POSTGRES_NO_PASSWORD_LOG),
		"Error: Database is uninitialized and superuser password is not specified.",
	);
	assert.equal(pickReason("starting\nlistening failed: EADDRINUSE"), "listening failed: EADDRINUSE");
	assert.equal(pickReason(""), "");
	console.log("✓ pickReason picks the error line");
}

// 3. a container that exits (postgres without password) is reported with its reason
{
	const c = fakeContainer(
		[
			{ State: { Running: true, Restarting: false } },
			{ State: { Running: false, Restarting: false, Status: "exited", ExitCode: 1 } },
		],
		frame(2, POSTGRES_NO_PASSWORD_LOG),
	);
	const failure = await watchContainerStartup(c, { watchMs: 3000, pollMs: 500, ...clock });
	assert.ok(failure, "exit must be detected");
	assert.equal(failure.exitCode, 1);
	assert.match(failure.reason, /superuser password is not specified/);
	assert.match(failure.logs, /POSTGRES_PASSWORD/);
	const msg = describeStartupFailure(failure, { removed: true });
	assert.match(msg, /exit code 1/);
	assert.match(msg, /superuser password/);
	assert.match(msg, /removed/);
	console.log("✓ exited container reported with exit code and reason");
}

// 4. a crash-loop under a restart policy is detected even while Docker shows it "running"
{
	const c = fakeContainer(
		[
			{ State: { Running: true, Restarting: false } },
			{ State: { Running: true, Restarting: false, ExitCode: 1 }, RestartCount: 1 },
		],
		frame(2, POSTGRES_NO_PASSWORD_LOG),
	);
	const failure = await watchContainerStartup(c, { watchMs: 3000, pollMs: 500, ...clock });
	assert.ok(failure, "restart loop must be detected via RestartCount");
	assert.equal(failure.restarting, true);
	assert.equal(failure.exitCode, null, "ExitCode of the next attempt must not be reported");
	const msg = describeStartupFailure(failure);
	assert.match(msg, /kept crashing and restarting/);
	assert.doesNotMatch(msg, /exit code/);
	assert.doesNotMatch(msg, /\.\./, "no double period");

	const c2 = fakeContainer([{ State: { Running: true, Restarting: true, ExitCode: 1 } }]);
	assert.ok(await watchContainerStartup(c2, { ...clock }), "Restarting state must be detected");
	console.log("✓ restart loop detected");
}

// 5. a healthy container passes after the watch window
{
	const c = fakeContainer([{ State: { Running: true, Restarting: false } }]);
	const failure = await watchContainerStartup(c, { watchMs: 3000, pollMs: 500, ...clock });
	assert.equal(failure, null);
	assert.equal(c.inspectCalls, 7, "polls across the whole window (0..3000ms every 500ms)");
	console.log("✓ healthy container passes");
}

// 6. TTY containers return raw logs; inspect errors don't invent a failure
{
	const c = fakeContainer(
		[{ State: { Running: false, ExitCode: 2 } }],
		Buffer.from("fatal: bad config\n"),
		{ tty: true },
	);
	const failure = await watchContainerStartup(c, { ...clock });
	assert.equal(failure.reason, "fatal: bad config");

	const gone = { inspect: async () => { throw new Error("no such container"); } };
	assert.equal(await watchContainerStartup(gone, { ...clock }), null);
	console.log("✓ TTY logs and inspect errors handled");
}

console.log("All container startup watch tests passed.");
