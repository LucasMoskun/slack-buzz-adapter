# Slack → Buzz Adapter

A small, dependency-free Node.js adapter that mirrors messages from one approved
Slack channel into one private Buzz channel. It also includes an optional
one-human copilot pilot with a dedicated Slack App Home DM, a private Buzz
copilot channel, and owner-approved delivery back to Slack.

This first milestone is intentionally narrow and testable:

- Slack Events API over Socket Mode
- one explicit Slack channel → Buzz channel mapping
- paginated historical backfill, including thread replies
- new messages and known-parent thread replies
- edits and deletion markers
- durable event deduplication and Slack-to-Buzz message mapping
- stable Slack actor and audience metadata
- a hard pre-persistence exclusion for human-to-human and multi-person DMs
- a dedicated human-copilot inbox that mentions the configured Buzz agent
- a separate worker that returns only cited, human-approved suggestions to Slack

Slack remains the source of truth. The adapter publishes through the local
`buzz` CLI, so it uses the same relay authentication model as other Buzz agents
and tools.

## Requirements

- Node.js 22 or newer
- the `buzz` CLI installed and available on `PATH`
- a Slack Pro demo workspace where you can create and install an internal app
- a private Buzz stream channel

No npm packages are required.

## 1. Create the Slack app

1. Open [Slack app management](https://api.slack.com/apps).
2. Choose **Create New App** → **From an app manifest**.
3. Select the demo workspace.
4. Paste [`slack-app-manifest.yaml`](./slack-app-manifest.yaml).
5. Install the app to the workspace.
6. Under **Basic Information → App-Level Tokens**, create a token with the
   `connections:write` scope. This is the `xapp-…` token.
7. Copy the bot token from **OAuth & Permissions**. This is the `xoxb-…` token.
8. Add **Buzz Copilot** to the Slack channel you want to test. Private channels
   require an explicit invitation.

The app requests channel history/metadata, user-profile reads, access to its own
one-to-one App Home conversations, and ordinary app-authored message delivery.
It does **not** request `mpim:history`, subscribe to `message.mpim`, request user
tokens, or request `chat:write.customize`.

If the app was installed from an earlier version of the manifest, update the
manifest and reinstall it so Slack grants `im:history`, `im:write`, and
`chat:write`, enables the App Home messages tab, and subscribes to `message.im`.
Socket Mode means no public webhook endpoint is required.

## 2. Create the Buzz mirror channel

Run this with the Buzz identity that should publish mirrored messages:

```bash
buzz --relay https://endcorp.communities.buzz.xyz channels create --name slack-demo-mirror --type stream --visibility private --description "Read-only mirror of the Slack demo channel"
```

Save the returned `channel_id`. Add Andrew and the selected research copilot to
the private channel through Buzz.

For the pilot, create a second private stream channel for the copilot inbox:

```bash
buzz --relay https://endcorp.communities.buzz.xyz channels create --name andrew-research-copilot --type stream --visibility private --description "Private review and approval queue for Andrew's Slack research copilot"
```

Add Andrew and `Andrew's Research Copilot` to this channel after the
owner-reviewed agent draft has been saved.

The relay flag is intentionally explicit. Without it (or a configured
`BUZZ_RELAY_URL`), the CLI defaults to the local development relay at
`http://localhost:3000`.

The CLI also requires `BUZZ_PRIVATE_KEY` in the terminal environment. Keep that
key local and never paste it into Slack, Buzz, issue reports, or command output.

## 3. Configure the adapter

```bash
cp .env.example .env
```

Set:

- `SLACK_APP_TOKEN`: the `xapp-…` Socket Mode token
- `SLACK_BOT_TOKEN`: the `xoxb-…` bot token
- `SLACK_CHANNEL_ID`: the Slack channel ID, not its display name
- `BUZZ_CHANNEL_ID`: the UUID returned by `buzz channels create`
- `BUZZ_RELAY_URL`: the Buzz relay URL
- `BUZZ_PRIVATE_KEY`: the Buzz publishing identity
- `BUZZ_AUTH_TAG`: optional owner attestation, when required by the relay

For the optional copilot route, also set:

- `COPILOT_SLACK_USER_ID`: the one Slack human allowed to use this pilot
- `COPILOT_BUZZ_CHANNEL_ID`: the private Buzz copilot channel
- `COPILOT_AGENT_NAME`: the exact Buzz display name; the adapter uses it as a
  real mention so the agent receives private requests

For approved delivery back to Slack, set:

- `COPILOT_AGENT_PUBKEY`: the saved copilot agent's Buzz public key
- `COPILOT_APPROVER_PUBKEY`: the human reviewer allowed to approve delivery

Slack channel IDs can be copied from **View channel details → About**.

Real credentials belong only in `.env`; that file and the runtime state directory
are ignored by git.

## 4. Validate both sides

```bash
npm run doctor
```

The doctor checks:

- Slack bot authentication
- access to the configured Slack channel
- Socket Mode app-token authentication
- access to the configured Buzz channel
- that the evidence source is a channel rather than a DM/MPIM
- the configured human's membership when the source is a private channel
- the dedicated App Home DM and private Buzz copilot channel

It prints IDs and channel metadata, never token values.

## 5. Backfill existing history

Stop `npm start` if it is currently running, then run:

```bash
npm run backfill
```

By default this retrieves all history that the Slack app can access in the
configured channel. It follows Slack cursor pagination, fetches thread replies,
sorts messages oldest-first, and publishes them into the same Buzz channel.

To set a lower bound, add an ISO-8601 date or Slack timestamp to `.env`:

```bash
BACKFILL_OLDEST=2026-01-01T00:00:00Z
```

The command reports fetched, created, already-existing, and ignored counts.
Re-running it is safe: deterministic backfill event IDs plus the persistent
Slack-to-Buzz message map prevent records already in state from being republished.

The live adapter and backfill command intentionally share an exclusive state
lock. If backfill reports that the state is locked, stop the live adapter with
`Ctrl-C`, run the backfill, then restart live mirroring.

## 6. Start mirroring

```bash
npm start
```

Send a message in the configured Slack channel. It should appear in the Buzz
channel with the Slack author, source channel, original timestamp, and a Slack
permalink.

The adapter acknowledges Socket Mode envelopes before processing them. Delivery
then runs serially and records state in `.data/state.json`. Restarting the process
does not republish events already recorded in that file.

## 7. Run the personal copilot pilot

Start the approved-delivery worker in a second terminal:

```bash
npm run copilot
```

The end-to-end loop is:

1. The human sends a message to **Buzz Copilot** in Slack App Home.
2. The adapter admits only that exact DM ID and Slack user ID, then mirrors the
   request into the private Buzz copilot channel with a real agent mention.
3. The research copilot answers in Buzz using permitted channel evidence and
   Slack source permalinks.
4. The human reviews the suggestion and either reacts ✅ to it or replies
   `/approve`.
5. The separate delivery worker verifies the agent identity, approver identity,
   citation, and durable delivery receipt before posting as **Buzz Copilot** in
   the app DM.

The worker polls Buzz every ten seconds by default. It never posts as the human,
never uses `chat:write.customize`, and never sends an uncited or unapproved
suggestion.

## Supported behavior

| Slack event | Buzz behavior |
|---|---|
| Historical message | Sends it oldest-first through `npm run backfill` |
| New message | Sends a mirrored Buzz message |
| Thread reply | Replies to the mirrored parent when the parent is in state |
| Edit | Edits the existing mirrored Buzz message |
| Delete | Replaces the mirrored content with a deletion marker |
| Duplicate event | Ignores it using the durable event receipt |
| Different channel | Ignores it |
| Configured human → Buzz Copilot App DM | Mirrors into the private Buzz copilot inbox |
| Any other one-to-one DM | Rejects before event receipt, storage, logging, or inference |
| Any multi-person DM | Rejects before event receipt, storage, logging, or inference |
| Cited copilot suggestion + human approval | Delivers once to the app DM |
| Uncited, unapproved, or wrong-author suggestion | Does not deliver |

A live thread reply whose parent is not yet in state is published as a normal
message. Run backfill before live mirroring so historical parents and replies are
mapped first.

## Verification

```bash
npm test
npm run check
```

Tests cover configuration redaction, event normalization, message formatting,
durable state, stable actors, audience ledgers, Buzz CLI argument handling,
idempotency, threads, edits, deletes, channel filtering, pre-storage DM
exclusion, exact copilot routing, approval identity, citation enforcement,
delivery deduplication, and Socket Mode acknowledgement order.

## Security notes

- The mirror process does not post to Slack. The separate copilot worker has the
  narrow outbound capability.
- Human-to-human DMs are excluded both by Slack permissions and adapter policy.
  The app subscribes only to `message.im`, which covers conversations involving
  the app, and it admits only the configured human and exact App Home DM.
- Multi-person DMs are excluded both by permissions (no `mpim:history`) and
  policy (`message.mpim` is not subscribed and `channel_type=mpim` is rejected).
- Excluded DMs are rejected before deduplication or persistence; their event IDs,
  content, actors, and message mappings are not stored.
- The personal App Home conversation is labelled personal context and must not
  be promoted into shared findings without an explicit share action.
- A private-channel ledger snapshots member IDs, and startup fails if the pilot
  human is not entitled to the configured private evidence channel.
- Outbound delivery requires a known agent author, known human approver, a Slack
  source permalink, and a durable once-only receipt.
- It does not download Slack files; file-only events mirror authenticated links.
- The `buzz` process is spawned directly without a shell.
- Runtime state is written with owner-only file permissions.
- Slack and Buzz credentials are read from environment variables and are never
  logged.
- Give the Buzz publishing identity access only to the intended private mirror
  channel.

## Next milestones

1. Multiple explicit channel mappings with per-recipient access checks.
2. Membership change and private-channel revocation events.
3. Edit/delete-driven invalidation of dependent copilot findings.
4. Managed private-channel creation and agent membership.
5. A separate private `Signals` forum for cited cross-project analysis.
