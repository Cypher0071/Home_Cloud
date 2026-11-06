---
title: Uninstall
description: Remove Home Cloud, its service, its tunnel and the extras the installer added.
sidebar:
  order: 1
---

There is no uninstaller yet. You remove Home Cloud by undoing what `setup.sh` did, in the order below. Every step is separate, so you can stop after any of them.

:::caution
These steps delete files. The password and tunnel credentials cannot be recovered afterward. If you might reinstall later, make a backup first. See [Backup and restore](/docs/operations/backup/).
:::

Uninstalling Home Cloud does not delete your Docker containers, images or volumes. See [What is not removed](#what-is-not-removed).

## Before you start

Note two things while the service still exists.

Find your install directory. The default is `~/home-cloud`, but `--dir` can change it.

```bash
systemctl show home-cloud -p WorkingDirectory
```

The value ends in `/agent`. The install directory is the parent.

If you use remote access, open `agent/.env` in an editor and note `TUNNEL_NAME` (default `home-cloud`) and `CF_DOMAIN`. Do not paste the file anywhere, because it also holds your password.

## 1. Stop and remove the service

```bash
sudo systemctl disable --now home-cloud
sudo rm /etc/systemd/system/home-cloud.service
sudo systemctl daemon-reload
```

The installer writes the unit to `/etc/systemd/system/home-cloud.service`. Stopping the service also stops the `cloudflared` process, because the agent starts it as a child process.

## 2. Remove the install directory and settings

Replace `~/home-cloud` with your install directory if it is different.

```bash
rm -rf ~/home-cloud
rm -rf ~/.config/home-cloud
rm -rf ~/.home-cloud
```

| Path | What it holds |
| --- | --- |
| `~/home-cloud` | The code, the built dashboard, and `agent/.env` with your password and secrets. |
| `~/.config/home-cloud` | `preferences.json` and any custom wallpaper. |
| `~/.home-cloud` | Compose files saved by the dashboard, in `compose/<project>/docker-compose.yml`. |

If you set `XDG_CONFIG_HOME` or `HOME_CLOUD_CONFIG_DIR`, the settings directory is elsewhere.

:::danger
`~/.home-cloud/compose` holds the Compose files for stacks you deployed from the dashboard. Containers keep running without them, but you lose the definitions. Copy them if you want to keep them.
:::

The installer also keeps a lock and transaction state in `~/.local/state/home-cloud`. You can remove it too:

```bash
rm -rf ~/.local/state/home-cloud
```

## 3. Remove remote access

Skip this section if you installed with `--skip-cloudflared` or never set up a tunnel.

1. Use the `TUNNEL_NAME` and `CF_DOMAIN` values you noted earlier.
2. Delete the tunnel:

   ```bash
   cloudflared tunnel delete home-cloud
   ```

   Use your own tunnel name if you changed it. Stop the service first, as in step 1. Cloudflare refuses to delete a tunnel that still has a live connection.
3. In the Cloudflare dashboard, open DNS for your domain and delete the records the installer created: `dash.<your-domain>`, and `ssh.<your-domain>` if the installer published SSH access. Also delete any hostnames you exposed from the dashboard, or any wildcard record you added for them.
4. Remove the local tunnel files:

   ```bash
   rm ~/.cloudflared/config.yml ~/.cloudflared/<tunnel-id>.json
   ```

   The credentials file is named after the tunnel ID.
5. Remove `~/.cloudflared/cert.pem` only if you have no other Cloudflare tunnels. It is the login certificate for your whole Cloudflare account, not just this tunnel. You can recreate it with `cloudflared tunnel login`.

## 4. Undo system changes (optional)

Depending on your answers and flags, the installer also changed things outside the Home Cloud directories.

**SSH over the tunnel.** If the installer published `ssh.<domain>`, it added a drop-in that disables password logins for connections arriving through the tunnel.

```bash
sudo rm /etc/ssh/sshd_config.d/60-home-cloud-tunnel.conf
sudo systemctl reload ssh
```

On some distributions the unit is `sshd`, not `ssh`.

**Laptop lid.** Unless you passed `--skip-lid`, the installer may have written a file that makes the machine ignore the lid switch.

```bash
sudo rm /etc/systemd/logind.conf.d/10-home-cloud-lid.conf
sudo systemctl kill -s HUP systemd-logind
```

The file only exists if no lid setting was present before. If `rm` reports it is missing, there is nothing to undo.

**Firewall.** If UFW was active, the installer allowed port 3000 and OpenSSH.

```bash
sudo ufw delete allow 3000/tcp
```

Keep the OpenSSH rule if you still use SSH.

## What is not removed

The installer never removes these, and the steps above leave them alone:

- Docker, and every container, image, volume and network on it.
- Node.js and pnpm. The installer enables pnpm through corepack and does not undo it.
- The `cloudflared` binary, installed as a package or at `/usr/local/bin/cloudflared`.
- Your membership in the `docker` group.
- The OpenSSH server, if the installer installed or enabled it.
- System packages the installer added: `curl`, `ca-certificates`, `gnupg`, `build-essential`, `python3`, `git` and `psmisc` (names differ on non-apt systems).

Remove any of these yourself with your package manager if you no longer want them.
