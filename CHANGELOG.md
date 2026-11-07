# Changelog

## 1.4.0

Port checks in the Run form, cloudflared kept up to date with each release, and correct memory and storage numbers in the System Monitor.

### Added

- The Run Container form pre-fills container ports from the ports the image declares and suggests a free, browser-safe host port for each. Each row is checked as you type. A host port already used by a container or host program, a duplicate, or a malformed or half-filled row is an error. A browser-blocked port, an undeclared container port, or a port reserved by a stopped container is a warning. Most issues come with a one-click fix. The agent repeats the hard checks when the container is created. Any number of containers can listen on the same port inside; only host ports must be unique.
- cloudflared now updates with Home Cloud. Each release pins a cloudflared version (now 2026.10.7). On startup, if the installed cloudflared is older, the agent downloads the pinned build, checks it against Cloudflare's published SHA256, keeps it in `~/.local/share/home-cloud/bin`, and restarts the tunnel on it. If anything fails, the working binary is kept or restored. `setup.sh` installs the same pinned version.

### Fixed

- Memory "In Use" and the memory percentage no longer count the disk cache Linux keeps in spare RAM, so In Use no longer equals Available. The System Monitor shows the cache and unused memory as separate rows.
- Storage metrics count each real disk once. Docker's per-container `overlay` mounts, bind mounts and WSL internals are no longer listed as extra partitions or added to the total. The Files sidebar shows the disk that holds the storage folder first.
- Settings no longer shows an update as available from a stale cached check, and treats an older agent that does not report `restartRequired` as needing a restart.

## 1.3.0

Docker run failures are caught and explained, database run presets, and fixes for the container tabs and the Updates panel.

### Added

- Starting, restarting or running a container now watches it for a moment. If it exits straight away or crash-loops under a restart policy, the request fails with the reason taken from the container logs instead of reporting success, and the crash logs show in the Run Container dialog. A container that fails on first creation is removed, so it cannot leave a stale name behind.
- Run presets for the official `postgres`, `mysql` and `mariadb` images with the required password field, default ports pre-filled, and submit blocked until the required values are set.
- When the new version needs a manual restart (the agent is not under systemd), Settings says so and shows a "Restart Required" notice instead of claiming the update is complete.

### Fixed

- Opening a container's Logs or Shell no longer jumps to Stats or Inspect when the container list refreshes.
- After an update, Settings no longer keeps showing "Update Available" for the version that is already running. The status now reports the live installed version, and a cached check can no longer go stale.
- Release notes in Settings render as formatted text (headings, lists, code, bold, links) instead of raw Markdown. Only `http` and `https` links are followed, and no HTML from the notes is injected.
- Generated passwords no longer contain `$`, which Docker Compose treats as a variable, and use `crypto.getRandomValues`.
- Dropped streams during an image pull now show a clear error.

## 1.2.1

Fixes the installer on fresh machines.

### Fixed

- A first install stopped at the credentials step with `Cannot find module 'dotenv'`. The installer read `agent/.env` with the agent's `dotenv` package before `pnpm install` had run, so it failed wherever `agent/node_modules` did not exist yet. Dependencies are now installed before that step. This affected every fresh install since 1.0.1. A machine that stopped at this point can rerun the install command; the rerun resumes and keeps the `JWT_SECRET` it already generated.
- The installer tests now cover an interruption during the dependency install and a failure at the credentials step, each followed by a clean rerun, and check that dependencies are installed before the credentials step.

## 1.2.0

Faster, ranked file search with keyboard navigation in Files, a warning before deploying risky Compose files, and copy that works over the LAN address.

### Added

- File search walks the folder tree in the agent and ranks results: exact names first, then names that start with the query, then names that contain it, then path and fuzzy matches. Every word in the query must match. Hidden files, `node_modules`, symlinks and virtual filesystems (`/proc`, `/sys` and similar) are skipped unless a search word starts with a dot. A search stops after 4 seconds or 200,000 entries and says when results are cut short.
- Search results show a match count and the folder each result is in, so files with the same name can be told apart.
- Keyboard navigation in Files: Ctrl+F focuses search, the arrow keys move the selection (Shift extends it), Home and End jump to the first and last item, Enter opens, Delete deletes, and Esc clears the search.
- The Compose deploy dialog warns, without blocking, when a file mounts the Docker socket or a system path such as `/` or `/etc`, runs privileged, uses the host network or PID namespace, maps devices, or adds powerful capabilities.

### Fixed

- Copy buttons (the SSH config snippet, file paths, and container JSON) work over the plain HTTP LAN address, where the browser clipboard API is unavailable.
- Selecting, renaming or deleting one of several search results with the same name acts on that file only.
- A narrow Files window no longer scrolls the whole window sideways when the path is long. The breadcrumb strip scrolls on its own, and the status bar path is shortened from the left.

### Changed

- The `cookie` dependency is updated to 2.0.1, along with `axios`, `@babel/core`, `typescript-eslint` and `follow-redirects`.
- The developer docs in `docs/` are trimmed to the current architecture, design language, roadmap and known tradeoffs.

## 1.1.0

Remote SSH over the tunnel, an installer that sets up its own prerequisites, stronger session and ingress handling, and a new website with full documentation.

### Added

- Remote SSH through the Cloudflare Tunnel. The installer publishes `ssh.<your-domain>` to the host's OpenSSH server and makes tunnel connections key-only. Settings has a Remote SSH Access card with a copyable `~/.ssh/config` snippet. Ports 22 and 3001, and the `dash` and `ssh` hostnames, cannot be exposed or removed from the dashboard.
- The installer installs and enables the OpenSSH server, allows it and port 3000 through an active UFW firewall, and stops a laptop lid from suspending the machine. `--skip-ssh` and `--skip-lid` opt out.
- A new website at home-cloud.live with an interactive demo, a comparison table, an FAQ and a security overview, and documentation under `/docs` covering install, every app, configuration, security and operations. The site redeploys on every push to `main` and on every published release.
- The security audit report and the known limitations are published in the repository under `docs/security_audit/` and `SECURITY.md`.

### Changed

- The installer installs the latest published GitHub release, never unreleased commits on `main`. Re-running it on an existing install moves it to the newest release, but does not restart a running service. `--branch <tag>` (or `HOME_CLOUD_BRANCH`) pins a version.
- Node.js and Docker no longer have to be installed first. If Node.js `>= 22.23.4` with corepack is missing, the installer downloads Node.js `24.22.2` from nodejs.org, checks its SHA256 and unpacks it into `/opt/home-cloud`, leaving any existing Node.js alone. If Docker is missing, it installs Docker Engine and the Compose plugin from Docker's signed repository after checking the signing key fingerprint, falling back to the distribution's packages.
- The installer checks that systemd is running before it installs anything. On WSL it enables systemd in `/etc/wsl.conf` and asks for a `wsl --shutdown`.
- Setup runs are interruption-safe. The installer keeps a journal and a lock in `~/.local/state/home-cloud`, so an interrupted run can be repeated and two runs cannot collide.
- The Node.js minimum is now `22.23.4`, the version Astro needs to build. pnpm is pinned to `12.15.0`. Workspace dependencies are updated.

### Security

- Logging out, or changing the password, now also closes open WebSockets, HTTP streams and detached terminal sessions, not only new requests.
- Login also has an aggregate limit of 30 failed attempts per minute from one network peer, on top of the existing 5 failures per address.
- Pulling an image is POST-only. A GET to the pull route returns 405.
- Responses send `X-Frame-Options: SAMEORIGIN`, `Content-Security-Policy: frame-ancestors 'self'` and `X-Content-Type-Options: nosniff`, so a sibling subdomain cannot frame the dashboard.
- Before switching to your local address, the dashboard checks a keyed proof that the address really is your server. The proof is refused for requests that arrive through the tunnel.
- Ingress rules for a container or stack are removed when it is deleted or redeployed, including when a deploy fails.
- An update installs with `pnpm install --frozen-lockfile` only. It no longer falls back to an unpinned install, so a lockfile mismatch fails the update and rolls back.

### Fixed

- Ingress validation no longer fails when `cloudflared` is not installed.
- Dev login works through the Vite proxy.

## 1.0.1

Security, installer, dependency, and documentation fixes.

- Login lockout is a fixed window: 5 failures within 60 seconds, then a 5 minute lockout. The window uses the TCP peer address. `CF-Connecting-IP` is honored only when that peer is loopback. Rotating `X-Forwarded-For` does not reset it.
- Logout and "log out everywhere" both increment `sessionEpoch` and reject old JWTs on HTTP and WebSocket. The session cookie is host-only. State-changing requests and WebSocket upgrades must present an `Origin` (or `Referer` when `Origin` is missing) that matches the dashboard host. That check does not add a login wall to exposed apps.
- Safe Server Mode still limits file routes. Wallpaper reads allow only `.png`, `.jpg`, `.jpeg`, `.webp`, and `.gif` under `~/.config/home-cloud`. File view is an attachment except for those images, and sets `X-Content-Type-Options: nosniff`. HTML and SVG are not inline.
- The agent refuses to listen when `PASSWORD` or `JWT_SECRET` is missing, too short, or still a placeholder.
- Ingress autowiring writes `~/.cloudflared/config.yml` and restarts `cloudflared`. It does not call the Cloudflare DNS API. If `CF_DOMAIN` is unset, it does not write that file. The installer publishes DNS only for `dash.$DOMAIN`.
- The installer expects Node.js `>= 22.13` and Docker to be installed already. It installs pnpm `11.28.8` with corepack. `cloudflared` `2026.10.3` is optional and is downloaded only after SHA256 verification. It does not pipe NodeSource, `get.pnpm.io`, `get.docker.com`, or `cloudflared` `releases/latest`. The systemd unit runs as the install user. The installer refuses `User=root` when there is no `SUDO_USER` and no `HOME_CLOUD_SERVICE_USER`.
- Update rollback checks out the previous git SHA. It does not rebuild the previous `dashboard/dist` by itself. Apply accepts only a release tag advertised by `origin`.
- Production dependencies with published advisories were bumped or overridden, including `multer`, `qs`, `body-parser`, `proxy-addr`, `js-yaml`, `protobufjs`, `@grpc/grpc-js`, `axios`, and `react-router`. pnpm is pinned to `11.28.8`.
- Docs and metadata now match Apache-2.0, the supported platforms, and the features that ship. The only private vulnerability channel is [GitHub Security Advisories](https://github.com/Cypher0071/Home_Cloud/security/advisories/new).

## 1.0.0

Initial public release.
