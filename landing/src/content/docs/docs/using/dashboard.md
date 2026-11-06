---
title: The dashboard
description: How the web desktop is laid out, what each app does, and which settings follow you across devices.
sidebar:
  order: 1
---

The dashboard is a single-page web desktop served by the agent on port 3000. You sign in with one password. After that you get a taskbar and five apps that open in windows.

## Apps

| App (window title) | What it does | Page |
| --- | --- | --- |
| Activity Monitor | Live CPU, memory, storage and network figures | [Below](#activity-monitor) |
| File Explorer | Browse and manage files on the host | [Files](/docs/using/files/) |
| Terminal | A shell on the host | [Terminal](/docs/using/terminal/) |
| Docker Manager | Containers, images and Compose projects | [Docker and Compose](/docs/using/docker/) |
| Settings | Background, storage scope, password, sessions, updates | [Below](#settings) |

Each app opens at `/terminal`, `/metrics`, `/files`, `/docker` or `/settings`. Opening one of those URLs while you are signed in opens that app's window straight away.

## Windows and the taskbar

On a desktop-sized screen each app is a window. You can drag it by the title bar, resize it from the bottom-right handle, minimize it, maximize it and close it. Clicking a window brings it to the front.

The taskbar has three parts:

- **Left:** a small meter showing CPU %, RAM % and download rate. Click it to open or hide Activity Monitor.
- **Center:** one icon per app. Click an icon to open the app. Click the icon of the focused window to minimize it.
- **Right:** a connection indicator, the clock and a sign-out button.

The connection indicator shows `Tunnel` when you reached the dashboard through Cloudflare. It shows `LAN` with the server address when you are connected directly. When the server's LAN address is known, clicking the `Tunnel` indicator switches you to it. See [Remote access](/docs/getting-started/remote-access/) for how the tunnel is set up.

On a phone-sized screen the windows are laid out for the small screen and cannot be dragged. A bottom bar switches between Home, Docker, Files, Terminal and Activity. Settings and sign-out are in the top bar.

:::note
Window positions and sizes live only in the open browser tab. They are not saved, and they do not sync between devices.
:::

## Activity Monitor

Activity Monitor has four cards.

| Card | Contents |
| --- | --- |
| Processor | Total load, user, system and idle percentages, and a load bar per core |
| Memory | Total, in use, available and free memory, plus swap used and free |
| Storage | Each mounted partition with size, usage and free space |
| Network | Routing mode (tunnel or LAN), server address, and transfer rates for the active interface |

The numbers come from a single stream at `/api/metrics`. The agent samples the host every 2 seconds and sends a heartbeat every 15 seconds so the Cloudflare connection is not closed as idle. If the stream drops, the server asks the browser to wait 5 seconds before it reconnects.

The agent reads these figures with the `systeminformation` library. It only reads local system state and does not send it anywhere.

## Settings

Settings has four tabs.

### Personalization

The Background page sets the desktop wallpaper.

- **Presets:** Waves, Night, Sand, Mist and Charcoal.
- **Fit:** Fill, Fit, Stretch or Center.
- **Custom image:** JPEG, PNG, WebP or GIF, up to 15 MB. Uploading a new image replaces the old one.

### Storage & System

Shows the current file scope, a switch labeled "Allow Full System Root Access (/)", your home directory and the drives found on the host. Read [Full system access](/docs/configuration/full-system-access/) before turning the switch on.

### Security & Sessions

- **Change Master Passcode:** asks for the current password and the new one twice. The new password must be at least 8 characters and different from the current one. Changing it signs out every device.
- **Log Out Everywhere:** revokes every session on every device. See [Sessions and login](/docs/security/sessions/).
- **Remote SSH Access:** shows the SSH host name and a `~/.ssh/config` snippet when a Cloudflare domain is configured. Without one, it shows the local SSH address.

### Updates & System

Checks for a new release and applies it. See [Updates and rollback](/docs/using/updates/).

## What syncs between devices

The agent stores preferences on the server, in `~/.config/home-cloud/preferences.json`. Any browser that signs in reads the same file.

| Setting | Where it lives |
| --- | --- |
| Wallpaper preset, fit and custom image | Server (the browser also keeps a local copy as a fallback) |
| Full system root access switch | Server |
| Custom storage paths | Server |
| Session revocation counter | Server |
| Window positions, sizes, which apps are open | Not saved |

The file is plain JSON. See [Backup](/docs/operations/backup/) if you want to keep it.

## Signing out

The sign-out button in the taskbar calls the same revocation as Log Out Everywhere. It signs out every browser and phone, not only the one you clicked it on. It also closes open terminal and log streams on those devices.

:::caution
If you use the dashboard on a laptop and a phone, signing out on one signs you out on the other.
:::
