---
title: Full system access
description: What the full system access setting changes in the file explorer, what stays blocked, and the risks.
sidebar:
  order: 3
---

By default the file explorer is limited to your home directory and mounted storage. The full system access setting lifts that limit so you can browse the whole filesystem. A few kernel paths stay blocked in both modes.

## The two modes

| | Safe Server Mode (default) | Full system access |
| :--- | :--- | :--- |
| Your home directory (`BASE_DIR`) | Allowed | Allowed |
| `/mnt`, `/media`, `/run/media`, `/srv` | Allowed | Allowed |
| Paths in `customStoragePaths` | Allowed | Allowed |
| Everything else (`/etc`, `/var`, `/usr`, `/root`, ...) | Blocked | Allowed |
| `/proc`, `/sys`, `/dev` | Blocked | Blocked |

"Allowed" means the agent will try. The OS still decides. The agent runs as your normal user, so files that user cannot read or write return `Permission denied by host OS`.

## Turn it on or off

1. Open Settings, then **Storage & System**.
2. Under **Filesystem Scope & Permissions**, switch **Allow Full System Root Access (/)**.

The badge changes from "Safe Server Mode" to "Full Root Mode (/)". The change is saved to `~/.config/home-cloud/preferences.json` as `allowSystemRoot` and takes effect immediately. The File Explorer also adds a "System Root (/)" entry to its drive list.

You can also set it at startup with an environment variable in `agent/.env`:

```ini
ALLOW_SYSTEM_ROOT=true
```

When `ALLOW_SYSTEM_ROOT` is set, it overrides the saved value each time the agent starts. A toggle in the dashboard still saves to `preferences.json`, but after a restart the environment variable wins again. Remove the variable if you want the dashboard switch to be the source of truth. See [Config file and environment variables](/docs/configuration/environment/).

## What stays blocked

`/proc`, `/sys`, and `/dev` are refused in every mode, with no setting to unlock them. The check is in the agent code, not in a config file. It exists to avoid hung requests and leaking process descriptors from virtual kernel filesystems.

The scope check runs on the real path. Symlinks are resolved first, so a link inside your home directory that points to `/etc` is blocked in Safe Server Mode, and a link that points into `/proc` is blocked in both modes. The same check covers listing, viewing, downloading, searching, uploading, creating, copying, renaming, moving, and deleting.

The same scope applies to host bind mounts when you create a container with the Docker Manager form. A bind mount source outside the allowed scope is rejected with `Host path must be inside allowed storage scope`.

## Add extra directories without full access

If you only need one more directory, such as a data disk mounted somewhere unusual, add it to `customStoragePaths` instead of turning on full access. There is no UI for this yet. Edit `~/.config/home-cloud/preferences.json`:

```json
{
  "customStoragePaths": ["/data/photos"]
}
```

Keep the other keys in the file. Restart the service so the agent reloads it:

```bash
sudo systemctl restart home-cloud
```

## Risks

- **It widens what a mistake can break.** With full access, a wrong move, rename, or delete in `/etc` or `/usr` can stop the machine from booting, limited only by what your user can write. Files owned by root are protected by normal permissions, not by Home Cloud.
- **It is not a boundary against the terminal.** The host terminal already runs as the same user with no path restriction, and anyone with the password can open it. Safe Server Mode keeps accidents inside your data directories. It does not stop a person who has logged in. See the [threat model](/docs/security/threat-model/).
- **Your user may have extra reach.** The service user is in the `docker` group, which is root-equivalent on the host. Full access plus Docker can touch most of the system.
- **System config becomes browsable.** Files such as the contents of `/etc` that your user can read are listed and downloadable, so a logged-in session can read more of the host than before.

Leave it off unless you need to manage files outside your home and storage mounts. If you turn it on for one task, turn it off afterwards.
