---
title: Backup and restore
description: What state Home Cloud keeps, where it lives, and how to back it up and restore it.
sidebar:
  order: 2
---

Home Cloud keeps very little state. The code and the built dashboard can be rebuilt from Git. What you need to protect is a handful of small files, plus your Docker data, which Home Cloud does not manage for you.

## What state exists

Paths assume the defaults: the install directory is `~/home-cloud` and the service runs as your user.

| Path | What it holds | Needed? |
| --- | --- | --- |
| `~/home-cloud/agent/.env` | `PASSWORD`, `JWT_SECRET`, and optional `PORT`, `BASE_DIR`, `CF_DOMAIN`, `TUNNEL_NAME`, `CF_CONFIG`. | Yes |
| `~/.config/home-cloud/` | `preferences.json` (storage scope, custom storage paths, desktop settings, session counter) and any custom `wallpaper.*` file. | Yes |
| `~/.home-cloud/compose/` | One folder per Compose project, each with a `docker-compose.yml` saved from the dashboard. | Yes, if you use Compose |
| `~/.cloudflared/config.yml` | Tunnel ID and ingress rules, including hostnames you exposed from the dashboard. | If you use remote access |
| `~/.cloudflared/<tunnel-id>.json` | The tunnel credentials. Anyone with this file can run your tunnel. | If you use remote access |
| `~/.cloudflared/cert.pem` | Cloudflare account login certificate. You can recreate it with `cloudflared tunnel login`. | Optional |

:::caution
The dashboard password is stored as plain text in `agent/.env`. It is not a hash. The file is created with mode `0600`. Treat any backup that contains it as a secret.
:::

Notes on where things live:

- `.env` is inside the install directory, so deleting or re-cloning that directory loses it.
- The settings directory moves if `HOME_CLOUD_CONFIG_DIR` is set, or to `$XDG_CONFIG_HOME/home-cloud` if `XDG_CONFIG_HOME` is set.
- `JWT_SECRET` signs login cookies. If you lose it and generate a new one, everyone is signed out. Nothing else breaks.
- You do not need to back up the systemd unit. `setup.sh` regenerates it. You also do not need `node_modules` or `dashboard/dist`.

## What you must back up yourself

Home Cloud does not back up Docker. These are your responsibility:

- Named volumes and bind-mounted directories used by your containers.
- Container configuration that is not in a Compose file.
- Anything else on the host, including files you manage with the file manager.

A Compose file records which volumes a stack uses. It does not contain the data in them.

## Make a backup

This archives the state above. Run it from any directory. The `umask` keeps the archive readable only by you.

```bash
(umask 077; tar -czf "$HOME/home-cloud-backup-$(date +%F).tar.gz" \
  -C "$HOME" \
  home-cloud/agent/.env \
  .config/home-cloud \
  .home-cloud/compose \
  .cloudflared)
```

Adjust it to your setup:

- Remove `.cloudflared` if you do not use remote access.
- Remove `.home-cloud/compose` if you never deployed a Compose stack.
- Change `home-cloud/agent/.env` if you installed somewhere else.

`tar` reports an error for any path that does not exist and still writes the rest. The service can keep running during the backup.

Copy the archive off the machine. Encrypt it if it leaves your control.

## Restore on the same machine

Use this after reinstalling or after losing a file.

1. Install Home Cloud again if the install directory is gone. See [Install](/docs/getting-started/install/).
2. Stop the service so nothing overwrites the restored files:

   ```bash
   sudo systemctl stop home-cloud
   ```
3. Extract the archive into your home directory:

   ```bash
   tar -xzf ~/home-cloud-backup-2026-01-15.tar.gz -C ~
   ```

   Replace the file name with yours.
4. Fix permissions on the secrets:

   ```bash
   chmod 600 ~/home-cloud/agent/.env
   chmod 700 ~/.cloudflared
   chmod 600 ~/.cloudflared/*.json ~/.cloudflared/*.pem
   ```

   Skip the last two lines if you have no `.cloudflared` directory.
5. Start the service:

   ```bash
   sudo systemctl start home-cloud
   ```

The agent reads `.env` only at startup, so a restart is required after any change to it.

To restore onto a different machine, follow [Moving to a new machine](/docs/operations/migrate/) instead. The installer has to run first.

## Check your backup

A backup you have not read back is a guess. List the archive and confirm the files are there:

```bash
tar -tzf ~/home-cloud-backup-2026-01-15.tar.gz
```

You should see `agent/.env`, `preferences.json` and, if you use them, your Compose folders and `.cloudflared` files. Listing does not print file contents.
