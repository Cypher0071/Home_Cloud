# Security Policy

The Home Cloud team and community take the security of personal cloud infrastructure seriously. Home Cloud is designed as a single-tenant personal cloud operating system and control plane for private Linux hardware. This document outlines our supported versions, vulnerability reporting process, and comprehensive threat model.

---

## 1. Supported Versions

We provide security updates and patches for active release streams. Please ensure your installation is running a supported version to receive critical security fixes.

| Version | Supported | Status / Notes |
| :--- | :---: | :--- |
| **1.0.x** | :white_check_mark: | Current active release branch. Receives security patches, bug fixes, and critical updates. |
| **< 1.0.0** | :x: | End of Life (EOL). Unsupported. Users must upgrade to 1.0.x or newer. |

---

## 2. Reporting a Vulnerability

We appreciate the responsible, coordinated disclosure of security vulnerabilities by security researchers, operators, and community contributors.

### Strictly Private Disclosure
> [!IMPORTANT]
> **Do not report security vulnerabilities through public GitHub issues, discussions, pull requests, or public chat channels.**
> Publicly disclosing an in-the-wild zero-day puts personal server deployments at risk before a fix can be verified and deployed.

### Disclosure Channels
The only private channel is a GitHub Security Advisory:

[https://github.com/Cypher0071/Home_Cloud/security/advisories/new](https://github.com/Cypher0071/Home_Cloud/security/advisories/new)

Sign in to GitHub to open a confidential report there. Do not email vulnerability details, and do not use public issues, discussions, or pull requests.

### Required Information in Reports
To help us triage and remediate the issue quickly, please include as much of the following details as possible:
- **Summary**: A concise description of the vulnerability and its potential consequences.
- **Vulnerability Class**: Standard classification (e.g., CWE identifier, OWASP category such as Arbitrary File Read, Command Injection, Privilege Escalation, CSRF, Authentication Bypass).
- **Reproduction Steps / Proof-of-Concept (PoC)**: Clear, reproducible, step-by-step instructions, curl commands, or script demonstrating the issue in an isolated environment.
- **Affected Components**: Specify which modules are impacted (e.g., Express Agent API, WebSocket terminal daemon, Docker engine proxy, Storage Scope engine, or Dashboard frontend).
- **Potential Impact**: An assessment of the attack vector, prerequisites, required attacker privileges, and realistic operational impact on the host.
- **Proposed Remediation**: Any suggested code changes, patch snippets, or workarounds (optional but appreciated).

### Response & Remediation
- **Triage & Acknowledgment**: We will review reports received through GitHub Security Advisories and confirm whether we can reproduce the behavior.
- **Patch Development & Updates**: We will provide updates as a patch is drafted, tested, and reviewed in private.
- **Coordinated Disclosure Timeline**: We adhere to coordinated vulnerability disclosure. A mutual disclosure date (typically 30 to 90 days, or immediately following release of the patched version) will be agreed upon before releasing public release notes, advisories, or CVE numbers.

---

## 3. Home Cloud Security & Threat Model

Home Cloud operates at the boundary between remote browser clients, container runtimes, host filesystems, and the Linux operating system. Understanding the threat model ensures secure deployment and operation.

### A. Single-Tenant Personal Cloud Architecture
Home Cloud is intentionally designed as a **single-tenant personal cloud operating system**:
- It is intended for private individuals, homelab enthusiasts, and household server administration on dedicated host hardware.
- Unlike multi-tenant SaaS platforms or consumer app-store appliances with complex multi-user RBAC overhead, Home Cloud operates under a single administrative ownership model.
- Authenticated access grants administrative authority over configured host resources; therefore, defense-in-depth relies on strict perimeter defense, strong authentication, and hardened process isolation.

### B. Network Boundary & Ingress Defense
- **Encrypted Outbound Tunneling**: Remote internet access is brokered through **Cloudflare Zero-Trust Named Tunnels (`cloudflared`)**.
  - No public router ports (e.g., 80, 443, 3000) or dynamic DNS forwarding rules are ever required on your residential router.
  - Fully compatible with Carrier-Grade NAT (CGNAT) and strict firewall environments.
  - External traffic terminates on Cloudflare's edge, then travels to the host over an outbound `cloudflared` connection using QUIC or HTTP/2. This is not WireGuard.
- **Local LAN Acceleration with Boundary Isolation**: 
  - Clients connected to the local home network can access the dashboard directly via the local IP address for zero-latency file transfers.
  - Both remote and local interfaces enforce the exact same cryptographic authentication and rate-limiting barriers.

### C. Storage Scope Boundary & Directory Traversal Defense
Home Cloud includes a built-in **Storage Scope Engine** that strictly governs filesystem interaction through the API:
- **Safe Server Mode (Default)**:
  - Safe Server Mode still jails file routes. Navigation, reads, writes, and uploads stay inside the user's home directory (`$HOME`), `/mnt`, `/media`, `/run/media`, `/srv`, and explicitly allowed custom paths.
  - Wallpaper reads only allow `.png`, `.jpg`, `.jpeg`, `.webp`, and `.gif` under `~/.config/home-cloud`.
  - File view sends `Content-Disposition: attachment` except for those image types, and sets `X-Content-Type-Options: nosniff`. HTML and SVG are not inline.
  - Operating system configuration and binaries outside allowed boundaries cannot be traversed or modified via storage APIs.
- **Full System Root Access Mode**:
  - Requires explicit administrator opt-in in settings (`allowSystemRoot: true`) for power users managing entire servers.
- **Hard-Blocked Virtual Kernel Filesystems**:
  - Regardless of whether Safe Server Mode or Full System Root Access is active, virtual pseudo-filesystems (`/proc`, `/sys`, `/dev`) are **unconditionally hard-blocked** across all file explorer operations.
  - This prevents denial-of-service hangs, kernel memory leaks, infinite synthetic directory recursion, and unintended raw block-device manipulation.
- **Canonical Path Resolution**:
  - All requested paths are canonicalized using strict realpath verification (`fs.realpathSync`) to mitigate symlink evasion, null-byte injection, and path traversal (`../`) attacks.

### D. Authentication, Session Defense & Brute-Force Protection
- **Constant-Time Cryptographic Verification**:
  - Passwords are validated using Node.js `crypto.timingSafeEqual`.
  - Input strings are pre-hashed with SHA-256 prior to comparison to normalize buffer lengths to 32 bytes, eliminating variable-length timing leaks and buffer mismatch exceptions.
- **Fixed-window login lockout**:
  - The limit is not exponential backoff. 5 failures within 60 seconds produce a 5 minute lockout.
  - The window uses the TCP peer address. `CF-Connecting-IP` is honored only when that peer is loopback (the local `cloudflared`). Clients cannot rotate `X-Forwarded-For` to reset the window.
- **Server-side session revocation**:
  - Authentication tokens (JWT) embed a `sessionEpoch` identifier.
  - Logout and "log out everywhere" both increment `sessionEpoch`.
  - Old JWTs are rejected on HTTP and on WebSocket upgrades (terminal and container exec).
  - `clearCookie` uses the same `httpOnly`, `sameSite`, `secure`, and `path` flags as login.
- **Host-only cookie and same-site checks**:
  - The cookie is `HttpOnly`, `SameSite=Lax`, and host-only (no `Domain` attribute). It is `Secure` on HTTPS.
  - It is not sent to `grafana.example.com` or other apps.
  - Sibling hostnames are still the same site, so the agent requires the request `Origin` (or `Referer` if `Origin` is missing) to match the dashboard host on `POST`, `PUT`, `PATCH`, and `DELETE`. WebSocket upgrades require a matching `Origin`.
  - This does not add a login wall to exposed apps.
- **Startup secret refusal**:
  - The agent refuses to listen if `PASSWORD` is missing, shorter than 8 characters, or `change-me`.
  - The agent refuses to listen if `JWT_SECRET` is missing, shorter than 16 characters, or `generate-a-long-random-string`.

### E. Privilege & Host Execution Guidelines
Home Cloud executes host processes, Docker APIs, and shell sessions. Deployments must adhere to the following privilege guidelines:
- **Dedicated Unprivileged Service User**:
  - Home Cloud should always run under a dedicated, non-root system user account (e.g., `homecloud` or the primary desktop/server user).
  - The user account must be granted membership in the `docker` group (`usermod -aG docker <user>`) to manage containers without requiring root privileges for the Node.js agent process.
- **Never Run Directly as `root`**:
  - Do not set `User=root` in the systemd service unit or run `index.js` as the root user.
  - Running as an unprivileged user ensures that any spawned host shell (`node-pty`) or system process inherits normal user permissions and requires explicit `sudo` authentication to perform root-level mutations.
- **Docker Socket Security**:
  - Access to `/var/run/docker.sock` confers significant authority over the host. Ensure the Docker daemon socket is restricted to root and the `docker` group (`660` permissions).
  - Use trusted container images and audit container volumes to avoid mounting sensitive host directories (`/etc`, `/boot`, `/root`) into untrusted third-party containers.

---

## 4. Security Audit Checklist for Operators

When deploying Home Cloud in production or on a home server:
1. [ ] Set a password of at least 8 characters and a JWT secret of at least 16 characters. The agent will not listen if either value is missing, too short, or still a placeholder.
2. [ ] Keep Cloudflare Zero Trust credentials and credentials files (`~/.cloudflared`) secured with `chmod 600`.
3. [ ] Keep Safe Server Mode enabled unless you explicitly require root filesystem navigation.
4. [ ] Regularly update the system using the built-in update manager or `git pull && pnpm install`.
5. [ ] Verify that the systemd service runs as an unprivileged user and not as `root`.
