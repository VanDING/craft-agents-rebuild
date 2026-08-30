# Security policy

## Reporting a vulnerability

Please do not disclose security vulnerabilities in a public issue, discussion, pull request, or chat transcript.

Use GitHub's private vulnerability reporting for this repository:

- [Report a vulnerability privately](https://github.com/VanDING/craft-agents-rebuild/security/advisories/new)

Include the affected version or commit, impact, reproduction steps, and any suggested mitigation. Remove API keys, OAuth tokens, personal workspace data, and other secrets from logs or attachments.

If private reporting is unavailable, open a public issue containing only a request for a private maintainer contact. Do not include vulnerability details in that issue.

## Supported versions

This independently maintained fork supports the latest published version and current `main` branch. Older releases may not receive backported fixes.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Current `main` | Yes |
| Older releases | No guaranteed backports |

## Scope

Reports may cover:

- the Electron desktop application and preload boundary;
- the headless server, WebSocket/RPC transport, Web UI, and CLI;
- provider authentication and credential storage;
- tool permissions, sources, browser integration, and local file access;
- the durable runtime, Artifact storage, automations, and messaging gateways;
- build, update, and packaging behavior maintained by this fork.

Third-party services and dependencies should also be reported to their own maintainers when the vulnerability originates there.

## Safe handling

- Use a test workspace and disposable credentials.
- Do not access data that is not yours.
- Stop once you have enough evidence to demonstrate the issue.
- Allow maintainers a reasonable opportunity to investigate before public disclosure.

Craft Agents (RE) is an independent fork. Please do not send fork-specific reports to the upstream Craft security address unless you have separately verified that the same issue affects the upstream project.
