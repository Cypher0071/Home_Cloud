# Contributing to Home Cloud

Thanks for wanting to help. Home Cloud is a self-hosted personal cloud (files, Docker apps, web terminal) that runs on your own machine, so every change should keep it safe to expose through a Cloudflare Tunnel.

## Local setup

Requirements: Node.js 20+, pnpm 11, Docker (for the app store and compose features), Linux recommended.

```bash
git clone https://github.com/Cypher0071/Home_Cloud.git
cd Home_Cloud
pnpm install
cp agent/.env.example agent/.env   # set PASSWORD and JWT_SECRET
pnpm dev                           # agent + dashboard together
```

Repo layout:

- `agent/`: Node.js/Express backend (auth, files, Docker, terminal, settings, updates)
- `dashboard/`: React + Vite desktop-style UI
- `landing/`: Astro landing page
- `docs/`: system design, launch checklist, technical debt

## Before you open a PR

```bash
pnpm run test:dashboard   # lint + typecheck + production build
pnpm run test:agent       # backend verification suites
pnpm test                 # everything, including e2e (needs Docker)
```

CI runs lint, the dashboard build, and the agent suites on every PR.

## Workflow

1. Open an issue first for anything bigger than a small fix, so we agree on the approach.
2. Branch from `main` (`fix/...`, `feat/...`, `docs/...`).
3. Use Conventional Commits: `feat(files): ...`, `fix(auth): ...`, `docs: ...`.
4. Keep PRs focused. Add or update a test in `agent/tests/` for backend changes.
5. Fill in the PR template.

## Code style

- ESLint config in `dashboard/` is the source of truth. No new lint warnings.
- TypeScript in the dashboard, ES modules in the agent.
- Never log secrets, passwords, or tokens. Never widen file system access without going through the storage scope checks.

## Security issues

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree your contributions are licensed under the Apache License 2.0.
