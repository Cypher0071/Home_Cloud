---
title: Updates and rollback
description: How Home Cloud finds new releases, what the one-click update does step by step, and what rollback does and does not cover.
sidebar:
  order: 5
---

Home Cloud updates itself from GitHub release tags. You start every check and every update yourself from **Settings, Updates & System**. Nothing runs in the background.

## Checking for updates

Open Settings, then Updates & System, and choose **Check for Updates**.

The agent sends one request to `https://api.github.com/repos/Cypher0071/Home_Cloud/releases/latest`. It gives up after 10 seconds. It compares the release's version with the version in the install's `package.json`. If the release is newer, the card shows **Update Available** with the release notes and a link to the release on GitHub.

Things to know:

- **There is no automatic check.** The agent never polls GitHub on a schedule. The update dot on the Settings icon only appears after a manual check in the current agent run.
- **The result is kept in memory.** Restarting the service clears it, and you check again.
- **Only the latest release counts.** Drafts and pre-releases that GitHub does not return as "latest" are not offered.
- **No releases is not an error.** If the repository has none, the card says so and shows you as up to date.
- **If GitHub is unreachable,** the card shows the error and keeps the last good result, if there is one.
- **`GITHUB_TOKEN`.** If the service has this variable set, the agent sends it as a bearer token with the request. This only raises GitHub's rate limit. It is not needed.

This is the only outbound web request the agent makes by itself. The `cloudflared` process, image pulls you start and the update steps below make their own connections. The request carries a fixed `User-Agent` of `Home-Cloud-Agent`. Home Cloud has no telemetry.

## Applying an update

After a check finds a newer release, choose **Update Now** and confirm. The update works only on an install that is a git checkout, which the installer creates. It runs as the service user.

### Step by step

1. **Pre-flight.** The agent stops if a git merge or rebase is in progress, if the working tree has unresolved conflicts, or if the install drive has less than 500 MB free. It then records the current commit SHA.
2. **Fetch.** It requires a release tag from the last check, in the form `v1.2.3`. If there is none, it refuses to continue. It never updates from the `main` branch. It runs `git fetch --tags origin` and confirms that `origin` really advertises the tag.
3. **Checkout.** `git checkout --detach <tag>`. The install is then on a detached HEAD at that tag.
4. **Install.** `pnpm install --frozen-lockfile`.
5. **Build.** `pnpm --filter dashboard build`, followed by a check that `dashboard/dist/index.html` exists.
6. **Restart.** The agent asks systemd whether it is the `home-cloud` service and whether the unit restarts itself (`Restart=always`, which the installer sets). If so, it reports 100% and, two seconds later, exits gracefully, and systemd starts it again on the new code. This needs no `sudo` or other permission. If the agent was not started by that unit, for example when you run it by hand, nothing would bring it back, so it does not exit. It reports that the update is installed and that you need to restart it yourself.

Only one update can run at a time. A second request gets a 409 error.

### What you see

A dialog shows four steps with a progress bar and the latest log line:

1. Pre-flight & Git Checkout
2. Installing Dependencies
3. Compiling Dashboard
4. Restarting Service

The progress comes from a live stream at `/api/settings/update/progress`. When the restart step begins, the dashboard polls `/api/ping` every 1.5 seconds. A ping alone is not enough, because the old process answers it until it is replaced, so the dashboard also checks that the agent is running the version that is on disk. When it is, the dashboard reloads the page.

The restart ends everything running on the agent: host terminal sessions are killed and open streams reconnect. Your login stays valid, because the signing secret and the revocation counter are on disk.

:::note
If the agent cannot restart itself, the dialog says **Restart Required** instead of **Update Complete**, and Settings keeps showing a notice until you restart it. Run:

```bash
sudo systemctl restart home-cloud
```
:::

## Rollback

Rollback is automatic and narrow. It is not a version manager.

**When it runs.** If any step fails after pre-flight records the commit SHA, the agent runs `git checkout <that SHA>`. The dialog then shows **Update Failed** with the error. Examples are a lockfile mismatch, no network, a failed build or a local change that blocks the checkout.

**What it restores.** Only the git checkout. It does not rerun `pnpm install` and it does not rebuild the dashboard. If the failure came after the install or during the build, `node_modules` and `dashboard/dist` can still reflect the new version while the source is back on the old one. The service is not restarted, so the running agent is unaffected until its next restart.

**What it does not cover.**

- A failed restart is not detected, so it does not trigger a rollback.
- The previous SHA is kept in memory for the length of the update only. After a successful update there is no "undo" button.
- Settings and data are not backed up.

### Going back by hand

To return to an earlier release after a successful update, check out its tag and rebuild. Replace the path and tag.

```bash
cd <install-dir>
git fetch --tags
git checkout v1.0.0
pnpm install --frozen-lockfile
pnpm --filter dashboard build
sudo systemctl restart home-cloud
```

The same commands, with the newer tag, update an install manually. The security notes recommend this pinned form and warn against an unpinned `git pull && pnpm install`.

You can also run `setup.sh` again. It checks out the newest published release, rebuilds the dashboard, and keeps your password and config. It does not restart a service that is already running, so run `sudo systemctl restart home-cloud` afterward. Pass `--branch <tag>` to move to a specific release instead. See [Install](/docs/getting-started/install/).

Home Cloud does not promise that a downgrade works with data written by a newer version. Back up before you update. See [Backup](/docs/operations/backup/).

If an update fails and you cannot tell why, see [Troubleshooting](/docs/operations/troubleshooting/).
