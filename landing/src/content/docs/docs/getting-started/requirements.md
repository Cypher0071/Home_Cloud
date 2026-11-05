---
title: Requirements
description: What your machine needs before you run the Home Cloud installer.
sidebar:
  order: 1
---

Home Cloud runs on one Linux machine. The installer checks most of these for you, but it does not install Node.js or Docker.

## What you need

| Requirement | Details |
| :--- | :--- |
| Operating system | Linux with systemd. The installer creates a systemd service. |
| Architecture | x86_64. ARM64 and Raspberry Pi are untested. |
| Node.js | 22.23.4 or newer. The installer exits if Node.js is missing or older. Node.js 20 is not supported. |
| Docker | Docker Engine with the Compose plugin (`docker compose`). The README lists Docker 24 or newer. The installer does not check the version. |
| User account | A normal (non-root) user with `sudo`. The service runs as this user. |
| Network | Outbound internet during install. Port 3000 reachable from your LAN to use the dashboard locally. |
| Browser | Any current desktop or mobile browser. |

Remote access over the internet needs two more things, both optional:

- A free Cloudflare account.
- A domain whose DNS is managed by Cloudflare.

If you skip these, Home Cloud still works on your local network at `http://<server-ip>:3000`. See [Remote access](/docs/getting-started/remote-access/).

## Check what you have

```bash
node -v
docker --version
docker compose version
systemctl --version
```

`node -v` must print `v22.23.4` or higher.

## What you install yourself

The installer refuses to run without these:

- **Node.js 22.23.4 or newer.** The installer does not fetch it from NodeSource or any other source. Install it with your distribution, a version manager such as `mise`, or the official tarball. The systemd unit stores the absolute path of the `node` binary found at install time.
- **Docker Engine.** The installer does not install Docker. If Docker is present but the Compose plugin is missing, it installs `docker-compose-plugin` on apt-based systems. On other systems it exits and asks you to install the plugin.

## What the installer sets up for you

| Item | Notes |
| :--- | :--- |
| `git`, `curl`, `ca-certificates`, `psmisc`, build tools, `python3` | Installed with `apt-get`, `dnf`, `yum`, or `pacman`. Other package managers are not handled, so install `git` first on those systems. |
| pnpm 12.15.0 | Activated with `corepack`. No `npm -g`, no `get.pnpm.io`. |
| OpenSSH server | Installed and enabled if it is not already active. Skip with `--skip-ssh`. |
| `cloudflared` | Optional. The installer pins release 2026.10.3 and checks its SHA-256 before installing. |
| `docker` group membership | The service user is added to the `docker` group. |

The installer also changes a few system settings. They are listed in [Install](/docs/getting-started/install/#what-the-installer-does).

## Dry run

To check your machine without changing it, run the installer with `--dry-run` (alias `--check-only`). It validates prerequisites and flags and prints what it would do. See [Install](/docs/getting-started/install/) for how to download the script.

```bash
bash setup.sh --dry-run
```

## Next

[Install Home Cloud](/docs/getting-started/install/).
