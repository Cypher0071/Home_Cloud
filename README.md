# Home Cloud

Personal control plane for one Linux box behind CGNAT: dashboard, files, host terminal, Docker, Cloudflare Tunnel.

Not CasaOS. Not multi-user. The login passcode is root on that machine (shell + Docker).

## What a friend needs

- Linux, Node.js, pnpm, Docker (user in the `docker` group)
- `cloudflared` already logged in, with a **named tunnel**
- A domain on Cloudflare: `dash.<your-domain>` and `*.<your-domain>` pointing at that tunnel
- `~/.cloudflared/config.yml` with `dash.<your-domain> → http://localhost:<PORT>` and a catch-all `http_status:404`

## Run

```bash
pnpm install
cp agent/.env.example agent/.env
# set PASSWORD, JWT_SECRET, CF_DOMAIN, TUNNEL_NAME
pnpm --filter dashboard build
pnpm --filter agent start
```

If `BASE_DIR` is unset, the file explorer **and container bind mounts** are jailed to **that user’s home directory**, not `/home/rudra-unix`. Compose YAML can still declare any host path — that is `docker compose`, not this form.

Dev: `pnpm dev` (agent + Vite). Vite runs on `http://localhost:5173` with proxy configured for `/api` and WebSockets to the agent on `http://localhost:3000`.

## Env (agent/.env)

| Variable | Default | Meaning |
|---|---|---|
| `PASSWORD` | (required) | Login passcode |
| `JWT_SECRET` | (required) | Cookie signing key |
| `BASE_DIR` | `os.homedir()` | File explorer root |
| `PORT` | `3000` | Agent HTTP/WS |
| `CF_DOMAIN` | `home-cloud.live` | Public DNS zone |
| `TUNNEL_NAME` | `home-cloud` | `cloudflared tunnel run <name>` |
| `CF_CONFIG` | `~/.cloudflared/config.yml` | Ingress file the agent edits |
| `COOKIE_SECURE` | `true` | Set `false` only for raw HTTP on LAN |
