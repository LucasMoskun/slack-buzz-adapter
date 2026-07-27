# Slack → Buzz Adapter

A small, dependency-free Node.js adapter that mirrors explicitly mapped Slack
channels into one private Buzz channel each. It also includes an optional
one-human copilot pilot with a dedicated Slack App Home DM, a private Buzz
copilot channel, and automatic private reply delivery back to Slack.

The current milestone is explicit and testable:

- Slack Events API over Socket Mode
- an audited one-to-one Slack channel → Buzz channel mapping file
- idempotent public-channel enrollment and private Buzz mirror creation
- minutely reconciliation with hot route refresh and new-channel backfill
- paginated historical backfill, including thread replies
- new messages and known-parent thread replies
- edits and deletion markers
- durable event deduplication and Slack-to-Buzz message mapping
- stable Slack actor and audience metadata
- a hard pre-persistence exclusion for human-to-human and multi-person DMs
- a dedicated human-copilot inbox that mentions the configured Buzz agent
- a separate worker that returns only cited, paired private replies to Slack

Slack remains the source of truth. The adapter publishes through the local
`buzz` CLI, so it uses the same relay authentication model as other Buzz agents
and tools.

## Requirements

- Node.js 22 or newer
- the `buzz` CLI installed and available on `PATH`
- a Slack Pro demo workspace where you can create and install an internal app
- permission to create private Buzz stream channels

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
to `message.im`. Socket Mode means no public webhook endpoint is required.

## 2. Configure the adapter

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

Real credentials belong only in `.env`; that file and the runtime state directory
are ignored by git. `channel-mappings.json` is generated deployment state and is
also ignored by git; do not commit workspace/channel IDs into the codebase.

## 3. Reconcile all source channels

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

## 4. Install minutely reconciliation

Install the managed crontab block:

```bash
/bin/zsh scripts/install-channel-sync-cron.sh
```

Every minute, the job:

1. acquires an exclusive reconciliation lock;
2. discovers Slack channels and updates the runtime-only mapping;
3. joins new public channels and creates same-named private Buzz mirrors;
4. repairs configured human/copilot membership;
5. signals the live adapter only when the mapping hash changed; and
6. hot-adds and backfills new routes inside the live adapter's state lock.

The job writes its last successful run time to
`.data/channel-sync-last-run`. It is quiet on unchanged successful runs and
records failures or material changes in `.data/channel-sync-cron.log`.

## 5. Validate both sides

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

## 6. Backfill existing history

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
Slack-to-Buzz message map prevent records already in state from being republished.

The live adapter and backfill command intentionally share an exclusive state
lock. If backfill reports that the state is locked, stop the live adapter with
`Ctrl-C`, run the backfill, then restart live mirroring.

## 7. Start mirroring

```bash
npm start
```

Send a message in any mapped Slack channel. It should appear in its Buzz
destination with the Slack author, source channel, original timestamp, and a
Slack permalink.

The adapter acknowledges Socket Mode envelopes before processing them. Delivery
then runs serially and records state in `.data/state.json`. Restarting the process
does not republish events already recorded in that file.

## 8. Run the personal copilot pilot

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
message. Run backfill before live mirroring so historical parents and replies are
mapped first.

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

## Security notes

- The live mirror process does not post messages to Slack. Reconciliation only
  joins public source channels; the separate copilot worker has the narrow
  outbound message capability.
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
  human is not entitled to any configured private evidence source.
- Outbound delivery requires a known agent author, a reply to the paired
  human's exact Slack App Home request, a Slack source permalink, and a durable
  once-only receipt.
- It does not download Slack files; file-only events mirror authenticated links.
- The `buzz` process is spawned directly without a shell.
- Runtime state is written with owner-only file permissions.
- Slack and Buzz credentials are read from environment variables and are never
  logged.
- Every mirror is private. Routing uses immutable IDs and rejects duplicate
  destinations.
- Public enrollment is explicit through reconciliation. Private sources remain
  Slack invitation-only and cannot be silently claimed as covered.
- The mapping contains deployment-specific channel IDs, is mode `0600` at
  runtime, and is excluded from git.

## Next milestones

1. Membership change and private-channel revocation events.
2. Edit/delete-driven invalidation of dependent copilot findings.
3. Managed private-channel creation.
4. Claimable Slack-source personas linked to real Buzz identities.
5. A separate private `Signals` forum for cited cross-project analysis.
