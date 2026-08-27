# Durable Agent Runtime — Target Architecture

Status: Deferred design record. Implement only when the activation criteria below are met.

## Purpose

This document records the intended end state without committing the current implementation to its
full complexity. The active runtime remains the smaller design in
[durable-agent-runtime.md](./durable-agent-runtime.md): per-effect T1/T2 records, transactional parent
aggregation, model/tool barriers, deterministic projections, and fail-closed recovery.

The target architecture is for long-running, multi-agent, multi-workspace and distributed execution.
It is not required merely to support parallel tool calls inside one model response.

## Design position

The target combines three proven ideas while preserving Craft's durability requirements:

- Codex-style execution admission: parallel-safe operations may share an execution epoch, while
  exclusive mutations obtain a write/exclusive permit.
- Pi-style batch semantics: preflight is deterministic, execution may be parallel, and results are
  reassembled in the assistant message's source order.
- Maka-style durable facts: effects cross explicit T1/T2 boundaries, recovery is evidence-driven,
  and ambiguous effects fail closed.

Reference implementations:

- [OpenAI Codex](https://github.com/openai/codex)
- [Pi harness v2](https://github.com/earendil-works/pi)
- [Apache Maka](https://github.com/apache/maka)

These are design references, not compatibility contracts. Craft owns its event schema, recovery
rules and migration guarantees.

## Invariants that must remain true

1. Runtime Host is the only authority that advances a durable program counter.
2. Every external effect has a stable child operation identity and immutable canonical arguments.
3. No effect executes before its T1 transaction commits.
4. No effect result reaches the next model request before its T2 transaction commits.
5. A parent checkpoint is derived from all children, never from the most recently observed child.
6. Completion order may vary; model-context result order remains the source order from the model.
7. A crash between T1 and T2 creates uncertainty, never evidence of failure or permission to retry.
8. Provider length exhaustion, cancellation, policy rejection and infrastructure failure are distinct
   durable terminal causes; none is silently collapsed into a generic successful stop.

## Target components

### 1. Durable batch entity

Promote today's lightweight `toolBatchId` and `toolBatchOrdinal` metadata into a first-class batch
record only when batch-level querying or recovery is needed. A batch records its source model
operation, ordered child identities, admission policy and aggregate state. Child operation rows remain
the source of truth for effect outcomes.

Batch state is a projection:

`planned -> admitted -> effect_pending -> settled | recovery_parked`

The transition to `settled` requires every admitted child to have a committed outcome or an explicit
reconciliation decision.

### 2. Resource-aware admission controller

Replace coarse tool-name rules with declared concurrency properties:

- `parallel_read`: no mutation and safe to execute with other reads;
- `exclusive_workspace`: may mutate the current workspace;
- `exclusive_session`: mutates session or agent control state;
- `external_keyed`: may run concurrently only when its declared resource keys do not overlap;
- `global_exclusive`: rare process-wide state mutation.

Each tool definition supplies a conservative default and may derive resource keys from validated
arguments. Unknown tools default to exclusive execution. Admission is deterministic and persisted so
recovery does not reinterpret a historical batch under newer policy.

Do not build a general dependency DAG until tool telemetry proves that lock classes and keyed
resources leave material parallelism unused.

### 3. Effect registry and reconcilers

Maintain a registry per effect type containing:

- canonicalization and identity rules;
- recovery mode and idempotency-key injection;
- external-reference extraction;
- reconciliation adapter and evidence schema;
- redaction policy;
- retry budget and backoff policy for definitely-not-dispatched effects only.

Reconcilers are resumable workers over durable evidence. They never infer “not executed” from a
timeout or missing local response. Operator decisions are append-only audit events.

### 4. Workspace transaction boundary

For local file mutations, add optional workspace checkpoints or content-addressed write sets. This is
separate from SQLite atomicity: the runtime database can prove intent and outcome, but cannot by
itself roll back a partially applied filesystem mutation.

Adopt this only for workflows that need atomic multi-file publication. Normal edits should retain
simple per-tool durability and version-control recovery.

### 5. Distributed ownership and leases

When one run can move between processes or hosts, introduce fenced leases:

- monotonically increasing fencing token;
- bounded lease expiry and heartbeat;
- compare-and-swap on every state transition;
- stale-owner rejection at the effect adapter;
- explicit handoff event and recovery scan.

Do not add distributed leases while a workspace is owned by one Runtime Host process; SQLite's
transaction serialization and state versions are sufficient in that deployment model.

### 6. Continuation supervisor

Treat `stopReason = length` as an incomplete model attempt, not a completed agent turn. A supervisor
may issue a bounded continuation using the committed response and canonical context, with:

- a durable continuation counter and total token/time budget;
- loop/no-progress detection;
- cancellation propagation;
- compaction coordination;
- a clear terminal diagnostic when the budget is exhausted.

This subsystem must remain independent of tool-effect recovery: output truncation and an uncertain
external side effect require different decisions.

### 7. Observability and verification

Expose metrics and traces for:

- T1-to-execution and execution-to-T2 latency;
- unsettled children per run and age of the oldest child;
- out-of-order completion rate and batch width;
- recovery verdicts and manual interventions;
- state-version conflicts, lease fencing failures and projection lag;
- provider length continuations and no-progress termination.

Keep a replay verifier that rebuilds parent and batch state from immutable events and compares it with
materialized state. Any divergence fails closed and produces a diagnostic bundle.

## Activation criteria

Implement a deferred component only when at least one measurable condition is present:

| Component | Activation signal |
| --- | --- |
| First-class batch table | Batch-level recovery/querying cannot be answered efficiently from child rows and events. |
| Keyed resource scheduler | Coarse sequential mutation policy materially limits throughput, with contention telemetry showing safe independence. |
| Dependency DAG | Real tasks require ordered subsets within one batch that locks cannot express. |
| Workspace checkpoints | Partial multi-file effects cause unrecoverable or costly inconsistency. |
| Distributed leases | Runs can execute or hand off across more than one Runtime Host owner. |
| Automated reconcilers | Parked effects occur often enough that manual resolution breaches an agreed recovery SLO. |
| Continuation supervisor | Provider `length` stops measurably interrupt otherwise-progressing tasks. |

Each activation requires an ADR, failure-injection tests, a reversible migration and an operational
rollback path.

## Explicit non-goals for the current implementation

- No generic workflow DAG scheduler.
- No speculative execution before T1.
- No automatic replay of ambiguous effects.
- No distributed consensus or lease service for a single-host runtime.
- No universal filesystem transaction layer.
- No batch table when child rows plus batch metadata answer current recovery needs.
- No coupling between model continuation policy and tool-effect reconciliation.

This boundary is intentional: the current fix removes the invalid single-tool assumption while the
target remains available as a tested, evidence-triggered evolution path rather than prepaid complexity.
