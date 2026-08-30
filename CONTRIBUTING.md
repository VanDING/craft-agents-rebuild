# Contributing to Craft Agents (RE)

Thank you for helping improve Craft Agents (RE). Contributions should preserve the project's central properties: one Pi agent backend, durable and auditable execution, explicit permission boundaries, local-first data, and a coherent desktop workspace.

## Set up the repository

### Requirements

- [Bun 1.4](https://bun.sh/) or the version pinned by the root `packageManager` field
- macOS, Linux, or Windows
- Credentials for any provider or external service involved in the change

```bash
git clone https://github.com/VanDING/craft-agents-rebuild.git
cd craft-agents-rebuild
bun install
cp .env.example .env
bun run electron:dev
```

Do not commit credentials, workspace data, session transcripts, or generated provider tokens.

## Understand the relevant contract

Start with the [documentation index](docs/README.md). Before changing runtime, provider, event, permission, or tool behavior, read:

- [Pi kernel maintenance baseline](docs/pi-kernel.md)
- [Durable Agent Runtime ADR](docs/architecture/durable-agent-runtime.md)
- [Electron runtime guide](apps/electron/README.md)

Do not introduce a second provider-specific session lifecycle or treat compatibility transcripts as execution authority.

## Make a change

1. Create a focused branch from `main`.
2. Follow the patterns and terminology already used in the affected package.
3. Add or update focused tests for observable behavior and failure paths.
4. Update documentation when a public contract, setup step, or architecture boundary changes.
5. Add a concise entry to `apps/electron/resources/release-notes/next.md` for user-visible behavior.
6. Run the smallest validation that directly covers the change.

Prefer a focused test command over the full suite. Run broader checks when the change crosses packages, alters shared types, or affects packaging.

```bash
bun run typecheck:all      # All workspace type checks
bun run validate:dev       # Type checks and core runtime/document tests
bun run validate:ci        # CI validation plus i18n parity and coverage
```

Useful development commands:

```bash
bun run electron:dev
bun run electron:build
bun run server:dev
bun run webui:dev
```

## Repository map

```text
apps/
├── electron/             Desktop application
├── cli/                  Terminal client
├── webui/                Headless-server Web UI
├── viewer/               Shared-session viewer
└── marketing/            Project website

packages/
├── shared/               Agent, configuration, auth, sources, and shared contracts
├── server-core/          Sessions, Runtime Host, RPC handlers, and services
├── pi-agent-server/      Isolated Pi SDK subprocess
├── session-tools-core/   Canonical session tool definitions and handlers
├── ui/                   Shared React UI
├── core/                 Core types and storage interfaces
├── server/               Headless server entry point
├── messaging-gateway/    Messaging adapters
└── messaging-whatsapp-worker/
```

## Pull requests

A pull request should explain:

- the user or maintenance problem;
- the chosen behavior and important trade-offs;
- tests and manual verification performed;
- screenshots or recordings for visible UI changes;
- migration, compatibility, permission, or recovery implications.

Keep generated files, unrelated formatting, and personal workspace artifacts out of the change. Preserve upstream attribution and third-party license notices when reusing code or assets.

## Reporting security issues

Do not disclose a vulnerability in a public issue or pull request. Follow the private process in [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
