# Changelog

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
