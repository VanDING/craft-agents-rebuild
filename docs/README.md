# Craft Agents (RE) documentation

This index separates current product and architecture documentation from historical audits, implementation handoffs, and deferred design work. A historical document remains useful evidence, but it is not a current product contract unless its status says otherwise.

## Start here

| Document | Status | Purpose |
| --- | --- | --- |
| [Project README](../README.md) / [中文](../README.zh-CN.md) | Current | Product introduction, capabilities, screenshots, setup, and project positioning. |
| [Electron app](../apps/electron/README.md) | Current | Desktop runtime, build, event contract, and diagnostics. |
| [CLI reference](cli.md) | Current | Headless server client, commands, TLS, and scripting. |
| [Pi kernel baseline](pi-kernel.md) | Current | Single-backend runtime contract, lifecycle, tool synchronization, and upgrade checks. |
| [Bundled user and agent guides](../apps/electron/resources/docs/) | Current | Sources, skills, permissions, automation, themes, previews, and built-in tools. These files ship with the app. |
| [Contributing](../CONTRIBUTING.md) | Current | Local setup, validation, and contribution workflow. |
| [Security](../SECURITY.md) | Current | Supported versions and private vulnerability reporting. |

## Current architecture and implementation baselines

| Document | Status | Scope |
| --- | --- | --- |
| [Durable Agent Runtime ADR](architecture/durable-agent-runtime.md) | Accepted, implemented incrementally | Runtime Host authority, T1/T2 effects, recovery, projections, and compatibility boundaries. |
| [Durable Runtime target architecture](architecture/durable-agent-runtime-target-architecture.md) | Deferred | Larger distributed end state; activate only when its stated criteria are met. |
| [Artifact files and native image generation](artifact-files-native-image-generation-plan.md) | Implemented baseline | File-format registry, Artifact lifecycle, native image generation, and the clean removal of Univer. |
| [Theme engine design](theme-engine-design.md) | Implemented | Semantic token layers, user-owned themes, app defaults, and workspace overrides. |
| [Profile and preferences](profile-preferences-plan.md) | Implemented baseline | Local profile, activity summary, identity, location, and preferences; optional sharing remains deferred. |

## Project planning

| Document | Status | Purpose |
| --- | --- | --- |
| [Project assessment and development roadmap](project-assessment-and-roadmap-2026-08-31.md) | Proposed; implementation not started | Point-in-time assessment of product, architecture, quality, release, security, and governance, followed by a phased convergence and development roadmap. |
| [Impact-first performance optimization plan](performance-optimization-plan-2026-09-01.md) | Proposed; implementation not started | Lean plan that fixes the highest-impact renderer startup and long-session streaming costs first, then stops or continues according to measured user impact. |

## Historical, research, and deferred records

These documents preserve decisions and evidence. Their paths, line numbers, branch names, screenshots, dependency versions, and gap lists may describe the repository at the date recorded rather than today.

| Document | Classification |
| --- | --- |
| [Durable Runtime implementation handoff](craftagent-durable-runtime-handoff.md) | Historical implementation record; superseded operationally by the accepted ADR and current code. |
| [Right-panel audit](right-panel-audit-report.md) | Historical audit and remediation record; later Workbench and Run redesigns supersede its remaining-gap list. |
| [Trajectory vs VanDSH comparison](trajectory-vs-vandsh-comparison.md) | Historical comparison; superseded by the current Overview / Trajectory / Context / Map Run workspace. |
| [Univer and Workbench integration plan](univer-native-workbench-integration-plan.md) | Historical plan; Univer was removed without a migrator or compatibility path. |
| [Native Design Layer](native-design-layer-architecture-plan.md) | Deferred archive; not an implementation baseline. |
| [Cross-ecosystem plugin assessment](cross-ecosystem-plugin-porting-assessment.md) | Exploratory research; implementation requires a separate current plan. |
| [Memory system design](memory-system-design.md) | Research placeholder; no memory architecture is approved by this document. |
| [System-prompt per-turn analysis](system-prompt-per-turn-analysis.md) | Point-in-time analysis and evidence record. |
| [Original code audit](../AUDIT_REPORT.md) | Historical security and quality snapshot; findings must be revalidated against current code. |
| [`docs/superpowers/plans/`](superpowers/plans/) | Completed point-in-time implementation plans. |

## Release history

- Versioned user-visible history lives in [`apps/electron/resources/release-notes/`](../apps/electron/resources/release-notes/).
- The unreleased changelog is [`next.md`](../apps/electron/resources/release-notes/next.md).
- Release notes are immutable history after release; do not rewrite older entries to match current architecture.

## Documentation maintenance rules

1. Current guides describe observable behavior, not the development story that produced it.
2. Architecture documents must declare one of: proposed, accepted, deferred, superseded, or historical.
3. A completed plan may remain as a decision record, but its status must point to the current source of truth.
4. User-visible changes update `release-notes/next.md` in the same change.
5. README screenshots live in `docs/assets/readme/`; use descriptive filenames and remove superseded assets rather than accumulating galleries.
