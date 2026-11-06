---
title: Requirements
description: What your machine needs before you run the Home Cloud installer.
sidebar:
  order: 1
---

Home Cloud runs on one Linux machine. You do not need to install Node.js or Docker first: the installer sets up whatever is missing.

## What you need

| Requirement | Details |
| :--- | :--- |
| Operating system | Linux with systemd. The installer creates a systemd service and stops early if systemd is not running. See [systemd and WSL](#systemd-and-wsl). |
| Architecture | x86_64. ARM64 and Raspberry Pi are untested. On 32-bit ARM, install Node.js 22.23.4 or newer yourself, because there is no official build for the installer to download. |
| User account | A normal (non-root) user with `sudo`. The service runs as this user. |
| Network | Outbound internet during install, to GitHub, nodejs.org and, if Docker is missing, download.docker.com. Port 3000 reachable from your LAN to use the dashboard locally. |
| Browser | Any current desktop or mobile browser. |

Remote access over the internet needs two more things, both optional:

- A free Cloudflare account.
- A domain whose DNS is managed by Cloudflare.

If you skip these, Home Cloud still works on your local network at `http://<server-ip>:3000`. See [Remote access](/docs/getting-started/remote-access/).

## What the installer sets up for you

| Item | Notes |
| :--- | :--- |
| Node.js | A Node.js 22.23.4 or newer that has `corepack` is used as it is. Otherwise the installer downloads Node.js 24.22.2 from nodejs.org, checks it against a SHA-256 stored in the script, and unpacks it into `/opt/home-cloud`. Your own Node.js is never changed. Node.js 20 is not supported. |
| pnpm 12.15.0 | Activated with `corepack`. No `npm -g`, no `get.pnpm.io`. |
| Docker Engine and the Compose plugin | Installed only if `docker` is missing. On Ubuntu, Debian, Fedora, RHEL and CentOS-family systems it comes from Docker's official repository, after the repository's signing key fingerprint is checked. Where that repository does not cover the system, it falls back to your distribution's Docker packages. On Arch it uses the distribution's packages. If Docker is already installed but the Compose plugin is missing, it installs the plugin. |
| `docker` group membership | The service user is added to the `docker` group. |
| `git`, `curl`, `ca-certificates`, `gnupg`, `psmisc`, `xz`, `tar`, build tools, `python3` | Installed with `apt-get`, `dnf`, `yum`, or `pacman`. Other package managers are not handled, so install `git` first on those systems. |
| OpenSSH server | Installed and enabled if it is not already active. Skip with `--skip-ssh`. |
| `cloudflared` | Optional. The installer pins release 2026.10.3 and checks its SHA-256 before installing. |

Nothing is piped into a shell. The installer does not run NodeSource, `get.pnpm.io`, `get.docker.com`, or the `cloudflared` `releases/latest` download.

If Docker cannot be installed automatically on your system, the installer stops and asks you to install Docker Engine from the [official guide](https://docs.docker.com/engine/install/). Run it again afterward. It does not check the version of a Docker that is already installed. The README lists Docker 24 or newer.

The installer also changes a few system settings. They are listed in [Install](/docs/getting-started/install/#what-the-installer-does).

## systemd and WSL

Home Cloud runs as a systemd service, so systemd must be running. The installer checks this before it installs anything.

On WSL without systemd, the installer adds `systemd=true` under `[boot]` in `/etc/wsl.conf` for you, then stops. In Windows PowerShell run `wsl --shutdown`, reopen the WSL terminal, and run the installer again.

Containers and other setups without systemd are not supported. Use a regular Linux install or a VM.

## Check what you have

```bash
systemctl --version
test -d /run/systemd/system && echo "systemd is running"
sudo -v
```

If you already have Node.js or Docker, you can leave them as they are:

```bash
node -v
docker --version
docker compose version
```

## Dry run

To check your machine without changing it, run the installer with `--dry-run` (alias `--check-only`). It validates flags and prerequisites and prints what it would install, including Node.js or Docker if they are missing. See [Install](/docs/getting-started/install/) for how to download the script.

```bash
bash setup.sh --dry-run
```

## Next

[Install Home Cloud](/docs/getting-started/install/).
