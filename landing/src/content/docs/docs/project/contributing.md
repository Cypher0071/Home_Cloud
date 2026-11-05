---
title: Contributing
description: Set up a development environment, run the tests, and open a pull request.
sidebar:
  order: 2
---

This page summarizes [CONTRIBUTING.md](https://github.com/Cypher0071/Home_Cloud/blob/main/CONTRIBUTING.md). That file is the source of truth. Everyone taking part is expected to follow the [Code of Conduct](https://github.com/Cypher0071/Home_Cloud/blob/main/CODE_OF_CONDUCT.md).

Home Cloud is Apache-2.0 licensed. Bug reports, feature ideas, docs and code are all welcome.

## Prerequisites

- Linux, or Windows with WSL2. Native Linux, or WSL2 with systemd and Docker integration enabled, is recommended.
- Node.js 22.23.4 or newer. Node.js 20 is not supported.
- pnpm 12.15.0, the pinned version. With corepack: `corepack enable && corepack prepare pnpm@12.15.0 --activate`.
- Docker Engine running, with your user in the `docker` group.

## Repository layout

The repository is a pnpm workspace with three packages:

| Package | What it is |
| --- | --- |
| `agent/` | The Node.js and Express 5 backend. |
| `dashboard/` | The React 19 and Vite dashboard. |
| `landing/` | The Astro site you are reading, docs included. |

See [Architecture](/docs/project/architecture/) for how the first two fit together.

## Set up

```bash
git clone https://github.com/Cypher0071/Home_Cloud
cd Home_Cloud
pnpm install
cp agent/.env.example agent/.env
```

The example file holds placeholders, and the agent refuses to start with them. Edit `agent/.env` first:

- `PASSWORD`: at least 8 characters, not `change-me`.
- `JWT_SECRET`: at least 16 characters, not `generate-a-long-random-string`.

If you log in over plain HTTP on your LAN, you can also set `COOKIE_SECURE=false`. Never commit `.env`.

## Run it

Start the agent and the dashboard together in watch mode:

```bash
pnpm dev
```

- Dashboard: `http://localhost:5173`
- Agent API: `http://localhost:3000`

Vite proxies `/api`, `/terminal` and `/ws` to the agent. To work on the landing site and docs instead:

```bash
pnpm dev:landing
```

That serves on `http://localhost:4321`.

## Test and lint

Run everything before you open a pull request:

```bash
pnpm test
```

It runs the dashboard lint, build and code-splitting check, then the agent suite, then the end-to-end scripts. You can run the parts on their own:

```bash
pnpm --filter dashboard lint
pnpm --filter dashboard build
pnpm run test:agent
pnpm run test:e2e
```

Each test file runs with a temporary home directory, so the tests do not touch your real `~/.config` or `~/.cloudflared`.

CI runs lint, a type check, the dashboard and landing builds, the full test suite, and an installer check on every push to `main` and every pull request to `main`. If you change `setup.sh`, run the same checks locally:

```bash
bash -n setup.sh
./setup.sh --help
./setup.sh --dry-run
```

`--dry-run` verifies prerequisites and configuration without changing your system.

## Code standards

- TypeScript is strict. Avoid `any`. Treat ESLint warnings as errors.
- Dashboard: functional components, CSS modules plus `dashboard/src/index.css`, and no Tailwind. Follow accessibility basics such as ARIA attributes and keyboard navigation.
- Agent: keep routes thin and put logic in `agent/services/` and `agent/middleware/`. Validate paths against traversal, sanitize input, and put authentication on protected endpoints. Use async/await and proper HTTP status codes.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<optional scope>): <description>
```

Allowed types are `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf` and `style`. Examples:

- `feat(dashboard): add real-time GPU metrics graph`
- `fix(agent): prevent directory traversal in file manager route`

`CHANGELOG.md` is edited by hand. Nothing generates it.

## Pull requests

1. Branch from `main` with a descriptive name: `feat/...`, `fix/...`, `refactor/...` or `docs/...`.
2. Run `pnpm test`, `pnpm --filter dashboard lint` and `pnpm --filter dashboard build`.
3. Open the pull request using the template. Summarize the change and why, link issues with `Closes #42` or `Fixes #108`, tick the type and scope boxes, and add screenshots or a recording for UI changes.
4. Respond to review. When it is approved and CI passes, a maintainer merges it.

## Security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](https://github.com/Cypher0071/Home_Cloud/blob/main/SECURITY.md) and see [Reporting a vulnerability](/docs/security/reporting/).
