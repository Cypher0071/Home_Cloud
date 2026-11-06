---
title: Moving to a new machine
description: Install Home Cloud on a new host and bring your password, settings and tunnel across.
sidebar:
  order: 4
---

Do not copy the install directory. Install Home Cloud fresh on the new machine, then carry over the small set of files that hold your state. The list of those files is in [Backup and restore](/docs/operations/backup/).

## Before you start

- The new machine meets the [requirements](/docs/getting-started/requirements/): Linux with systemd, `sudo` and internet access. The installer sets up Node.js and Docker if they are missing.
- You know which Home Cloud version the old machine runs. The installer installs the latest release. Pass `--branch <tag>` if you want the same version.
- Take a backup on the old machine and copy the archive to the new one.
- Decide how to handle the tunnel. See [Tunnel choices](#tunnel-choices).
- Moving Docker data is separate. See [Docker data](#docker-data).

## 1. Install on the new machine

Run the installer as described in [Install](/docs/getting-started/install/). If you reuse your old tunnel, do the steps in [Reuse the old tunnel](#reuse-the-old-tunnel) before you run it.

Use any password for now. You replace the settings in the next step.

## 2. Copy the config

Stop the service on the new machine, then restore the files from your backup:

```bash
sudo systemctl stop home-cloud
tar -xzf ~/home-cloud-backup-2026-01-15.tar.gz -C ~
chmod 600 ~/home-cloud/agent/.env
```

This puts back `agent/.env`, `~/.config/home-cloud`, `~/.home-cloud/compose` and, if the archive has it, `~/.cloudflared`. If you plan to [create a new tunnel](#create-a-new-tunnel), add `--exclude='.cloudflared'` to the `tar` command so the old tunnel files do not replace the new ones.

The new `.env` is now the old one. Check any value that names a path or a port on the old machine before you start the service:

- `BASE_DIR`, if you set it.
- `CF_CONFIG`, if you set it.
- `PORT`.

`preferences.json` can also name old paths. If the dashboard shows storage paths that do not exist on the new machine, fix them in Settings.

Start the service:

```bash
sudo systemctl start home-cloud
```

The old password and `JWT_SECRET` come with `.env`, so you log in with your old password.

## Tunnel choices

You have two options for remote access. Without remote access you can skip this section.

### Reuse the old tunnel

This keeps your DNS records as they are. The new machine takes over the same tunnel, so nothing changes in Cloudflare.

Before you run the installer, put the tunnel files on the new machine:

```bash
mkdir -p ~/.cloudflared
chmod 700 ~/.cloudflared
# copy config.yml and <tunnel-id>.json into ~/.cloudflared, then:
chmod 600 ~/.cloudflared/*.json
```

`config.yml` names the credentials file with an absolute path. If your username or home directory is different on the new machine, edit the `credentials-file:` line.

Run the installer and let it install `cloudflared` when it asks. It sees a valid `config.yml` and keeps it. Step 2 then restores your old `.env`, which already has the right `CF_DOMAIN` and `TUNNEL_NAME`.

If `config.yml` has an `ssh.<domain>` rule, the installer does not add the key-only SSH setting it normally adds for that hostname. Either delete that rule from `config.yml`, or create `/etc/ssh/sshd_config.d/60-home-cloud-tunnel.conf` with these lines and reload `sshd`:

```text
Match Address 127.0.0.1,::1
    PasswordAuthentication no
    KbdInteractiveAuthentication no
```

Run the tunnel from only one machine at a time. Stop the service on the old machine before you start the new one:

```bash
sudo systemctl disable --now home-cloud
```

### Create a new tunnel

Use this if you did not keep the credentials, or you want a clean start.

1. Run the installer on the new machine with your domain. It runs `cloudflared tunnel login`, creates a tunnel, and points `dash.<domain>` at it. The route command overwrites the existing record, so the dashboard moves over without a manual DNS edit.
2. Use a tunnel name that is not already in use. The installer will not delete a tunnel it did not create. If a tunnel with the same name exists in your account and the credentials are missing, it falls back to LAN-only mode. Either pass `--tunnel <new-name>`, or delete the old tunnel first with `cloudflared tunnel delete <name>` after stopping the old machine.
3. Hostnames you exposed from the dashboard are not carried over. The new `config.yml` only has `dash.<domain>`. Expose those apps again from the dashboard. Their DNS records still point at the old tunnel, so repoint each one:

   ```bash
   cloudflared tunnel route dns --overwrite-dns <tunnel-name> app.example.com
   ```

   If you use a wildcard CNAME, edit it in Cloudflare to point at the new tunnel.
4. The restored `agent/.env` still has the old `TUNNEL_NAME`. Set it to the new tunnel name and restart the service.

When you are done, delete the old tunnel and any DNS records you no longer use. See [Uninstall](/docs/operations/uninstall/).

## Docker data

Home Cloud does not move your containers. Compose files in `~/.home-cloud/compose` come across with the config. Everything they refer to does not:

- Named volumes and bind-mounted directories.
- Images, which are pulled again when you deploy.
- Containers that you started outside Compose.

Copy the data with your own tools before you deploy on the new machine, and keep the same host paths if your Compose files use bind mounts. Then deploy each project from the Docker app. See [Docker](/docs/using/docker/).

## Check the move

1. Open `http://<new-host>:3000` on your LAN and log in.
2. If you use remote access, open `https://dash.<your-domain>`.
3. Follow the logs for `[tunnel]` lines with `sudo journalctl -u home-cloud -f -o cat`. See [Troubleshooting](/docs/operations/troubleshooting/).
4. Once everything works, uninstall Home Cloud on the old machine.
