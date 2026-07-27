# Slack → Buzz Adapter

Run a private Buzz workspace alongside Slack while people continue working
where they already are.

This adapter mirrors Slack channels into private Buzz channels, where agents
can work with the same conversation history and source context. A person can
also message a paired Buzz copilot from Slack App Home and receive a cited
answer in the same conversation.

Slack remains the source of truth during the transition. The adapter preserves
where each message came from, never posts as a human, and keeps deployment
credentials and channel mappings out of the repository.

> **Project status:** this internal pilot covers channel mirroring,
> reconciliation, history backfill, and one personal copilot. Claimable
> personas, per-person copilots, and production hardening are still ahead.

## Why this exists

Teams need continuity as they move from human-first chat into agent-native
work: familiar channels, trustworthy attribution, existing history, and a
gradual way to work with agents before changing where they spend their day.

The adapter supports that transition in three phases:

1. **Slack-first:** people stay in Slack and use a Buzz copilot through the
   Slack app.
2. **Hybrid:** people claim their Buzz personas and gain direct access to Buzz,
   its channels, and its agents.
3. **Buzz-first:** Slack becomes read-only and can eventually be retired after
   the required parity is reached.

## What works today

- **One-to-one private mirrors.** Every visible Slack source channel maps to one
  same-named private Buzz channel.
- **History and live updates.** The adapter backfills paginated history and
  thread replies, then receives new activity through Slack Socket Mode.
- **Traceable source context.** Authors, timestamps, threads, edits, deletion
  markers, stable actor metadata, and Slack permalinks stay attached.
- **Automatic channel discovery.** The running application reconciles sources
  every 60 seconds, joins new public channels, creates private Buzz mirrors,
  repairs membership, refreshes names, and backfills newly added routes.
- **Safe retries and restarts.** Persistent receipts and Slack-to-Buzz mappings
  prevent duplicate publications.
- **A private copilot loop.** One configured human can ask a Buzz research
  copilot from Slack App Home and receive a cited answer back in that exact DM.
- **Strict DM boundaries.** Human-to-human DMs, multi-person DMs, wrong-user
  requests, uncited answers, wrong-agent replies, and duplicate deliveries are
  rejected.

The channel mirror is inbound-only: it does not echo Buzz channel traffic back
into Slack. The separate copilot worker has the narrow outbound capability
needed to return a verified answer to the paired Slack App Home conversation.

## How it fits together

```text
Slack channel history + live events
                 │
                 ▼
        Private Buzz mirrors
                 │
                 ▼
       Permissioned Buzz agents

Slack App Home DM ──► private Buzz copilot ──► cited reply to Slack
```

The adapter publishes through the local `buzz` CLI, using the same relay
authentication model as other Buzz agents and tools. Socket Mode keeps Slack
event delivery private; no public webhook endpoint is required.

## Pilot boundaries

- The personal copilot route currently supports one configured Slack human.
- Public Slack channels can be discovered and joined automatically. Private
  channels are visible only after the app is explicitly invited.
- Claimable Slack-source personas, the claim ceremony, per-person copilots,
  private-channel revocation, dependent-finding invalidation, and a shared
  cross-project Signals layer are not implemented yet.
- Slack files are not downloaded; file-only events retain authenticated links.

## Supported behavior

| Slack event | Buzz behavior |
|---|---|
| Historical message | Sends it oldest-first through `npm run backfill` |
| New message | Sends a mirrored Buzz message |
| Thread reply | Replies to the mirrored parent when the parent is in state |
| Edit | Edits the existing mirrored Buzz message |
| Delete | Replaces the mirrored content with a deletion marker |
| Duplicate event | Ignores it using the durable event receipt |
| Mapped public/private channel | Routes it to its one-to-one Buzz destination |
| Unmapped channel | Ignores it |
| Configured human → Buzz Copilot App DM | Mirrors into the private Buzz copilot inbox |
| Any other one-to-one DM | Rejects before event receipt, storage, logging, or inference |
| Any multi-person DM | Rejects before event receipt, storage, logging, or inference |
| Cited agent reply to paired Slack copilot request | Delivers once to the app DM |
| Uncited, unpaired, duplicate, or wrong-author response | Does not deliver |

A live thread reply whose parent is not yet in state is published as a normal
message. Run backfill before live mirroring so historical parents and replies
are mapped first.

## Security model

- Every Buzz mirror is private. Routing uses immutable IDs and rejects duplicate
  destinations.
- The live mirror process does not post messages to Slack. Reconciliation only
  joins public source channels; the separate copilot worker has the narrow
  outbound message capability.
- Human-to-human DMs are excluded both by Slack permissions and adapter policy.
  The app subscribes only to `message.im`, which covers conversations involving
  the app, and admits only the configured human and exact App Home DM.
- Multi-person DMs are excluded both by permissions (no `mpim:history`) and
  policy (`message.mpim` is not subscribed and `channel_type=mpim` is rejected).
- Excluded DMs are rejected before deduplication or persistence; their event
  IDs, content, actors, and message mappings are not stored.
- The personal App Home conversation is labelled personal context and must not
  be promoted into shared findings without an explicit share action.
- A private-channel ledger snapshots member IDs, and startup fails if the pilot
  human is not entitled to any configured private evidence source.
- Outbound delivery requires a known agent author, a reply to the paired
  human's exact Slack App Home request, a Slack source permalink, and a durable
  once-only receipt.
- Public enrollment is explicit through reconciliation. Private sources remain
  Slack invitation-only and cannot be silently claimed as covered.
- Runtime state is written with owner-only file permissions.
- Slack and Buzz credentials are read from environment variables and are never
  logged.
- The deployment-specific channel mapping is mode `0600` at runtime and is
  excluded from git.
- The `buzz` process is spawned directly without a shell.

## Contributing

The repository is being prepared for open-source contributions. The adapter is
dependency-free by design, and changes should preserve its privacy boundaries,
source attribution, and idempotent delivery guarantees.

Before proposing a change:

1. Keep credentials, runtime state, and workspace/channel IDs out of git.
2. Add or update tests for behavior changes.
3. Run the full test and syntax-check suites:

   ```bash
   npm test
   npm run check
   ```

4. Explain any change to Slack permissions, Buzz membership, persistence, or
   outbound delivery in the pull request.

### Requirements

- Node.js 22 or newer
- the `buzz` CLI installed and available on `PATH`
- a Slack Pro demo workspace where you can create and install an internal app
- permission to create private Buzz stream channels

No npm packages are required.

## Development setup

### 1. Create the Slack app

1. Open [Slack app management](https://api.slack.com/apps).
2. Choose **Create New App** → **From an app manifest**.
3. Select the demo workspace.
4. Paste [`slack-app-manifest.yaml`](./slack-app-manifest.yaml).
5. Install the app to the workspace.
6. Under **Basic Information → App-Level Tokens**, create a token with the
   `connections:write` scope. This is the `xapp-…` token.
7. Copy the bot token from **OAuth & Permissions**. This is the `xoxb-…` token.
8. Private channels always require an explicit invitation. Public channels are
   joined by `npm run sync-channels`.

The app requests channel history/metadata, user-profile reads, access to its own
one-to-one App Home conversations, and ordinary app-authored message delivery.
It requests `channels:join` so reconciliation can enroll public channels. It
does **not** request `mpim:history`, subscribe to `message.mpim`, request user
tokens, or request `chat:write.customize`.

If the app was installed from an earlier version of the manifest, update the
manifest and reinstall it so Slack grants `channels:join`, `im:history`,
`im:write`, and `chat:write`, enables the App Home messages tab, and subscribes
to `message.im`.

### 2. Configure the adapter

```bash
cp .env.example .env
```

Set:

- `SLACK_APP_TOKEN`: the `xapp-…` Socket Mode token
- `SLACK_BOT_TOKEN`: the `xoxb-…` bot token
- `CHANNEL_MAPPINGS_PATH`: the JSON mapping path; defaults to
  `channel-mappings.json`
- `BUZZ_RELAY_URL`: the Buzz relay URL
- `BUZZ_PRIVATE_KEY`: the Buzz publishing identity
- `BUZZ_AUTH_TAG`: optional owner attestation, when required by the relay
- `MIRROR_OWNER_PUBKEY`: the human added as owner to every created mirror
- `MIRROR_AGENT_PUBKEYS`: comma-separated agents added as bots

For this pilot, `COPILOT_HUMAN_PUBKEY` and `COPILOT_AGENT_PUBKEY` are used as
fallbacks for the two mirror membership settings.

For the optional copilot route, also set:

- `COPILOT_SLACK_USER_ID`: the one Slack human allowed to use this pilot
- `COPILOT_BUZZ_CHANNEL_ID`: the private Buzz copilot channel
- `COPILOT_AGENT_NAME`: the exact Buzz display name; the adapter uses it as a
  real mention so the agent receives private requests

For automatic private reply delivery back to Slack, set:

- `COPILOT_AGENT_PUBKEY`: the saved copilot agent's Buzz public key
- `COPILOT_HUMAN_PUBKEY`: the paired human's Buzz public key

Slack channel IDs can be copied from **View channel details → About**.

Real credentials belong only in `.env`; that file and the runtime state
directory are ignored by git. `channel-mappings.json` is generated deployment
state and is also ignored by git; do not commit workspace/channel IDs into the
codebase.

### 3. Reconcile all source channels

```bash
npm run sync-channels
```

This command:

1. lists every active public channel and every private channel visible to the
   app;
2. joins public channels that the app has not joined;
3. creates one private Buzz stream for every unmapped Slack source;
4. grants the configured human owner access and selected agents bot access; and
5. atomically updates the runtime-only `channel-mappings.json`.

The mapping file routes by immutable IDs. Channel names are labels for review
and are refreshed during reconciliation:

```json
{
  "version": 1,
  "channels": [
    {
      "slackChannelId": "C0123456789",
      "slackChannelName": "project-alpha",
      "buzzChannelId": "00000000-0000-0000-0000-000000000000",
      "buzzChannelName": "project-alpha"
    }
  ]
}
```

Duplicate Slack IDs or duplicate Buzz destinations are rejected. Unmapped
channels are ignored by the live event processor. Buzz mirror names are kept
identical to their Slack source names on every reconciliation. On Slack Pro,
uninvited private channels are not visible to the app; invite **Buzz Copilot**
and rerun reconciliation.

### 4. Internal minutely reconciliation

The long-running adapter runs reconciliation internally every 60 seconds. No
cron entry, LaunchAgent, or second reconciliation process is required. Set
`CHANNEL_SYNC_INTERVAL_MS` only when a different interval is needed.

Every cycle:

1. acquires an exclusive reconciliation lock;
2. discovers Slack channels and updates the runtime-only mapping;
3. joins new public channels and creates same-named private Buzz mirrors;
4. repairs configured human/copilot membership;
5. compares the generated mapping with the routes applied in memory; and
6. serializes any route update with live messages, then backfills only newly
   added routes.

Cycles never overlap: the next timer is scheduled only after the current cycle
finishes. Failures are logged and retried by the same live process on the next
cycle. `npm run sync-channels` remains available as an explicit one-shot
administrative command and uses the same reconciliation lock.

### 5. Validate both sides

```bash
npm run doctor
```

The doctor checks:

- Slack bot authentication
- access to every mapped Slack channel
- Socket Mode app-token authentication
- access to every mapped Buzz channel
- that the evidence source is a channel rather than a DM/MPIM
- the configured human's membership in every mapped private source
- the dedicated App Home DM and private Buzz copilot channel

It prints IDs and channel metadata, never token values.

### 6. Backfill existing history

Stop `npm start` if it is currently running, then run:

```bash
npm run backfill
```

By default this retrieves all history that the Slack app can access in every
mapped channel. It follows Slack cursor pagination, fetches thread replies,
sorts messages oldest-first, and publishes each source into its mapped Buzz
channel.

To set a lower bound, add an ISO-8601 date or Slack timestamp to `.env`:

```bash
BACKFILL_OLDEST=2026-01-01T00:00:00Z
```

The command reports fetched, created, already-existing, and ignored counts.
Re-running it is safe: deterministic backfill event IDs plus the persistent
Slack-to-Buzz message map prevent records already in state from being
republished.

The live adapter and backfill command intentionally share an exclusive state
lock. If backfill reports that the state is locked, stop the live adapter with
`Ctrl-C`, run the backfill, then restart live mirroring.

### 7. Start mirroring

```bash
npm start
```

Send a message in any mapped Slack channel. It should appear in its Buzz
destination with the Slack author, source channel, original timestamp, and a
Slack permalink.

The adapter acknowledges Socket Mode envelopes before processing them. Delivery
then runs serially and records state in `.data/state.json`. Restarting the
process does not republish events already recorded in that file.

### 8. Run the personal copilot pilot

Start the automatic-delivery worker in a second terminal:

```bash
npm run copilot
```

The end-to-end loop is:

1. The human sends a message to **Buzz Copilot** in Slack App Home.
2. The adapter admits only that exact DM ID and Slack user ID, then mirrors the
   request into the private Buzz copilot channel with a real agent mention.
3. The research copilot answers in Buzz using permitted channel evidence and
   Slack source permalinks.
4. The separate delivery worker verifies that the configured agent replied to
   a Slack-originated request from the paired Buzz human in the exact App Home
   DM, checks the citation and durable delivery receipt, then posts as
   **Buzz Copilot** in the app DM.

The worker polls Buzz every ten seconds by default. It never posts as the human,
never uses `chat:write.customize`, and never sends an uncited, unpaired, or
duplicate response.

## Verification

```bash
npm test
npm run check
```

Tests cover mapping validation and reconciliation, configuration redaction,
multi-channel routing, event normalization, message formatting, durable state,
stable actors, audience ledgers, Buzz CLI argument handling, idempotency,
threads, edits, deletes, channel filtering, pre-storage DM exclusion, exact
copilot routing, paired-request identity, citation enforcement, delivery
deduplication, and Socket Mode acknowledgement order.

## Roadmap

1. Membership change and private-channel revocation events.
2. Edit/delete-driven invalidation of dependent copilot findings.
3. Managed private-channel creation.
4. Claimable Slack-source personas linked to real Buzz identities.
5. A separate private `Signals` forum for cited cross-project analysis.
