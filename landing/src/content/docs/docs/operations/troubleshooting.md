---
title: Troubleshooting
description: Fixes for the problems you are most likely to hit when installing and running Home Cloud.
sidebar:
  order: 3
---

Start with the service status and the logs. Most problems show up there.

## Check the service and logs

```bash
sudo systemctl status home-cloud
sudo journalctl -u home-cloud -f -o cat
```

The first command shows whether the service is running. The second follows the log live. Use `-n 100 --no-pager` instead of `-f` to print the last 100 lines.

The agent also answers `http://<host>:3000/api/health` without a login. A reply of `{"status":"ok","shuttingDown":false}` means the process is up.

## The agent refuses to start

The log shows `[agent] Refusing to start:`. The agent exits when `PASSWORD` or `JWT_SECRET` in `agent/.env` is missing, too short, or still the example value.

- `PASSWORD` needs at least 8 characters and cannot be `change-me`.
- `JWT_SECRET` needs at least 16 characters and cannot be `generate-a-long-random-string`.

Fix the value in `agent/.env`, then run `sudo systemctl restart home-cloud`. See [Environment variables](/docs/configuration/environment/).

## Port 3000 is in use

The log shows `EADDRINUSE`. Another process holds the port. Find it:

```bash
sudo ss -ltnp 'sport = :3000'
```

Stop that process, or set a different `PORT` in `agent/.env` and restart. If you change the port and use a tunnel, also edit `~/.cloudflared/config.yml`. The installer writes `service: http://localhost:3000` there, and it does not follow `PORT`. See [Ports](/docs/configuration/ports/).

systemd restarts a failing service every 5 seconds and gives up after 5 failures in 60 seconds. Once you fix the cause, clear the failed state:

```bash
sudo systemctl reset-failed home-cloud
sudo systemctl start home-cloud
```

## The service fails right after a Node.js change

The unit file stores the full path to the `node` binary that was active at install time. If you upgraded, moved or removed that Node.js, the service cannot start. Check `node -v`: Home Cloud needs 22.23.4 or newer. If the installer set up its own Node.js, that copy lives in `/opt/home-cloud` and your system Node.js does not affect it.

Re-run the installer from the install directory to render a new unit. The installer moves an existing install to the latest release. To stay on the version you have, pass its tag:

```bash
cd ~/home-cloud
git describe --tags --exact-match
./setup.sh --branch <tag-from-above>
```

If you use a custom tunnel name, check `TUNNEL_NAME` in `agent/.env` afterward. A re-run with an existing tunnel config writes `home-cloud` there.

## The dashboard shows "Dashboard is not built"

The agent serves `dashboard/dist`. If that folder is missing, rebuild it:

```bash
cd ~/home-cloud
pnpm --filter dashboard build
sudo systemctl restart home-cloud
```

## Installer preflight failures

`setup.sh --dry-run` checks prerequisites without changing anything.

**systemd is not running.** The installer exits with `systemd is not running on this machine.` before it installs anything. On WSL it has already enabled systemd in `/etc/wsl.conf`: run `wsl --shutdown` in Windows PowerShell, reopen the WSL terminal, and run the installer again. Containers and other setups without systemd are not supported.

**Could not look up the latest release.** `Could not look up the latest Home Cloud release.` means the installer could not reach GitHub. Check the internet connection and run it again, or pass `--branch <tag>` to name a release yourself.

**Node.js could not be installed.** Missing or older Node.js is installed for you, so these only appear when that fails. `Failed to download Node.js` means nodejs.org was not reachable: check the connection and run the installer again. `SHA256 verification failed` means the download did not match the checksum stored in the script. The installer deleted it, so run the installer again. `There is no official Node.js ... build` means your CPU has no official build, for example 32-bit ARM. Install Node.js 22.23.4 or newer with corepack yourself and run the installer again.

**Docker could not be installed.** `Docker could not be installed automatically on this system` means neither Docker's repository nor your distribution's packages worked. Install Docker Engine from the [official guide](https://docs.docker.com/engine/install/) and run the installer again. `The Docker Compose plugin could not be installed` means the plugin is missing and no package provided it. Install it, then run the installer again.

**Not in the docker group.** The installer adds your user to the `docker` group for you. Your current shell does not pick that up until you log out and back in, or run `newgrp docker`. The service itself gets the group from its unit file, so it does not need a re-login.

**Install directory not empty.** `already exists and is not a complete Home Cloud checkout`. The installer will not overwrite existing files. Move the directory aside or pass `--dir <new-path>`.

**Other messages.** `corepack was not found next to ...` means that Node.js has no corepack. `sudo is required` means you need sudo for system changes. `Refusing to render a systemd unit with User=root` means you ran as root: set `HOME_CLOUD_SERVICE_USER` to a normal account. `Another setup.sh run is already using this installation state` means a previous run is still going or left a lock.

## The tunnel does not connect

Look for `[tunnel]` lines in the log.

- `Config file not found at ...` means there is no tunnel config. Home Cloud runs on your LAN only. Set up remote access again. See [Remote access](/docs/getting-started/remote-access/).
- `Tunnel connection attempt failed` means `cloudflared` could not start or connect. The agent retries on its own, waiting 2 seconds at first and up to 30 seconds between tries.
- `spawn cloudflared ENOENT` means the `cloudflared` binary is not on the service's `PATH`.

Check the config and the tunnel:

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml ingress validate
cloudflared tunnel list
```

The tunnel name in `TUNNEL_NAME` must match a tunnel in the list, and the credentials file named in `config.yml` must exist. If the installer reported that DNS routing did not complete, run it yourself:

```bash
cloudflared tunnel route dns --overwrite-dns home-cloud dash.example.com
```

Use your own tunnel name and domain.

## Login is locked

After 5 failed logins within 60 seconds, that client is locked out for 5 minutes. The response says how many seconds remain. Wait it out. Failures that arrive through the tunnel also count against a shared limit of 30 per minute.

The counters are kept in memory. If you are certain the lockout is yours, restarting the service clears it:

```bash
sudo systemctl restart home-cloud
```

## Login returns "Cross-origin request rejected"

Login and other changes must carry an `Origin` or `Referer` that matches the host serving the page. A reverse proxy that rewrites the `Host` header breaks this. Open the dashboard by its direct address, such as `http://<host>:3000`, to confirm.

## Forgot the password

There is no reset command and no email recovery. The password is stored as plain text in `agent/.env`, so recovery needs access to the machine.

1. Log in to the host over SSH or at the console.
2. Open `~/home-cloud/agent/.env` in an editor.
3. Set a new value on the `PASSWORD` line. Use at least 8 characters and put it in double quotes:

   ```text
   PASSWORD="your new password"
   ```
4. Restart the service:

   ```bash
   sudo systemctl restart home-cloud
   ```

Existing sessions stay valid until they expire after 7 days. To end them all, log in and use "log out everywhere".

## An update failed

The updater runs a preflight check, then fetches, installs, builds and restarts. It stops with an error if a merge or rebase is in progress, if the working tree has conflicts, if less than 500 MB is free, or if the release tag is not found on `origin`.

When any step fails, it checks out the commit you were on before. It does not reinstall packages or rebuild `dashboard/dist`, so a failed build can leave you with a broken dashboard. Restore it by hand:

```bash
cd ~/home-cloud
git status
git checkout <previous-tag>
pnpm install --frozen-lockfile
pnpm --filter dashboard build
sudo systemctl restart home-cloud
```

Use `git tag --list 'v*'` to see tags. After a successful update the agent tries to restart the service itself. If the dashboard does not come back, run the restart command yourself. See [Updates](/docs/using/updates/).
