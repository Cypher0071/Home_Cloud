# Dashboard

The Home Cloud web UI. See the [root README](../README.md) for what the project is, how to install it, and how the agent and this package fit together.

Requires Node.js `>= 22.13` and pnpm `11.28.8`. There is no Tailwind setup in this package. Styles are CSS modules plus `src/index.css`.

## Develop

From the repository root:

```bash
pnpm --filter dashboard dev
```

The Vite dev server runs on port 5173 and proxies API and WebSocket requests to the agent (default `http://localhost:3000`).

## Build

```bash
pnpm --filter dashboard build
```

Production assets are written to `dashboard/dist`. The agent serves that directory.
