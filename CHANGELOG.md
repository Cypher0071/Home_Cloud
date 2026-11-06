# Changelog

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
