# Contributing to Home Cloud

Thank you for your interest in contributing to Home Cloud! Whether you are reporting a bug, proposing a new feature, improving documentation, or writing code, your contributions are welcome and greatly appreciated.

Please take a moment to review this document to ensure a smooth collaboration and development workflow.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Prerequisites](#prerequisites)
- [Architecture Overview](#architecture-overview)
- [Local Development Setup](#local-development-setup)
- [Verification & Testing](#verification--testing)
- [Code Standards & Guidelines](#code-standards--guidelines)
- [Commit Message Conventions](#commit-message-conventions)
- [Pull Request Process](#pull-request-process)

---

## Code of Conduct

Home Cloud follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating in this project, you are expected to uphold this code of conduct. Please report unacceptable behavior to Cypher0071 ([@Cypher0071](https://github.com/Cypher0071)).

---

## Prerequisites

Before setting up Home Cloud locally, verify that your development environment satisfies the following requirements:

- **Node.js**: `>= 22.23.4`. Node.js 20 is not supported.
- **pnpm**: `12.15.0`.
  - This is the pinned version for CI and Corepack. It is not "pnpm >= 9" and not floating `latest`.
  - If you use Corepack: `corepack enable && corepack prepare pnpm@12.15.0 --activate`.
- **Docker Engine**: Installed and running daemon.
  - Your user must belong to the `docker` group to interact with the Docker socket without root privileges:
    ```bash
    sudo usermod -aG docker $USER
    # Remember to log out and back in or run `newgrp docker`
    ```
- **Operating System**: Linux or Windows Subsystem for Linux (WSL2). Native Linux environments (Debian/Ubuntu/Fedora/Arch) or WSL2 with systemd and Docker integration enabled are recommended.

---

## Architecture Overview

Home Cloud is structured as a pnpm workspace monorepo consisting of three primary packages:

```
home_cloud/
├── agent/            # Node.js backend daemon (Host & Docker management)
├── dashboard/        # React 19 desktop Web OS frontend
├── landing/          # Astro 7 marketing site
├── package.json      # Workspace root scripts and dependencies
└── pnpm-workspace.yaml
```

### 1. `agent/`
- **Stack**: Node.js, Express 5, Dockerode, `systeminformation`, `node-pty`, `ws` (WebSockets).
- **Role**: The daemon runs locally with host-level access. It monitors system performance (CPU, memory, storage, temperature), interfaces with the Docker socket for container lifecycle operations, provides secure WebSocket-based interactive terminal sessions, manages drive mounting/storage scopes, and handles Cloudflare Tunnel automation.
- **Port**: Listens on `process.env.PORT` (default `3000`), set in `agent/.env`.

### 2. `dashboard/`
- **Stack**: React 19, TypeScript, Vite, CSS modules and `dashboard/src/index.css`, Lucide, xterm.js. No Tailwind.
- **Role**: A responsive desktop-style workspace: draggable and resizable windows, real-time telemetry, an interactive shell, Docker container management, a file explorer, and settings. There is no app store.
- **Port**: Serves on port `5173` during development and proxies API calls (`/api`) and WebSocket connections (`/terminal`, `/ws`) to the agent backend.

### 3. `landing/`
- **Stack**: Astro 7, the project's own CSS, and the fonts Geist, JetBrains Mono, and Instrument Serif. No Tailwind.
- **Role**: Fast, static marketing and distribution site showcasing Home Cloud features, architecture diagrams, and quickstart installation commands.
- **Port**: Serves on port `4321` via `pnpm dev:landing`.

---

## Local Development Setup

### 1. Clone Repository

```bash
git clone https://github.com/Cypher0071/Home_Cloud
cd Home_Cloud
```

### 2. Install Workspace Dependencies

```bash
pnpm install
```

### 3. Configure the Agent Environment

Create a local `.env` file for the agent daemon from the provided template:

```bash
cp agent/.env.example agent/.env
```

Copying `agent/.env.example` and starting the agent without changing `PASSWORD` and `JWT_SECRET` will refuse to boot. `PASSWORD` must be at least 8 characters and must not be `change-me`. `JWT_SECRET` must be at least 16 characters and must not be `generate-a-long-random-string`.

Open `agent/.env` and update the required values:

```env
PASSWORD=your-secure-password
JWT_SECRET=your-random-generated-secret-key

# Optional settings
# PORT=3000
# BASE_DIR=/home/your-user
# COOKIE_SECURE=false  # Set false if testing over plain HTTP on LAN
```

### 4. Start the Development Environment

Run the agent and dashboard concurrently in watch mode:

```bash
pnpm dev
```

- **Dashboard UI**: [http://localhost:5173](http://localhost:5173)
- **Agent API**: [http://localhost:3000](http://localhost:3000)

To run the marketing landing site instead:

```bash
pnpm dev:landing
```

---

## Verification & Testing

Always verify your changes by executing the test suite and linters before committing or creating a pull request.

### Run All Tests

Runs the dashboard verification, agent verification test suites, and end-to-end scripts:

```bash
pnpm test
```

### Targeted Commands

- **Dashboard Linting**:
  ```bash
  pnpm --filter dashboard lint
  ```
  Ensure all ESLint rules pass with zero warnings or errors.

- **Dashboard TypeScript & Build Verification**:
  ```bash
  pnpm --filter dashboard build
  ```
  Runs `tsc -b` and the Vite production build to guarantee type safety and bundle integrity.

- **Agent Integration & Security Tests**:
  ```bash
  pnpm run test:agent
  ```
  Verifies authentication, network security, drive caches, Cloudflare tunnel setup, compose parser, storage scopes, session revocation, and update managers.

- **End-to-End Tests**:
  ```bash
  pnpm run test:e2e
  ```
  Runs automated terminal and compose refactor tests.

---

## Code Standards & Guidelines

### TypeScript & JavaScript
- **Strict Mode**: TypeScript strict checking is enabled. Always declare clear interfaces and types; avoid using `any`.
- **Formatting**: Keep code clean, readable, and properly indented. Preserve existing comments and docstrings.
- **No Warnings**: ESLint warnings should be treated as errors. Resolve any unused variables, missing dependencies, or unhandled promises.

### Dashboard (React 19)
- **Functional Components**: Write pure, functional React components leveraging React 19 hooks (`use`, `useActionState`, `useOptimistic` where appropriate, along with standard hooks).
- **Modularity**: Break down large views into focused, reusable components with clear prop interfaces.
- **Styling**: Use CSS modules and the shared rules in `dashboard/src/index.css`. Do not add Tailwind. The landing site uses its own CSS, not Tailwind. Follow accessibility standards, including ARIA attributes and keyboard navigation.

### Agent (Express 5 & Node.js)
- **Route & Middleware Separation**: Keep routes lean by delegating logic to dedicated services (`agent/services/`) and middlewares (`agent/middleware/`).
- **Security**: Always sanitize inputs, validate paths against directory traversal (`path.resolve` / prison checks), and enforce authentication guards on protected endpoints.
- **Async Handling**: Use async/await with clean error propagation and standard HTTP status codes.

---

## Commit Message Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/). Humans update [CHANGELOG.md](CHANGELOG.md). Nothing in this repository generates that file.

### Format
```text
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

### Commit Types
- `feat`: A new user-facing or agent capability
- `fix`: A bug fix
- `docs`: Documentation updates or additions
- `refactor`: Code changes that neither fix a bug nor add a feature
- `test`: Adding missing tests or correcting existing tests
- `chore`: Maintenance tasks, dependency updates, tooling adjustments
- `perf`: Performance improvements
- `style`: Changes that do not affect the meaning of the code (formatting, white-space)

### Examples
- `feat(dashboard): add real-time GPU metrics graph`
- `fix(agent): prevent directory traversal in file manager route`
- `docs: update setup instructions in CONTRIBUTING.md`
- `test(agent): add test case for session revocation`

---

## Pull Request Process

1. **Branch Naming**: Create a topic branch from `main` using descriptive naming:
   - `feat/feature-name`
   - `fix/issue-description`
   - `refactor/component-name`
   - `docs/topic-name`
2. **Local Verification**: Run all tests and linters locally before submitting:
   ```bash
   pnpm test
   pnpm --filter dashboard lint
   pnpm --filter dashboard build
   ```
3. **Open Pull Request**:
   - Provide a concise summary of the changes and motivation.
   - Reference any related issues (e.g., `Closes #42` or `Fixes #108`).
   - Include screenshots or screen recordings for UI/UX modifications.
4. **Code Review**: Address feedback promptly. Once approved and CI checks pass, maintainers will merge your contribution.
