---
title: Sessions and login
description: How login is hardened, how the session cookie behaves, and how Log Out Everywhere revokes access.
sidebar:
  order: 2
---

This page describes what the agent does when you sign in, what it puts in your browser, and what it does when you sign out. The code lives in [`agent/routes/auth.js`](https://github.com/Cypher0071/Home_Cloud/blob/main/agent/routes/auth.js) and [`agent/middleware/`](https://github.com/Cypher0071/Home_Cloud/tree/main/agent/middleware).

## Login

You sign in with a password only. There is no username.

### Password check

The agent hashes both the stored password and the one you typed with SHA-256, then compares the two 32-byte results with `crypto.timingSafeEqual`. The comparison takes the same time whether the first character or the last one is wrong, and whatever the length.

### Rate limit

Failed logins are counted in a fixed window, not with exponential backoff. There are two counters.

| Counter | Limit | Result |
| --- | --- | --- |
| Per client address | 5 failures in 60 seconds | Locked out for 5 minutes |
| Per TCP peer (all clients behind it) | 30 failures in 60 seconds | Blocked until the 60 second window ends |

A blocked login gets HTTP 429 with a `Retry-After` header. While locked out, even the correct password is refused.

How the "client address" is chosen:

- It is the TCP peer address of the connection.
- If that peer is loopback (`127.0.0.1` or `::1`), which is how `cloudflared` connects, the agent uses the `CF-Connecting-IP` header instead.
- `X-Forwarded-For` is never used. A client cannot reset its count by changing that header.

Through the tunnel, every visitor reaches the agent from loopback, so the second counter is shared by all of them. It caps total guessing even if someone rotates `CF-Connecting-IP`. It ends with the window, so an attacker cannot lock you out for longer than about a minute.

A successful login clears the per-address counter. It does not clear the per-peer one.

:::note
The counters are held in memory. Restarting the service clears all lockouts. Any process on the host that connects over loopback is trusted like `cloudflared`, so it can rotate `CF-Connecting-IP` to avoid the per-address lockout. The per-peer limit still stops it.
:::

### Start-up checks

The agent will not listen if `PASSWORD` is missing, shorter than 8 characters or `change-me`. It also refuses to start if `JWT_SECRET` is missing, shorter than 16 characters or `generate-a-long-random-string`. See [Environment](/docs/configuration/environment/).

## The session cookie

After a good login the agent sets a cookie named `token`. It holds a signed JWT with two claims: that you are authorized, and the current session epoch.

| Property | Value |
| --- | --- |
| `HttpOnly` | Yes. Page scripts cannot read it. |
| `SameSite` | `Lax` |
| `Path` | `/` |
| `Domain` | Not set. The cookie is host-only. |
| `Secure` | Set when the request arrived over HTTPS, unless `COOKIE_SECURE=false` |
| Expiry attribute | None. It is a session cookie. |

**HTTPS detection.** The agent treats a request as HTTPS if the connection is secure or the `X-Forwarded-Proto` header says `https`. Through Cloudflare that header is `https`, so the cookie is `Secure`. Over plain HTTP on your LAN it is not. `COOKIE_SECURE=false` forces it off everywhere, which you should only use for a LAN-only setup.

**Host-only.** Because there is no `Domain`, the browser sends the cookie only to the exact host that set it. `dash.example.com` does not share it with `grafana.example.com`.

**Lifetime.** The token expires 7 days after login, whatever the browser does with the cookie. After that you sign in again. The expiry is not extended while you use the dashboard.

## Log out everywhere

Sessions are stateless tokens, so the agent needs a way to cancel them. It keeps a number called the session epoch in `~/.config/home-cloud/preferences.json`. Each token carries the epoch it was issued under. A token is accepted only if its epoch equals the current one.

These actions raise the epoch by one:

- The **Sign out** button in the taskbar.
- **Log Out Everywhere** in Settings, under Security & Sessions.
- Changing the password.

All three have the same effect. There is no per-device sign-out. Signing out on your laptop also signs out your phone.

When the epoch changes, the agent also acts on live connections, not only new requests:

- Open terminal and container console WebSockets are closed.
- Host terminal sessions are destroyed. The shells and what runs in them stop. A terminal session created under an older epoch can never be reattached.
- Long-lived HTTP streams end: metrics, container stats and logs, image pulls, Compose logs, Compose deploy progress and update progress.

A Compose deploy that is already running is allowed to finish. Only the revoked browser's stream ends.

The epoch is stored on disk, so revocation survives a restart. If the agent cannot save the new epoch, it refuses to change the password and tells you nothing was changed.

### Changing the password

Settings asks for the current password, then the new one twice. The agent checks the current password in constant time. It requires 8 or more characters and a value different from the current one, and rejects line breaks. It then does three things in order:

1. Raises the session epoch, which revokes every session.
2. Rewrites `PASSWORD` in `agent/.env`, using a temporary file with mode `0600` and a rename. It checks that no other key in the file changed.
3. Clears your cookie.

If step 2 fails, all sessions stay revoked. The old password still works. That failure mode is deliberate.

:::tip
If you lose a phone, use Log Out Everywhere. If you think the password leaked, change it. If you think `JWT_SECRET` leaked, changing the password is not enough, because tokens are signed with that secret. Replace `JWT_SECRET` in `agent/.env` and restart the service. Every token signed with the old secret stops working.
:::

## Origin checks

The agent checks where a request came from, to stop other websites from driving your logged-in dashboard.

- **State-changing requests** (`POST`, `PUT`, `PATCH`, `DELETE`) must carry an `Origin` header that matches the dashboard's own scheme and host. If `Origin` is missing, a matching `Referer` is accepted. If both are missing or wrong, the agent answers 403.
- **Cross-site API calls** that carry the session cookie are rejected with 403 when the browser reports `Sec-Fetch-Site: cross-site`. This applies to every method, including `GET`.
- **WebSocket upgrades** for the terminal and container console must have a matching `Origin`. Otherwise the socket is closed.

This matters because a sibling hostname such as `grafana.example.com` counts as the same site, and `SameSite` does not stop it. The `Origin` check does.

The expected host comes from `X-Forwarded-Host` if present, then `Host`. The expected scheme comes from `X-Forwarded-Proto`. If you add your own reverse proxy in front of the agent, make sure it sets those headers correctly.

:::tip
If you script the API with `curl`, add a matching header to mutating calls, for example `-H 'Origin: http://<server-ip>:3000'`. You also need the cookie from `/api/auth/login`.
:::

## Security headers

Every response carries:

| Header | Value |
| --- | --- |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Content-Security-Policy` | `frame-ancestors 'self'` |
| `X-Content-Type-Options` | `nosniff` |

The dashboard can frame its own file previews. No other site can frame the dashboard. The agent sets no other Content Security Policy and no HSTS header.

## Public endpoints

Only these `/api` paths work without a session:

- `/api/auth/*`: login and the session check. Logout itself needs a session.
- `/api/ping` and `/api/health`, which return a tiny status object. They allow any origin so the dashboard can detect your LAN server.
- `/api/lan-identity/proof`, which serves a keyed proof to direct LAN clients only. It refuses loopback and tunnel traffic. The dashboard uses it to confirm that a LAN address really is your server before switching to it.

Everything else under `/api`, and both WebSocket paths, require a valid session.

For the bigger picture see the [threat model](/docs/security/threat-model/).
