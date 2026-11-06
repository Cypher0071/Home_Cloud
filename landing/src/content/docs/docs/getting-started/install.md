---
title: Install
description: Install Home Cloud with the one-command installer, or set it up by hand for development.
sidebar:
  order: 2
---

The installer is a single Bash script, `setup.sh`. It clones the repository, builds the dashboard, writes the config, and starts a systemd service. Check the [requirements](/docs/getting-started/requirements/) first.

## One-command install

Download the script from a release tag, read it, then run it. Replace `v1.0.1` with the latest release from the [Releases page](https://github.com/Cypher0071/Home_Cloud/releases).

```bash
curl -fsSL https://raw.githubusercontent.com/Cypher0071/Home_Cloud/v1.0.1/setup.sh -o setup.sh && \
less setup.sh && \
bash setup.sh
```

Run it as your normal user, not as root. The script calls `sudo` where it needs it. The `v1.0.1` script installs `v1.0.1` by default. Run `bash setup.sh --help` to see the default ref of the script you downloaded.

The script asks for:

1. A dashboard password (at least 8 characters, entered twice).
2. Whether to install `cloudflared` and set up a Cloudflare Tunnel. You can say no and add it later.

When it finishes it prints the local URL, for example `http://192.168.1.50:3000`. Continue with [First login](/docs/getting-started/first-login/).

:::note
Running as root is refused unless you name a non-root account with `--service-user <user>` or `HOME_CLOUD_SERVICE_USER`. The service never runs as root.
:::

## Options

| Option | Effect |
| :--- | :--- |
| `-h`, `--help` | Print usage and exit. |
| `--dry-run`, `--check-only` | Validate prerequisites and flags without changing the system. |
| `-d`, `--domain <domain>` | Cloudflare root domain, for example `example.com`. Sets `CF_DOMAIN`. |
| `--tunnel <name>` | Tunnel name. Default `home-cloud`. |
| `--dir <path>` | Install directory. Default `$HOME/home-cloud`. |
| `--branch <ref>` | Git tag or branch to install. The default is shown in `--help`. |
| `--service-user <user>` | Account for the service when you run the script as root. |
| `--password-file <path>` | Read the password from the first line of a file. |
| `--password-stdin` | Read the password from standard input. |
| `-y`, `--yes`, `--non-interactive` | Accept defaults and skip prompts. |
| `--skip-cloudflared` | Do not install `cloudflared` or set up a tunnel. LAN only. |
| `--skip-ssh` | Do not check or install the OpenSSH server. |
| `--skip-lid` | Do not change laptop lid behavior. |

The environment variable `HOME_CLOUD_PASSWORD` also sets the password. Do not use `-p` or `--password`: command-line arguments are visible to other local users. The script prints a warning if you do.

### Unattended install

```bash
HOME_CLOUD_PASSWORD='use-a-long-passphrase' bash setup.sh \
  --yes --domain example.com --tunnel home-cloud --dir "$HOME/home-cloud"
```

Cloudflare login needs a browser. For an unattended tunnel setup, run `cloudflared tunnel login` on the machine first so `~/.cloudflared/cert.pem` exists.

:::caution
If you run non-interactively and give no password, the script generates a random one and does not print it. Pass `HOME_CLOUD_PASSWORD`, or set `PASSWORD` in `agent/.env` afterwards. See [Config file and environment variables](/docs/configuration/environment/).
:::

## What the installer does

In order:

1. Works out which user the service runs as and refuses `root`.
2. Installs essential packages (`git`, `curl`, build tools) with your package manager.
3. Installs and enables the OpenSSH server if it is not running (skip with `--skip-ssh`).
4. Clones the repository into the install directory. It refuses to use a non-empty directory that is not a complete Home Cloud checkout.
5. Checks Node.js 22.23.4 or newer and exits if it is missing.
6. Activates pnpm 12.15.0 with `corepack`.
7. Checks for Docker and the Compose plugin, and adds the service user to the `docker` group.
8. Optionally downloads `cloudflared`, verifies its SHA-256, and installs it.
9. Writes `agent/.env` with mode `0600`, a random `JWT_SECRET`, and your password.
10. Optionally creates the Cloudflare Tunnel. See [Remote access](/docs/getting-started/remote-access/).
11. Runs `pnpm install --frozen-lockfile` and builds the dashboard.
12. If UFW is active, allows `3000/tcp` (and OpenSSH unless `--skip-ssh`).
13. Writes `/etc/systemd/logind.conf.d/10-home-cloud-lid.conf` so closing a laptop lid does not suspend the machine. Skip with `--skip-lid`.
14. Renders `/etc/systemd/system/home-cloud.service`, sets ownership of the install directory to the service user, and runs `systemctl enable --now home-cloud.service`.

The installer is safe to run again. It keeps a journal in `~/.local/state/home-cloud` and keeps an existing `agent/.env` password unless you pass a new one, and keeps an existing valid Cloudflare config.

## Manage the service

```bash
sudo systemctl status home-cloud
sudo journalctl -u home-cloud -f -o cat
sudo systemctl restart home-cloud
sudo systemctl stop home-cloud
```

To remove Home Cloud, see [Uninstall](/docs/operations/uninstall/).

## Manual install (development)

Use this to run from a clone. It does not create a systemd service. You need Node.js 22.23.4 or newer and pnpm 12.15.0.

```bash
git clone https://github.com/Cypher0071/Home_Cloud
cd Home_Cloud
corepack enable
corepack prepare pnpm@12.15.0 --activate
pnpm install
```

Create the config file and set both secrets:

```bash
cp agent/.env.example agent/.env
chmod 600 agent/.env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" agent/.env
nano agent/.env   # set PASSWORD to a value of 8 or more characters
```

The agent refuses to start while `PASSWORD` is `change-me` or `JWT_SECRET` is still the example value.

Build and run in production mode:

```bash
pnpm --filter dashboard build
pnpm --filter agent start
```

The dashboard is then at `http://localhost:3000`.

For development with hot reload, run `pnpm dev`. It starts the agent on port 3000 and the Vite dev server on `http://localhost:5173`, which proxies API and WebSocket calls to the agent.

## Next

[First login](/docs/getting-started/first-login/).
