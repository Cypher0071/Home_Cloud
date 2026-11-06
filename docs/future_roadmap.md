# Home Cloud — Future Roadmap

This document lists the features planned next for **Home Cloud**. None of them are built yet.
Milestones are ordered by priority, not tied to release numbers. What has shipped is recorded in
[`CHANGELOG.md`](../CHANGELOG.md), and known rough edges are in [`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md).

---

## 🗺️ Roadmap Overview

| Milestone | Focus Area | Complexity |
| :--- | :--- | :---: |
| **Milestone 1** | Container Crash Watchdogs & Multi-Channel Alerting | Medium |
| **Milestone 2** | Automated Docker Volume & Database Snapshots | High |
| **Milestone 3** | Resumable Chunked File Uploads (`tus` protocol) | Medium |
| **Milestone 4** | Desktop Window Layout Persistence | Low |
| **Milestone 5** | File Explorer Grid View & Details Pane | Medium |

---

## 🔔 Milestone 1: Container Crash Watchdogs & Webhook Notifications

### 1. Problem Statement
Self-hosted servers frequently host unattended services (Plex/Jellyfin, Nextcloud, Home Assistant, Gitea, Vaultwarden, Postgres). If a container crashes, enters an infinite restart loop, or gets terminated by the Linux Out-Of-Memory (OOM) killer, the user typically discovers it days later when an app becomes unresponsive. Installing heavy monitoring stacks (Prometheus, Grafana, Alertmanager) consumes disproportionate RAM and CPU on low-power homelab devices (e.g. Raspberry Pi, Intel N100 mini PCs).

### 2. Architecture & Design
Home Cloud will implement an integrated, zero-overhead background event watchdog directly in the Node.js Agent:

```
┌────────────────────────┐
│  Docker Event Stream   │
│  (docker.getEvents())  │
└───────────┬────────────┘
            │ Real-time container lifecycle events
            ▼
┌────────────────────────┐      Debounce & Backoff
│ Agent Watchdog Service ├──────────────────────────┐
│ (agent/services/       │  (Suppresses crash-loop  │
│  watchdog.js)          │   notification storms)   │
└───────────┬────────────┘                          │
            │ Format structured alert payload       │
            ▼                                       ▼
┌────────────────────────────────────────────────────────┐
│             Multi-Channel Webhook Dispatcher           │
│                                                        │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────┐  │
│  │ Telegram Bot │   │ Discord Hook │   │ Gotify/    │  │
│  │ (Bot API)    │   │ (Embed Card) │   │ ntfy.sh    │  │
│  └──────────────┘   └──────────────┘   └────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Web Push / Native Desktop Notifications (PWA)     │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

#### Key Capabilities:
- **Real-Time Docker Stream**: Subscribes directly to `docker.getEvents({ filters: { event: ['die', 'oom', 'health_status'] } })`.
- **Health Anomaly Detection**:
  - Container exited with non-zero exit code (`die` event with `exitCode !== 0`).
  - OOM Killer invocation (`oom` event).
  - Health check transitions from healthy to unhealthy (`health_status: unhealthy`).
- **Crash-Loop Debounce & Exponential Backoff**:
  - Tracks alert frequency per container (e.g. maximum 1 alert per 15 minutes for repeated crashes).
  - Prevents flooding user notification channels if a misconfigured container restarts in an endless loop (`restart: always`).
- **Rich Error Context Extraction**:
  - Automatically fetches the last 15–20 lines of stderr/stdout from `docker.getContainer(id).logs()`.
  - Attaches exit codes, uptime duration, container image tag, and memory limits directly into the notification payload.

#### Notification Destinations:
1. **Discord Webhooks**: Rich embed cards with color-coded severity (Red for OOM/Crash, Yellow for Unhealthy).
2. **Telegram Bot**: Markdown-formatted messages dispatched via Telegram Bot API (`chat_id` + `bot_token`).
3. **Self-Hosted Push (Gotify / ntfy.sh)**: Open-source, private notification servers that do not rely on third-party commercial platforms.
4. **Browser & Mobile Web Push (VAPID / Service Worker)**: Push alerts directly to the user's browser or installed PWA on mobile and desktop without requiring external accounts.

#### Dashboard UI:
- New **Alerts & Notifications** card in the Settings app:
  - Configure Webhook URLs and tokens with an instant **"Send Test Alert"** button.
  - Event filter toggles (Container Crash, OOM Kill, High Memory threshold).
  - Live preview of notification card formatting.

---

## 💾 Milestone 2: Automated Docker Volume & Database Snapshots

### 1. Problem Statement
Data safety is the single most critical requirement for self-hosted cloud infrastructure. Backing up running containers manually requires terminal commands, stopping services, or risking database corruption. While system restore tools like **Timeshift** protect the host operating system (`/etc`, `/usr`, `/bin`), they explicitly ignore Docker volumes, cannot guarantee database transaction consistency, require root privileges, and roll back the entire OS rather than individual apps.

### 2. Architecture & Design
Home Cloud will provide native, scheduled, application-consistent volume archiving and point-in-time database snapshots:

```
┌──────────────────────────────────────────────────────────────┐
│                    Backup Scheduler Service                  │
│                   (agent/services/backup.js)                 │
└──────────────────────────────┬───────────────────────────────┘
                               │
       ┌───────────────────────┴───────────────────────┐
       ▼                                               ▼
┌───────────────────────────────┐     ┌─────────────────────────────────┐
│ Database Pre-Dump Phase       │     │ Transient Worker Container      │
│ (Application-Consistent)      │     │ (Read-Only Volume Snapshot)     │
├───────────────────────────────┤     ├─────────────────────────────────┤
│ • PostgreSQL: `pg_dump`       │     │ • Mounts volume `:ro`           │
│ • MySQL/MariaDB: `mysqldump`  │     │ • Streams tar.gz archive        │
│ • SQLite: `.backup` vacuum    │     │ • Zero root privilege needed    │
└───────────────────────────────┘     └────────────────┬────────────────┘
                                                       │
                                                       ▼
                                      ┌─────────────────────────────────┐
                                      │ Target Storage & Retention      │
                                      │ • Local SSD / Config Dir        │
                                      │ • Mounted Pool (/mnt/storage)   │
                                      │ • Prunes oldest > N retention   │
                                      └─────────────────────────────────┘
```

#### Key Capabilities:
- **Application-Consistent Database Dumps**:
  - Detects database engine by inspecting container image and environment variables (`POSTGRES_DB`, `MYSQL_DATABASE`).
  - Executes non-blocking native dump utilities via `docker.getContainer(id).exec()` before archiving (`pg_dump -U <user> <db>` or `mysqldump`).
  - Guarantees zero write corruption or fragmented transaction logs.
- **Transient Read-Only Helper Container**:
  - Uses an ephemeral minimal container (`alpine:latest` or `busybox`):
    ```bash
    docker run --rm \
      -v <volume_name>:/data:ro \
      -v <backup_storage_path>:/backup \
      alpine tar -czf /backup/<archive_name>.tar.gz -C /data .
    ```
  - Mounting `:ro` prevents writes during archiving.
  - No host root access required (operates cleanly within Docker group permissions).
- **Flexible Storage Targets**:
  - Integrated with Home Cloud's **Multi-Drive Storage Scope**: snapshots can target internal drives, external USB HDDs (`/mnt/*`, `/media/*`), or dedicated network mounts (`/srv/*`).
  - Pre-flight free disk space validation (`>= 1GB` and `>= 1.5x volume size`) using `fs.statfsSync`.
- **Scheduled Retention & Pruning Policies**:
  - Configurable retention (e.g. keep last 7 daily, 4 weekly snapshots).
  - Automatic background rotation pruning expired archives to prevent disk exhaustion.

#### Dashboard Management UI:
- **Backups & Snapshots** panel in Settings:
  - Table of all available snapshots with volume names, file sizes, creation timestamps, and checksums.
  - **1-Click Manual Snapshot**: Trigger an immediate backup of any individual container or all volumes.
  - **Direct Download**: Stream `.tar.gz` archives directly to the user's laptop for offsite redundancy.
  - **1-Click Restore Wizard**: Unpack and restore archives back into designated volumes with pre-flight safety warnings.

---

## 🚀 Milestone 3: Resumable Chunked File Uploads (`tus` protocol)

### 1. Problem Statement
When accessing Home Cloud remotely via Cloudflare Tunnel, Cloudflare's edge proxy enforces a strict **100 MB request body limit** on Free and Pro tiers. Uploading large videos, archives, or ISO images over the tunnel currently results in HTTP `413 Request Entity Too Large`.

### 2. Architecture & Design
- Implement client-side slicing using the open-standard **`tus` resumable upload protocol** or 50 MB chunked multipart streams.
- The browser splits files `>= 50 MB` into sequential chunks, transmitting each chunk below Cloudflare's 100 MB ceiling.
- The Node.js Agent receives chunks in a staging directory (`~/.cache/home-cloud/uploads/<uploadId>`), validates chunk hashes, and assembles the target file atomically upon completion.
- Includes automatic pause, resume, and retry upon network drops or Wi-Fi reconnects.

---

## 🖥️ Milestone 4: Desktop Window Layout Persistence

### 1. Problem Statement
The dashboard is a windowed desktop, but it forgets the layout on every reload: open windows, their positions and sizes, and which one was focused are all lost. Anyone who arranges a workspace has to rebuild it after each refresh or re-login.

### 2. Architecture & Design
- Track each open window's position (`x`, `y`), size, minimized or maximized state, and z-order.
- Cache the layout in `localStorage` and optionally sync it through an agent preferences endpoint so it follows the user across devices.
- On load, restore the previous windows in place, and reattach terminals and container monitors to their sessions rather than opening blank ones.

---

## 🗂️ Milestone 5: File Explorer Grid View & Details Pane

### 1. Problem Statement
The File Explorer only has a list view. Browsing photo and media folders by name alone is slow, and size, type, and dates for a large file are only visible in the row or after opening it.

### 2. Architecture & Design
- A grid view with thumbnails for images (served through the existing `/api/files/view` route, which already limits inline content to safe image types), toggled next to the list view and remembered per user.
- A collapsible details pane showing full path, size, type, timestamps, and a preview for the selected item.
- Keyboard navigation (arrows, `Enter`, `Delete`, `Ctrl+F`) already exists for the list view and should carry over to the grid.

---

## ✅ Already shipped

Earlier roadmap drafts listed a one-click update engine. It is built: the agent checks GitHub releases for a newer tag, an Update action in Settings applies it with progress streaming, and a failed update rolls back to the previous revision. Details and limits are in the changelog and `agent/services/updateManager.js`.
