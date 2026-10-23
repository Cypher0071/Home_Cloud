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
Please submit vulnerability reports through one of the following private channels:
1. **GitHub Private Vulnerability Reporting (Preferred)**: Navigate to the [Security Advisories tab](https://github.com/Cypher0071/Home_Cloud/security/advisories) and select **"Report a vulnerability"** to open a confidential advisory thread directly with the maintainers.
2. **Direct Security Contact**: If you cannot use GitHub Advisories, contact the project maintainers privately at `security@homecloud.local` or via the maintainer profile contact details with the subject prefix `[SECURITY VULNERABILITY]`.

### Required Information in Reports
To help us triage and remediate the issue quickly, please include as much of the following details as possible:
- **Summary**: A concise description of the vulnerability and its potential consequences.
- **Vulnerability Class**: Standard classification (e.g., CWE identifier, OWASP category such as Arbitrary File Read, Command Injection, Privilege Escalation, CSRF, Authentication Bypass).
- **Reproduction Steps / Proof-of-Concept (PoC)**: Clear, reproducible, step-by-step instructions, curl commands, or script demonstrating the issue in an isolated environment.
- **Affected Components**: Specify which modules are impacted (e.g., Express Agent API, WebSocket terminal daemon, Docker engine proxy, Storage Scope engine, or Dashboard frontend).
- **Potential Impact**: An assessment of the attack vector, prerequisites, required attacker privileges, and realistic operational impact on the host.
- **Proposed Remediation**: Any suggested code changes, patch snippets, or workarounds (optional but appreciated).

### Response & Remediation Service Level Commitments (SLAs)
- **Initial Triage & Acknowledgment**: Within **48 hours** of report receipt, we will acknowledge your disclosure and confirm whether we can reproduce the behavior.
- **Patch Development & Updates**: We will provide periodic progress reports as a patch is drafted, tested, and reviewed in private.
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
  - External traffic terminates on Cloudflare's edge before traveling over an authenticated, outbound-only WireGuard/QUIC tunnel to the local machine.
- **Local LAN Acceleration with Boundary Isolation**: 
  - Clients connected to the local home network can access the dashboard directly via the local IP address for zero-latency file transfers.
  - Both remote and local interfaces enforce the exact same cryptographic authentication and rate-limiting barriers.

### C. Storage Scope Boundary & Directory Traversal Defense
Home Cloud includes a built-in **Storage Scope Engine** that strictly governs filesystem interaction through the API:
- **Safe Server Mode (Default)**:
  - Filesystem navigation, file reads, writes, and uploads are strictly restricted to the user's home directory (`$HOME`), standard external storage mounts (`/mnt/*`, `/media/*`, `/srv/*`, `/run/media/*`), and explicitly allowed administrator storage paths.
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
- **IP-Based Login Rate Limiting**:
  - The authentication gateway tracks failed attempts per IP address.
  - Repeated failed attempts trigger automated lockout windows and exponential backoff to render brute-force credential stuffing ineffective.
- **Server-Side Session Revocation with Persistent Token Epoch**:
  - Authentication tokens (JWT) embed a `sessionEpoch` identifier.
  - When a user logs out or an administrator clicks "Revoke All Sessions", the persistent `sessionEpoch` in the configuration is incremented.
  - Any previously issued JWT containing an outdated epoch is instantly rejected on both REST HTTP endpoints and real-time WebSocket connection upgrades (Terminal & Container Exec).
- **Secure Cookie & WebSocket Protection**:
  - Tokens are transmitted via `HttpOnly`, `SameSite=Lax` cookies (with `Secure` flags on HTTPS connections) and validated prior to upgrading WebSocket handshakes.

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
1. [ ] Set a strong, unique administrative password during initial setup.
2. [ ] Keep Cloudflare Zero Trust credentials and credentials files (`~/.cloudflared`) secured with `chmod 600`.
3. [ ] Keep Safe Server Mode enabled unless you explicitly require root filesystem navigation.
4. [ ] Regularly update the system using the built-in update manager or `git pull && pnpm install`.
5. [ ] Verify that the systemd service runs as an unprivileged user and not as `root`.
