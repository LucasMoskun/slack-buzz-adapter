# Always-On Swarm Architecture Review

Status: plan input  
Reviewed: 2026-07-27

## Purpose

This document reviews a proposed low-token analysis pipeline for the Slack to
Buzz adapter:

```text
Slack/Buzz events
  → deterministic filter and cursor
  → thread/channel delta summaries
  → deterministic cross-channel candidate matcher
  → specialist agents
  → reviewed Signals and personal digests
```

The direction is sound: keep ingestion deterministic, make agents sleep until
there is meaningful work, and derive digests from accepted findings instead of
rereading every channel. The system should not be described as always-on,
however, until it closes four foundational gaps:

- durable handoff;
- audience intersection;
- evidence invalidation; and
- an explicit untrusted-content boundary.

## Must-fix architecture boundaries

### 1. Durable handoff and failure isolation

Put a durable boundary between mirroring and analysis.

The current Socket Mode path acknowledges an envelope before `onEnvelope`
finishes. `SlackBuzzAdapter.queue` is an in-memory promise chain, and
`JsonStateStore` is a single-process JSON file. These are reasonable pilot
constraints, but they are not a durable analysis queue.

Add an `analysis_outbox` transactionally with each normalized source version,
then consume it from an independently throttled worker. "Same deployment" must
not mean "same serial queue": a slow model, exhausted token budget, or poison
job must not block live mirroring or reconciliation.

Relevant implementation:

- [`src/socket-mode.js`](../src/socket-mode.js)
- [`src/adapter.js`](../src/adapter.js)
- [`src/state-store.js`](../src/state-store.js)

### 2. Audiences as identity sets

Model source audiences as versioned identity sets, not scalar labels.

`public_channel` and `private_channel` are insufficient when a finding combines
two private channels with different memberships. There is no meaningful single
"strictest" label. The allowed audience is the intersection of every cited
source audience.

Require both:

- historical entitlement when the evidence was collected; and
- current entitlement when a finding is published or delivered.

A mixed-audience `Signals` forum is safe only as an owner-only Workbench.
Broader publication requires an audience-specific destination or per-record
access enforcement. The current conversation record overwrites one membership
snapshot, so it cannot yet prove temporal entitlement.

Relevant implementation:

- [`src/channel-routes.js`](../src/channel-routes.js)
- [`src/channel-sync-service.js`](../src/channel-sync-service.js)

### 3. Complete derivation lineage

Every summary, entity, candidate, Signal, and digest item must link to exact
`(source_key, source_version)` inputs. It must also record the prompt, model,
rule, and schema versions that produced it.

An edit, deletion, channel-scope change, membership change, retention expiry, or
human correction must:

1. invalidate every dependent artifact;
2. block pending delivery;
3. recompute only the affected derivation graph; and
4. retract or supersede already published output.

Content hashes prevent unchanged work from being repeated, but they do not
provide this invalidation behavior by themselves.

### 4. Untrusted source content

Treat all Slack text as hostile data. A message may contain fake system
instructions, fake citations, secrets, or requests to call tools.

Summarizers and specialists should:

- have no tools or publishing credentials;
- receive source text in a clearly delimited data field;
- emit a strict, validated schema; and
- be unable to message people or mutate application state directly.

A deterministic policy service must confirm that every cited source ID was in
the job input, each cited version remains current, and every recipient passes
the audience check. Only the policy/publisher service receives write
credentials.

### 5. A genuinely deterministic matcher

Define which candidate fields are deterministic.

Good rule-based inputs include:

- ticket and issue IDs;
- channel and project IDs;
- explicit project aliases;
- owner IDs; and
- normalized decision fields.

Entities, dependencies, or intent inferred by a model are candidates rather
than deterministic facts. The plan should specify:

- the canonical issue/entity schema;
- who owns and approves aliases;
- matching rules and reason codes;
- the fingerprint and fingerprint version;
- the novelty window; and
- what happens when an alias or rule changes.

"Substantive message" must also have a deterministic definition so filtering it
does not itself consume inference tokens.

### 6. A finding state machine

Use an explicit state machine with immutable audit events:

```text
candidate
  → policy_passed
  → review_accepted | review_rejected
  → published
  → superseded | retracted
```

During the pilot, specialists may write only to the owner-only Workbench.
Personal digests may include only accepted, current Signals and must re-check
recipient access at send time.

Keep ingestion and outbound Slack delivery as separate capabilities. The
existing copilot delivery worker is the appropriate boundary to preserve:

- [`src/copilot-delivery-service.js`](../src/copilot-delivery-service.js)

### 7. Enforceable token control

Token control must be enforced, not merely observed.

The worker should:

- reserve budget before dispatch;
- record actual provider usage;
- include failed calls and retries in the ledger;
- record cache hits, prompt/model versions, evidence count, and outcome;
- stop starting work when a workspace or stage budget is exhausted; and
- let low-priority work age without creating a catch-up storm.

The estimate that 500 messages can become roughly 20 calls is true only for a
specified thread distribution and quiet-window schedule. Keep thresholds
configurable and benchmark them against a fixed replay corpus.

## Recommended milestone order

### Milestone 0: Contracts and replay foundation

Implement:

- a durable evidence store and analysis outbox;
- source versions;
- versioned access-control snapshots;
- the derivation graph;
- job idempotency and leases;
- token/run ledgers;
- dead-letter state; and
- a replay and fault-injection harness.

Make no model calls in this milestone.

### Milestone 1: Shadow delta summaries

Add configurable batching, prior-summary-plus-delta input, strict output
schemas, prompt-injection containment, and token-budget enforcement. Store
results in shadow state only; do not publish cross-channel findings.

### Milestone 2: Deterministic candidate index

Match exact IDs, approved aliases, and explicit rules first. Write candidates,
reason codes, and supporting source IDs to the owner-only Workbench.

### Milestone 3: Specialists in shadow

Wake a specialist only when a candidate:

- spans at least two channels;
- is novel;
- passes the audience policy;
- has enough current cited evidence; and
- fits within the remaining budget.

Specialists remain tool-free and cannot publish. Compare their output with
human labels.

### Milestone 4: Reviewed Signals

Add:

- human accept/reject;
- stable fingerprints;
- current citations;
- audience-specific publication; and
- edit, deletion, correction, and revocation propagation.

### Milestone 5: Personal digests

Build digests only from accepted, current Signals. Re-check the recipient at
send time and use separate outbound credentials, quiet hours, rate limits,
one-click mute, and backfill-notification suppression.

This ordering establishes privacy and correctness before cross-channel
synthesis. Each milestone remains independently useful to contributors.

## Measurable acceptance criteria

### Durability and idempotency

Fault-inject process death after:

- envelope receipt;
- source commit;
- job lease;
- model response;
- policy pass; and
- publication.

After restarting and replaying 10,000 fixture events:

- every eligible source version is accounted for;
- no logical job is processed twice; and
- no duplicate accepted Signal exists.

### Mirror isolation

Stop the analysis worker or make every model call time out. Mirror delivery must
still meet the existing p95-under-60-seconds target, and reconciliation must
complete normally.

### Replay and invalidation

Replay unchanged data twice. The second run must make zero model calls.

Edit or delete one old cited message. Only its dependent graph should be
recomputed, pending delivery should be blocked immediately, and all affected
published records should become superseded or retracted within one worker
cycle.

### Access policy

Property-test arbitrary channel membership sets. A finding's eligible
recipients must equal the intersection of all cited source audiences.

- Disjoint private audiences never leave the owner-only Workbench.
- Removing a recipient before digest delivery results in zero delivery.

### Prompt-injection containment

Run a corpus containing fake system prompts, fake Slack URLs, and tool
requests. Require:

- zero tool or action execution;
- zero citations outside the supplied input IDs;
- zero cross-audience disclosures; and
- 100% schema-valid stored results.

### Token budget

Run a fixed replay under a configured daily budget. Actual usage must not exceed
the budget beyond already reserved in-flight work. Retries are charged.
Unchanged hashes and rule-rejected matcher candidates consume zero inference
tokens.

### Pilot quality

Before enabling automatic private delivery, review at least 100 candidates and
require:

- at least 90% of surfaced accepted candidates to be judged useful and correct;
- a 0% unsupported-claim rate;
- at most a 5% duplicate rate; and
- current citations on every output.

Measure recall separately. A precision-only launch metric must not hide missed
connections.

## Later enhancements

- Add access-aware embeddings only after exact-match recall has a measured
  baseline.
- Explore model-assisted alias discovery, adaptive thresholds, and model-based
  novelty.
- Remove human review only after pilot metrics and the correction workflow hold.
- Keep version 1 joins workspace-local; defer cross-workspace joins.
- Add more logical specialist roles or persistent per-person copilot namespaces
  without adding hot processes per persona.

## Contributor-facing plan requirements

The implementation plan should include:

- record schemas;
- state diagrams for analysis jobs and Signals;
- hard invariants;
- explicit non-goals; and
- one end-to-end fixture showing an edit retracting a cross-channel Signal and
  removing it from a pending personal digest.

The essential invariants are:

1. The mirror never waits on inference.
2. No output exists without current citations.
3. A derived audience is the intersection of every cited source audience.
4. Models cannot publish, message people, or mutate application state directly.
5. Edits, deletions, corrections, and access changes propagate to every
   dependent artifact.
