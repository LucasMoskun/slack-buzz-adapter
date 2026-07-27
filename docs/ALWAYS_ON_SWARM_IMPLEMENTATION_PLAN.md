# Low-Token Always-On Signals Swarm

Status: proposed  
Created: 2026-07-27

## Outcome

Build an always-listening analysis layer that turns Slack and Buzz activity
into cited summaries, cross-channel findings, and optional personal digests
without putting inference on the live mirror path or keeping one model process
awake per agent.

The operating principle is:

> The listener is always on; the agents are usually asleep.

"Learning" means incrementally updating an evidence-backed workspace model:
summaries, decisions, blockers, dependencies, entities, open questions, and
findings. It does not mean silently training a model on private messages.

The product may be described as always-on only after durable handoff, audience
intersection, derivation invalidation, and the untrusted-content boundary pass
Milestone 0. Before then, it is a shadow analysis experiment.

This plan incorporates the findings in
[`ALWAYS_ON_SWARM_ARCHITECTURE_REVIEW.md`](./ALWAYS_ON_SWARM_ARCHITECTURE_REVIEW.md).

## Hard invariants

1. The live mirror never waits on inference.
2. No derived output exists without exact, current source citations.
3. A derived audience is the intersection of every cited source audience.
4. Models cannot publish, message people, call tools, or mutate application
   state.
5. Edits, deletions, corrections, retention changes, and access changes
   invalidate every dependent artifact.
6. Replaying unchanged input makes zero model calls and creates no duplicate
   logical result.
7. Token budget is reserved before dispatch and charged for retries and failed
   calls.

## Scope

Version 1 includes:

- incremental thread and channel summaries;
- structured decisions, blockers, owners, projects, issue IDs, dependencies,
  and open questions;
- exact-match cross-channel candidate detection before specialist inference;
- two initial specialist roles: Dependencies and Blockers;
- an owner-only Signals Workbench;
- human-reviewed, access-safe Signals;
- optional recipient-specific digests assembled from accepted Signals; and
- complete derivation lineage and invalidation.

Version 1 does not include:

- per-message model calls or scheduled full-workspace rereads;
- one hot runtime per logical agent;
- model fine-tuning on workspace content;
- autonomous publication without review;
- cross-workspace joins;
- Slack DMs other than the explicitly paired App Home copilot route;
- embedding-based retrieval before exact-match recall has been measured; or
- consequential employment, performance, or disciplinary decisions.

## Architecture

```text
Slack/Buzz source event
        |
        v
Mirror plane: normalize -> source version + outbox in one transaction
        |
        +---------------- durable reference ----------------+
                                                         |
                                                         v
Analysis worker -> eligibility -> delta batch -> summary node
                                                         |
                                              exact issue/entity index
                                                         |
                                            cross-channel candidate
                                                         |
                                      policy + novelty + budget gates
                                                         |
                                        tool-free specialist in shadow
                                                         |
                                      owner-only Signals Workbench
                                                         |
                                      human accept/reject decision
                                                         |
                                  audience-specific current Signal
                                                         |
                                    optional recipient-safe digest
```

### Execution boundaries

The mirror plane is latency-sensitive and deterministic. It stores a normalized
source version and immutable analysis-outbox reference in one transaction. It
never invokes a model.

The analysis plane is a separate, independently throttled worker process. It
owns batching, inference, retries, budgets, and derivation state. Stopping it,
exhausting its budget, or dead-lettering a poison job must not interrupt live
mirroring, reconciliation, or paired-copilot delivery.

Model workers receive delimited untrusted source data and have no tools or
write credentials. A deterministic policy/publisher service is the only
component allowed to write Workbench tasks, publish accepted Signals, or
deliver a digest.

## Contracts

The pilot should use SQLite behind a storage adapter whose domain contract can
later move to Postgres. Do not add the analysis workload to the current
single-process JSON state file.

### Core records

| Record | Required fields |
|---|---|
| `source_version` | source key, monotonically increasing version, workspace/channel/thread IDs, action, normalized content hash, collected-at audience snapshot ID, source time, current flag |
| `audience_snapshot` | snapshot ID/version, source scope, sorted identity set, collected time, reason |
| `analysis_outbox` | source key/version, job kind, idempotency key, enqueue time, attempt count, lease owner/expiry, status, last error |
| `analysis_cursor` | scope ID, last source position, prior summary ID/version, pending substantive count, last activity time |
| `summary_node` | scope ID/version, structured claims, citations, input hash, prompt/model/schema versions, validity |
| `entity_index` | canonical key/type, approved aliases and alias version, source/summary references, first/last seen |
| `issue_index` | stable fingerprint/version, type, projects, owners, normalized status, source/summary references |
| `signal_candidate` | fingerprint/version, type, reason codes, cited summaries/sources, channel set, policy disposition, novelty window |
| `signal` | claim, exact citations, projects/actors, confidence, audience intersection, follow-up, lifecycle status |
| `derivation_edge` | derived record/version, input record/version, relationship |
| `agent_run` | role, model/prompt/schema versions, input hash, reservation ID, actual token usage, evidence count, retries, result |
| `budget_ledger` | workspace/date, stage/role, reserved/actual input and output tokens, calls, warning/stop state |
| `audit_event` | entity type/ID, prior/new state, actor, reason, time |
| `digest_delivery` | recipient, accepted Signal versions, entitlement-check time, fingerprint, delivery status |

All derived records reference exact `(source_key, source_version)` inputs.
Content hashes are cache keys, not substitutes for lineage.

### Analysis job state

```text
queued -> leased -> running -> validating -> completed
   |         |         |            |
   +---------+---------+------------+-> retry_wait -> queued
                                         |
                                         +-> dead_letter

invalidated may be entered from any non-terminal state.
```

Leases expire and can be reclaimed. Logical effects are idempotent under a
stable job key even though queue delivery is at least once.

### Signal state

```text
candidate
  -> policy_passed
  -> review_accepted -> published -> superseded | retracted
  -> review_rejected
  -> policy_rejected
```

Transitions append immutable audit events. An invalidated citation blocks
pending publication immediately. Published output is retracted or superseded;
it is never silently rewritten as though the prior claim did not exist.

## Deterministic activation

### Substantive messages

A message is substantive without inference when it:

- contains non-whitespace human-authored text after link/mention normalization;
- is not an excluded DM, bot loop, join/leave notice, or configured noise
  subtype;
- is not a duplicate source version; and
- is not solely emoji, reaction metadata, or an attachment with no retained
  text.

Edits and deletes always create invalidation work even if the replacement text
is not substantive.

### Delta summaries

Summarize a scope when the first configured condition is met:

- 20 substantive new messages;
- 20 minutes of quiet after substantive activity;
- a deterministic high-value marker such as a ticket ID, configured blocker
  phrase, or explicit analysis request; or
- the maximum safe input window is reached.

Each run receives the prior compact summary plus only the new delta. Initial
caps are 4,000 input tokens, including at most 1,000 tokens of prior summary,
and 500 structured output tokens. Oversized deltas split on source boundaries;
citations are never truncated.

### Candidate matcher

Rule-based matching may use only:

- ticket, issue, channel, project, component, and owner IDs;
- owner-approved aliases;
- configured dependency phrases;
- repeated normalized blocker keys; and
- incompatible values in explicit decision fields.

Every match stores reason codes and the alias/rule version. Model-inferred
entities or intent remain untrusted candidates, not deterministic facts.

A specialist wakes only when the candidate spans at least two channels, is
novel within the configured window, has sufficient current citations, has a
non-empty source-audience intersection, and fits the reserved budget.

## Access and publication policy

Each source version points to the membership snapshot captured when it was
collected. The permitted audience for a derived record is the set intersection
of all cited snapshots.

Before publication or delivery, the policy service also checks current
entitlement. A person must therefore have been entitled to the evidence when
it was collected and remain entitled at delivery time.

Disjoint private audiences produce an empty intersection and may never leave
the owner-only Workbench. A mixed-audience Signals forum is also owner-only;
broader delivery requires an audience-specific destination or per-record
enforcement.

The validator rejects any model result that:

- cites an input ID/version not supplied in its job;
- cites an input that is no longer current;
- fails the strict output schema;
- contains a recipient outside the derived audience; or
- requests an action, tool call, or direct publication.

## Token controls

Deterministic code handles filtering, cursors, exact matching, policy,
fingerprints, and digest assembly. A small model handles delta summaries. A
stronger model handles only accepted cross-channel candidates.

Pilot caps are configuration:

| Limit | Default |
|---|---:|
| Summary run | 4,000 input / 500 output tokens |
| Specialist run | 6,000 input / 800 output tokens |
| Workspace day | 100,000 input / 15,000 output tokens |
| Warning | 70% |
| Degraded mode | 90% |
| Autonomous hard stop | 100% |

Budget is reserved atomically before dispatch. Actual provider usage replaces
the reservation after completion; failed calls and retries are charged. At
70%, optional enrichment stops. At 90%, optional roles defer. At 100%, the
worker preserves deterministic ingestion and invalidation but starts no new
autonomous inference.

Content/input hashes, cursors, and versioned fingerprints prevent paying twice
for unchanged work. Historical backfill uses a separate budget and yields to
live deltas, explicit questions, and invalidations.

## Milestones

### Milestone 0 — Contracts and replay foundation

Deliver source versions, versioned audience snapshots, durable outbox,
derivation graph, job leases/idempotency, run/budget ledgers, dead-letter
state, and a replay/fault-injection harness. Make no model calls.

Exit criteria:

- replay 10,000 fixture events while killing the process after receipt, source
  commit, lease, validation, policy pass, and publication;
- account for 100% of eligible source versions;
- produce no duplicate logical jobs or accepted Signals;
- stop the analysis worker and still meet the mirror's p95-under-60-seconds
  target; and
- property-test audience intersections, including disjoint private audiences
  and entitlement removal before delivery.

### Milestone 1 — Shadow delta summaries

Deliver configurable batching, prior-summary-plus-delta input, strict schema,
prompt-injection containment, lineage, and budget enforcement. Store only
shadow state.

Exit criteria:

- replaying unchanged data makes zero model calls;
- every structured claim cites an authorized supplied source version;
- a prompt-injection corpus causes zero actions/tool calls, zero external
  citations, zero cross-audience disclosure, and 100% schema-valid storage;
- the configured budget is never exceeded beyond reserved in-flight work; and
- a restart resumes each pending batch exactly once logically.

### Milestone 2 — Deterministic candidate index

Deliver the canonical issue/entity schemas, alias ownership/versioning,
exact-match rules, reason codes, fingerprints, and novelty window. Write
candidates only to the owner-only Workbench.

Exit criteria:

- a shared issue ID across two permitted channels produces one candidate;
- reordered or retried evidence produces no duplicate;
- an alias change deterministically invalidates affected candidates; and
- rejected rules and unchanged input consume zero inference tokens.

### Milestone 3 — Specialists in shadow

Deliver tool-free Dependencies and Blockers specialists plus strict result,
citation, policy, and budget validators. Compare results with human labels;
specialists cannot publish.

Exit criteria:

- invalid or unsupported output never advances to review;
- every surfaced claim is falsifiable and has exact current citations; and
- a fixed labelled replay corpus reports precision, recall, unsupported-claim
  rate, duplicate rate, tokens, and cost by role.

### Milestone 4 — Reviewed Signals

Deliver human accept/reject, lifecycle transitions, immutable audit events,
audience-specific publication, and edit/delete/access invalidation.

Exit criteria:

- editing or deleting one cited historical message recomputes only its
  descendants, blocks pending delivery immediately, and retracts or supersedes
  published dependants within one worker cycle;
- at least 100 candidates have been reviewed;
- at least 90% of surfaced accepted candidates are useful and correct;
- unsupported-claim rate is 0%, duplicate rate is at most 5%, and every output
  has resolving current citations; and
- recall is measured and reported separately.

### Milestone 5 — Personal digests

Deliver recipient-specific queries over accepted current Signals, opt-in,
schedule/timezone, quiet hours, rate limits, mute, once-only delivery, and
backfill-notification suppression.

Exit criteria:

- digest assembly performs no source-channel reread and no specialist call;
- every recipient passes a fresh entitlement check;
- entitlement removal before send produces zero delivery;
- retries cannot deliver the same digest twice; and
- opt-out prevents the next scheduled delivery.

## End-to-end invalidation fixture

The replay suite must include this scenario:

1. `#project-a` states that `ISSUE-42` blocks its launch.
2. `#platform` states that `ISSUE-42` has shipped.
3. The exact-ID matcher creates one cross-channel candidate.
4. The Dependencies specialist produces a cited claim.
5. A reviewer accepts it; an authorized recipient's next digest is staged.
6. The `#platform` source message is edited to say the deployment was rolled
   back.
7. The new source version invalidates the summary, candidate, accepted Signal,
   and staged digest item through derivation edges.
8. Pending delivery is blocked immediately; the published Signal becomes
   superseded or retracted; only affected descendants are recomputed.
9. The rebuilt digest contains no stale claim and no recipient outside the
   recomputed audience.

## First implementation slice

Build Milestones 0 through 2 before autonomous publication. Expected module
boundaries are:

- `src/analysis-store.js`
- `src/analysis-outbox.js`
- `src/analysis-worker.js`
- `src/derivation-graph.js`
- `src/audience-policy.js`
- `src/delta-batcher.js`
- `src/summary-contract.js`
- `src/issue-index.js`
- `src/candidate-gate.js`
- `src/run-ledger.js`

Each boundary requires full-package tests. The current implementation context
is [`src/socket-mode.js`](../src/socket-mode.js),
[`src/adapter.js`](../src/adapter.js),
[`src/state-store.js`](../src/state-store.js),
[`src/channel-routes.js`](../src/channel-routes.js),
[`src/channel-sync-service.js`](../src/channel-sync-service.js), and
[`src/copilot-delivery-service.js`](../src/copilot-delivery-service.js).
