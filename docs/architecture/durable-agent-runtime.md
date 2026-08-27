# Durable Agent Runtime Architecture

Status: Accepted for incremental implementation

## Phase 0–5 implementation status

| Phase | Delivered baseline |
| --- | --- |
| 0 — contract | This ADR, runtime fact/state types, explicit recovery table and invariants. |
| 1 — substrate | Workspace-local SQLite/WAL store with immutable facts, total operation state, tool-operation identities, usage ledger, projection cursors, CAS and transactional T1/T2 APIs. |
| 2 — effect boundary | Runtime Host coordinator plus Pi JSONL T1/T2 protocol. Permission and argument transforms happen before T1; implementation cannot run before T1; result cannot reach the model before T2. Speculative tool prefetch is disabled. |
| 3 — projections | Deterministic semantic/model-context reducer, committed sequence propagation, and UI start buffering until T1. Final assistant messages, tool calls and outcomes are canonical facts; renderer and persisted messages retain their durable cursor. |
| 4 — recovery | Startup reduction terminalizes effect-free interrupted operations and parks unknown T1 tails. Unknown effects are projected as `unknown`; no startup path automatically retries them. |
| 5 — cutover guardrails | Pi/session JSONL remains a compatibility/provider cache, is atomically fsynced without an unlink gap, and is audited against canonical facts. TaskRunner refuses to replay an in-flight node after restart. |

This is the first safe vertical slice, not the removal of compatibility storage. Subsequent read-model
cutovers must use the shadow/audit path below and may retire Pi/session caches only after measured
parity. Existing pre-runtime sessions remain legacy inputs and are never assigned fabricated dispatch
evidence.

The deliberately deferred end-state is described in
[durable-agent-runtime-target-architecture.md](./durable-agent-runtime-target-architecture.md).

## Decision

Craft Agent's Runtime Host is the single authority for durable execution. Provider sessions,
renderer state, search indexes, task snapshots, and compatibility transcripts are projections or
caches; none may independently decide whether an external effect happened.

The runtime persists three logical forms:

1. Immutable semantic events describing accepted input, model output, tool calls, dispatch
   boundaries, tool outcomes, recovery decisions, usage, and terminal facts.
2. Mutable total operation state describing the current durable program counter.
3. An append-only usage ledger. Query indexes and UI/model-context views are rebuildable
   projections over these forms.

## Tool effect protocol

`tool_call_observed` means the model requested a call. It does not mean the implementation ran.

After validation, policy, permission, and argument canonicalization, one T1 transaction persists:

- the function call when not already present;
- `tool_dispatch_committed` with `operationId`, provider call ID, tool name, canonical argument
  hash, and recovery mode;
- the complete next operation state.

The implementation MUST NOT run if T1 fails. After the implementation settles, one T2 transaction
persists the tool response, usage attributable to the attempt, and the complete next operation
state. Events are published to clients only after their transaction commits.

Tool calls are child operations, not a single slot on the parent run. A model response may emit a
batch identified by its durable model operation ID; every child stores its batch ordinal and settles
independently. The parent remains `tool_effect_pending` while any child is unsettled and advances to
`checkpoint` only after the final child T2 commits. T2 completion order is intentionally unrestricted.
The child-operation table is authoritative; the IDs on parent state are an aggregate observation.

A provider `length` stop is not a successful final answer. Any partial text is projected as
intermediate output; if Pi does not recover with a subsequent complete response before
`agent_settled`, the adapter emits an explicit incomplete-turn error. Automatic bounded continuation
is intentionally deferred to the target architecture because its budget and loop state must itself
be durable.

The interval after T1 and before T2 is inherently uncertain. A crash in this interval never proves
that the effect did or did not happen.

## Recovery modes

- `safe_replay`: the effect is read-only or otherwise safe to repeat.
- `idempotent_keyed`: retry only with the same operation/idempotency key and identical arguments.
- `reconcilable`: query the external system with the same operation identity before deciding.
- `never_auto_retry`: park the operation for an explicit recovery decision.

An undeclared tool defaults to `never_auto_retry`.

## Recovery verdicts

| Durable evidence | Verdict |
| --- | --- |
| matching response | `completed` |
| matching dispatch without response | `reconcile_required` |
| call without dispatch/response under the current boundary protocol | `definitely_not_dispatched` |
| the same shape under a legacy/unknown protocol | `indeterminate` |
| mismatched identity or argument hash | `corruption` |

A recovery verdict is itself a semantic event. Recovery must fail closed: `indeterminate`,
`reconcile_required`, and `corruption` are never converted into an automatic retry by absence of a
result alone.

## Projection rules

- Model context selects committed, non-partial, model-visible semantic events.
- The UI displays committed semantic state plus bounded replaceable streaming partials.
- A terminal run/header must be supported by exactly one matching terminal semantic event.
- Every projection records the greatest runtime sequence it has applied and can rebuild from the
  canonical store.
- Streaming token deltas are not permanent facts. A bounded partial snapshot may be replaced by a
  final non-partial event.

## Compatibility and migration

Migration proceeds by shadow-writing the durable runtime store, measuring divergence, switching
read models one at a time, and finally retiring independent authority in `session.jsonl` and Pi
session files. Compatibility exports may remain, but they are generated from committed runtime
state.

During the compatibility window:

- `runtime/runtime.db` is authoritative for all runs created by the new Runtime Host path.
- `session.jsonl` is a UI/export cache; `.pi-sessions` is provider continuation state.
- Divergence is logged read-only. The runtime never repairs canonical facts from a cache.
- Rollback may disable new-run routing, but must preserve `runtime.db`; deleting it is not rollback.
- A parked operation can leave `recovery_parked` only through a durable reconciliation decision
  using the same operation identity and verified external evidence.

## Required invariants

1. A failed T1 commit produces zero implementation calls.
2. T1 without T2 is never interpreted as "not executed".
3. One operation ID cannot be reused with a different tool identity or argument hash.
4. An outcome cannot commit without a matching dispatch, except an explicit pre-dispatch synthetic
   refusal.
5. Events, operation state, usage, and projection cursors advance atomically where one transition
   makes them simultaneously true.
6. Replaying canonical events yields the same projections.
7. Recovery is idempotent and its decision is durable.
8. Unknown external effects are visible to users and never remain as a permanent spinner.
