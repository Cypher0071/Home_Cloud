---
title: Reporting a vulnerability
description: How to report a security problem in Home Cloud privately, which versions get fixes, and what to expect after you report.
sidebar:
  order: 3
---

This page summarizes [`SECURITY.md`](https://github.com/Cypher0071/Home_Cloud/blob/main/SECURITY.md) in the repository. If the two ever differ, `SECURITY.md` is the authority.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.1.x | Yes. Receives security patches, bug fixes and critical updates. |
| Earlier than 1.1.0 | No. Superseded. Upgrade to 1.1.x or newer. |

Update from the dashboard or by hand. See [Updates and rollback](/docs/using/updates/).

## How to report

:::caution
Do not report a vulnerability in a public issue, discussion, pull request or chat channel. Publishing a flaw before a fix exists puts everyone's servers at risk.
:::

The only private channel is a GitHub Security Advisory:

[Open a private security advisory](https://github.com/Cypher0071/Home_Cloud/security/advisories/new)

Sign in to GitHub to create it. Do not email details.

### What to include

The more of this you can give, the faster the report can be checked:

- **Summary.** What the problem is and what it could lead to.
- **Vulnerability class.** For example a CWE number or OWASP category: arbitrary file read, command injection, privilege escalation, CSRF or authentication bypass.
- **Steps to reproduce.** A proof of concept, `curl` commands or a script, run on a system you own.
- **Affected component.** For example the Express API, the WebSocket terminal, the Docker integration, the file scope checks or the dashboard.
- **Impact.** The attack vector, what the attacker needs first, and what they could do to the host.
- **A fix, if you have one.** Optional, and welcome.

## What happens next

The project's process, as written in `SECURITY.md`:

1. **Triage.** The team reviews reports sent as security advisories and checks whether it can reproduce the behavior.
2. **Fix.** It provides updates while a patch is written, tested and reviewed in private.
3. **Disclosure.** It follows coordinated disclosure. The team and the reporter agree on a public date before release notes, advisories or CVE numbers are published. That is typically 30 to 90 days, or right after the patched version ships.

`SECURITY.md` does not promise a response time or a bounty. Home Cloud is an open-source project, so expect a person to read the report and answer when they can.

## Before you report

A few behaviors are intended and are not vulnerabilities:

- A signed-in user has a host shell and Docker access. That is how the product works. See the [threat model](/docs/security/threat-model/).
- The dashboard is plain HTTP on your local network.
- There is one account and no roles.

If you are unsure, report it privately anyway. A false alarm costs little.

## Audits

The repository keeps automated audit reports in [`docs/security_audit/`](https://github.com/Cypher0071/Home_Cloud/blob/main/docs/security_audit/REPORT.md). The latest run, run-5, found no open issues. An automated audit is not a guarantee, and it is not an outside review. Anything new that you find is still worth reporting.

## Hardening your own install

`SECURITY.md` ends with an operator checklist: use a strong password and a long `JWT_SECRET`, keep Safe Server Mode on, update through tagged releases, run the service as a normal user, protect `ssh.<domain>` with Cloudflare Access, and keep port 3000 on trusted LAN devices only. The [threat model](/docs/security/threat-model/) and [Sessions and login](/docs/security/sessions/) explain the reasons.
