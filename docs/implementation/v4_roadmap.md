# Home Cloud — V4 Operations & Resiliency Roadmap

This document outlines the container operations, automated maintenance, and desktop workspace enhancements planned for **V4** of Home Cloud once the system is running autonomously on the host server.

---

## 🎯 V4 Milestones & Checkpoints

### Phase 1: Container Crash Watchdog & Webhook Notifications 🔔

This feature monitors container health in the background and immediately dispatches alerts if a critical service crashes or enters a restart loop, without requiring heavy external monitoring tools like Prometheus.

* [ ] **Container Watchdog Engine:**
  * Lightweight background polling worker in the Node.js Agent utilizing the Docker events stream (`docker.getEvents()`) and health check APIs.
  * Real-time detection of non-zero container exit codes (`exited`), failed health checks (`unhealthy`), and OOM (Out Of Memory) kills.
  * Exponential throttling and debounce to prevent notification spam during rapid crash loops.
* [ ] **Webhook Alert Dispatcher:**
  * Outbound webhook integration supporting **Telegram Bots** (`chat_id` + Bot Token) and **Discord Webhooks** (`webhook_url`).
  * Formatted alert cards containing container name, image, exit code, timestamp, and the last 10 lines of container error logs.
* [ ] **Notification Settings UI:**
  * Dedicated settings view in the dashboard to configure webhook destinations, test alert delivery, and toggle specific alert types (Crash, OOM, High Memory).

---

### Phase 2: Simple Automated Volume & Database Backups 💾

This feature ensures application data and state stored inside Docker volumes and bind mounts can be safely backed up and restored without manual command-line intervention.

* [ ] **Automated Volume Snapshots:**
  * Stream-based archive creation (`.tar.gz`) for Docker named volumes and container data directories directly to a designated host backup location.
  * Point-in-time database dump triggers (e.g. `pg_dump` or `mysqldump` executed directly through `docker exec`).
* [ ] **Cron-Scheduled Backup Policies:**
  * Configurable backup frequency (daily, weekly, or custom cron expression) with automatic retention rotation (e.g., keep last 7 daily, 4 weekly snapshots).
* [ ] **Backup Management & Download UI:**
  * Dashboard panel to list available snapshots, view size and creation timestamps, trigger manual backup runs, and download archives directly through the browser.

---

### Phase 3: Desktop Window Layout State Persistence 🖥️

This feature transforms the browser experience from a transient session into a persistent operating environment that remembers exactly how you left your workspace.

* [ ] **Window Layout Persistence Store:**
  * Track open window states, position coordinates (`x`, `y`), dimensions (`width`, `height`), minimized/maximized state, and active z-index stacking order.
  * Client-side persistent cache in `localStorage` synchronized with an agent user profile endpoint for cross-device continuity.
* [ ] **Workspace Session Restoration:**
  * On dashboard login or page reload, automatically restore previously opened windows in their exact positions and sizes.
  * Seamless integration with lazy code-splitting and persistent terminal sessions, reattaching terminal and container monitors smoothly on reload.

---

### Phase 4: One-Click Auto-Update Engine & Release Pipeline 🔄

This feature allows Home Cloud to check for updates, verify release authenticity, pull upstream revisions, rebuild the client dashboard, and reload the systemd service seamlessly with zero manual terminal SSH intervention.

* [ ] **Release Tag & Manifest Polling:**
  * Background agent service periodically checks GitHub Releases API (`api.github.com/repos/:owner/:repo/releases/latest`) or Git remote tags.
  * Compares current semantic version (`package.json`) against upstream latest release notes, changelogs, and breaking change warnings.
  * Configurable update channels: `stable` (tagged GitHub releases only) vs `nightly`/`edge` (`main` branch commits).
* [ ] **Safe Self-Update Execution Pipeline:**
  * Automated migration runner executing:
    1. Pre-flight health checks (ensures disk space via `df`, checks git clean working tree).
    2. Git pull / fast-forward merge of latest verified release tag.
    3. Monorepo dependency resolution (`pnpm install --frozen-lockfile`).
    4. Frontend dashboard rebuild (`pnpm --filter dashboard build`).
    5. Database/config schema migrations if applicable.
    6. Systemd service restart (`systemctl restart home-cloud` via agent worker or detached supervisory spawn).
* [ ] **Rollback Capability & Health Watchdog:**
  * Auto-rollback to previous Git commit/tag if the post-update agent health check (`GET http://localhost:3000/api/health`) fails or throws unhandled startup exceptions within 30 seconds.
* [ ] **Dashboard Update Management UI:**
  * Badge indicator in Desktop Dock/Settings app alerting the user when an update is available.
  * Modal view displaying Markdown release notes, changelog highlights, and a 1-click **"Update Now"** action with real-time SSE progress streaming.
  * Optional toggle for automated overnight unattended updates.

