---
title: Config file and environment variables
description: Every setting the agent reads from agent/.env, the environment, and ~/.config/home-cloud.
sidebar:
  order: 1
---

Home Cloud has two places for settings:

- `agent/.env` holds secrets and startup options. You edit it by hand.
- `~/.config/home-cloud/preferences.json` holds settings you change in the dashboard. The agent writes it.

After you edit either file, restart the service:

```bash
sudo systemctl restart home-cloud
```

## agent/.env

The file lives in the install directory, `~/home-cloud/agent/.env` by default. The installer creates it with mode `0600`. The systemd unit loads it with `EnvironmentFile`, and the agent also reads it with `dotenv`.

Start from the example if you are installing by hand:

```ini
PASSWORD=change-me
JWT_SECRET=generate-a-long-random-string

# BASE_DIR=/home/alice
# PORT=3000
# CF_DOMAIN=example.com
# TUNNEL_NAME=home-cloud
# CF_CONFIG=/home/alice/.cloudflared/config.yml
# COOKIE_SECURE=true
```

### Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PASSWORD` | none, required | Dashboard login password. The agent refuses to start if it is shorter than 8 characters or is `change-me`. |
| `JWT_SECRET` | none, required | Signs session tokens. The agent refuses to start if it is shorter than 16 characters or is `generate-a-long-random-string`. The installer generates 48 hex characters. |
| `PORT` | `3000` | Port for HTTP and WebSocket. See [Ports](/docs/configuration/ports/). |
| `BASE_DIR` | the service user's home | The home root for the file explorer. Must exist, or the agent fails at startup. Relative paths in the file API resolve against it. |
| `CF_DOMAIN` | unset | Cloudflare root domain, for example `example.com`. The alias `CLOUDFLARE_BASE_DOMAIN` is also read. If unset, ingress autowiring does not edit `config.yml`. |
| `TUNNEL_NAME` | `home-cloud` | Name passed to `cloudflared tunnel run`. |
| `CF_CONFIG` | `~/.cloudflared/config.yml` | Path to the tunnel config. If the file does not exist at startup, the tunnel stays off. |
| `COOKIE_SECURE` | `true` | Set to the string `false` to never mark the session cookie `Secure`. See the note below. |
| `ALLOW_SYSTEM_ROOT` | unset | `true` or `false`. Overrides the saved full system access setting at startup. See [Full system access](/docs/configuration/full-system-access/). |
| `GITHUB_TOKEN` | unset | Optional. Sent as a bearer token on the update check to `api.github.com`. |

Changing `JWT_SECRET` signs everyone out, because existing tokens no longer verify. The LAN identity proof is derived from it too. See [Remote access](/docs/getting-started/remote-access/#local-lan-switching).

:::note[About COOKIE_SECURE]
The cookie gets the `Secure` flag only when the request arrived over HTTPS (directly or with `X-Forwarded-Proto: https`) and `COOKIE_SECURE` is not `false`. Over plain HTTP on your LAN the cookie is never `Secure`, so you do not need to change this setting to log in locally.
:::

### Changing the password

Use Settings, then Security & Sessions. It checks the current password, requires at least 8 characters, rewrites `PASSWORD` in `.env`, and signs out every session. You can also edit `PASSWORD` by hand and restart.

### Advanced overrides

These are read by the agent but are not needed for a normal install.

| Variable | Description |
| :--- | :--- |
| `HOME_CLOUD_CONFIG_DIR` | Directory for `preferences.json` and wallpaper files. Wins over `XDG_CONFIG_HOME`. |
| `XDG_CONFIG_HOME` | If set, the config directory is `$XDG_CONFIG_HOME/home-cloud`. |
| `HOME_CLOUD_PREFERENCES_FILE` | Full path of the preferences file. |
| `AGENT_ENV_FILE` | The env file that the password change writes to. Default is `agent/.env`. |

## ~/.config/home-cloud

The config directory is `~/.config/home-cloud` for the user the service runs as. The agent creates it on first use.

| File | Purpose |
| :--- | :--- |
| `preferences.json` | Settings synced across your browsers. |
| `wallpaper.png`, `wallpaper.jpg`, `wallpaper.webp`, or `wallpaper.gif` | Your custom wallpaper, if you uploaded one. Maximum 15 MB. |

### preferences.json

```json
{
  "allowSystemRoot": false,
  "customStoragePaths": [],
  "sessionEpoch": 1,
  "personalization": {
    "presetId": "macos-sonoma",
    "fit": "cover",
    "hasCustomWallpaper": false,
    "customWallpaperExt": null
  }
}
```

| Key | Description |
| :--- | :--- |
| `allowSystemRoot` | `true` when full system access is on. Set from Settings, Storage & System. |
| `customStoragePaths` | Extra absolute paths the file explorer may use in Safe Server Mode. There is no UI for this. Edit the file and restart. |
| `sessionEpoch` | A counter. Logout, "log out everywhere", and password changes add 1, which invalidates every earlier session token. Do not lower it. |
| `personalization` | Wallpaper preset, fit, and custom wallpaper state. Set from Settings, Personalization. |

The agent reads the file once at startup and keeps it in memory. If you edit it by hand, restart the service or your change is overwritten the next time the dashboard saves a setting.

## Other files Home Cloud uses

| Path | Purpose |
| :--- | :--- |
| `~/.cloudflared/config.yml` | Tunnel ingress rules. Written by the installer and by container exposure. A backup is kept as `config.yml.bak`. |
| `~/.cloudflared/*.json`, `cert.pem` | Cloudflare credentials. Keep them private. |
| `~/.home-cloud/compose/` | Compose stacks you create in Docker Manager. |
| `/etc/systemd/system/home-cloud.service` | The service unit rendered by the installer. |
| `~/.local/state/home-cloud/` | The installer's recovery journal and lock. |

To back these up, see [Backup](/docs/operations/backup/).
