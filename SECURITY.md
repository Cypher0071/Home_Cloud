# Security Policy

Home Cloud gives remote access to files, Docker, and a shell on the host machine, so security reports are taken seriously.

## Supported versions

| Version | Supported |
| ------- | --------- |
| latest `main` / newest release | Yes |
| older releases | No, please update (Settings has one-click update) |

## Reporting a vulnerability

Please **do not** open a public issue.

Report privately through GitHub: go to the **Security** tab of this repository and click **Report a vulnerability** (private vulnerability reporting).

Include:

- what is affected (agent route, dashboard component, setup script)
- steps to reproduce or a proof of concept
- the impact you expect (auth bypass, path traversal, RCE, info leak, ...)

You can expect an acknowledgement within 72 hours and a status update within 7 days. Once a fix ships, you will be credited in the release notes unless you prefer otherwise.

## Security model, in short

- Single-user system protected by one passcode and JWT sessions with server-side revocation.
- Intended to be exposed through a Cloudflare Tunnel, not by opening ports.
- File access is limited by storage scope unless the owner enables System Root Access.

Reports that require the attacker to already know the passcode or have shell access to the host are generally out of scope.
