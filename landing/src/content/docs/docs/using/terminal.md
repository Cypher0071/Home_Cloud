---
title: Terminal
description: The host web terminal and the per-container console, how their sessions behave, and their limits.
sidebar:
  order: 3
---

Home Cloud has two terminals. The **Terminal** app is a shell on the host. The **Console** tab in Docker Manager is a shell inside one container. Both are real pseudo-terminals, so full-screen programs such as `vim`, `htop` and `less` work.

:::danger
Anyone who signs in to the dashboard gets a shell on your machine as the Home Cloud user. That user is in the `docker` group, which is root-equivalent. Read the [threat model](/docs/security/threat-model/).
:::

## Host terminal

Open the Terminal app. The agent starts a shell with `node-pty` and connects it to your browser over a WebSocket at `/terminal`.

### What the shell is

- **User:** the Linux user the service runs as. It is never root. The installer's systemd unit runs it as the install user.
- **Shell:** the `SHELL` variable of the service. The installer's unit sets `/bin/bash`. If `SHELL` is unset, the agent falls back to `bash`.
- **Start directory:** the user's home directory.
- **`sudo`:** works the way it does in any terminal. It asks for the user's password if the account needs one.

The shell does not inherit the service's full environment. The agent passes only `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `LANG`, `LC_ALL`, `XDG_RUNTIME_DIR`, `TMPDIR`, `TMP` and `TEMP`. `PASSWORD`, `JWT_SECRET` and `GITHUB_TOKEN` are removed, along with any variable ending in `_SECRET` or `_TOKEN`.

:::caution
This keeps secrets out of `env`. It does not stop the shell from reading `agent/.env`, which is a normal file owned by the same user.
:::

### Sessions

The dashboard always asks for the same session, named `term_main`. This has three effects.

1. **Closing the browser does not end your shell.** The process keeps running on the host. When you open the Terminal again, you reattach to it.
2. **Replay.** The agent keeps the last 5 MiB of output per session. On reattach, you see that output again.
3. **Every device shares one shell.** Open the Terminal on your phone and your laptop and both show the same session, and both can type into it.

Other rules the agent enforces:

| Rule | Detail |
| --- | --- |
| Session limit | 16 sessions at once. When the limit is hit, a session with no browser attached is closed to make room. |
| Shell exits | If you type `exit` while a browser is attached, the agent starts a fresh shell and clears the scrollback. |
| Crash loop | If the shell exits more than 5 times in quick succession, the agent stops restarting it and closes the connection. |
| Message size | A single WebSocket message is limited to 1 MiB. A very large paste can close the connection. |

Sessions end when you sign out or revoke sessions, when the service stops or restarts, and when an [update](/docs/using/updates/) restarts the service. The shell and everything running in it is killed. Use `tmux` or `screen` for work that must survive those events.

### The toolbar

| Button | What it does |
| --- | --- |
| Clear | Sends `Ctrl+L` to the shell |
| Kill | Ends the shell process and starts a new one with empty scrollback |
| Reconnect | Reopens the WebSocket to the same session |

If the connection drops, the dashboard reconnects on its own. It waits 0.5 seconds, then doubles the wait after each failure, up to 15 seconds. The status dot is green when connected.

On a phone, a row of touch keys appears under the terminal: `Esc`, `Tab`, `Ctrl+C`, `Clear`, up and down.

## Container console

In Docker Manager, select a running container and open the **Console** tab. The agent runs a TTY shell inside the container with Docker's exec API:

```text
/bin/sh -c 'if [ -x /bin/bash ]; then exec /bin/bash; else exec /bin/sh; fi'
```

So you get `bash` when the image has it and `sh` otherwise. The console has these limits:

- **Images without a shell** (for example, distroless images) cannot open a console.
- **The user is the container's default user.** The agent does not set one.
- **No persistence.** Closing the page or losing the connection ends the shell. There is no scrollback replay. The dashboard keeps the console connected while you switch between the Stats, Inspect and Logs tabs.
- **Running containers only.** Docker cannot start an exec session in a stopped container, so start it first.

## Security behavior

- Both sockets need the session cookie. The agent also checks that the WebSocket's `Origin` matches the dashboard's host and rejects it otherwise.
- When sessions are revoked, open terminal and console sockets are closed with code 4401 and host sessions are destroyed. A session cannot be reattached by an older login.

See [Sessions and login](/docs/security/sessions/) for the details.
