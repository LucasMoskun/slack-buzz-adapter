# Slack → Buzz Adapter

A small, dependency-free Node.js adapter that mirrors messages from one Slack
channel into one private Buzz channel.

This first milestone is intentionally narrow and testable:

- Slack Events API over Socket Mode
- one explicit Slack channel → Buzz channel mapping
- new messages and known-parent thread replies
- edits and deletion markers
- durable event deduplication and Slack-to-Buzz message mapping
- no messages or agent output written back to Slack

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
8. Add **Buzz Mirror** to the Slack channel you want to test. Private channels
   require an explicit invitation.

The app requests only message-history, channel-metadata, and user-profile read
scopes. Socket Mode means no public webhook endpoint is required.

## 2. Create the Buzz mirror channel

Run this with the Buzz identity that should publish mirrored messages:

```bash
buzz --relay https://endcorp.communities.buzz.xyz channels create --name slack-demo-mirror --type stream --visibility private --description "Read-only mirror of the Slack demo channel"
```

Save the returned `channel_id`. Add Andrew and any selected analysis agents to
the private channel through Buzz.

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

It prints IDs and channel metadata, never token values.

## 5. Start mirroring

```bash
npm start
```

Send a message in the configured Slack channel. It should appear in the Buzz
channel with the Slack author, source channel, original timestamp, and a Slack
permalink.

The adapter acknowledges Socket Mode envelopes before processing them. Delivery
then runs serially and records state in `.data/state.json`. Restarting the process
does not republish events already recorded in that file.

## Supported behavior

| Slack event | Buzz behavior |
|---|---|
| New message | Sends a mirrored Buzz message |
| Thread reply | Replies to the mirrored parent when the parent is in state |
| Edit | Edits the existing mirrored Buzz message |
| Delete | Replaces the mirrored content with a deletion marker |
| Duplicate event | Ignores it using the durable event receipt |
| Different channel | Ignores it |

A thread reply whose parent predates the adapter state is published as a normal
message. Historical backfill is the next milestone and will remove that edge
case.

## Verification

```bash
npm test
npm run check
```

Tests cover configuration redaction, event normalization, message formatting,
durable state, Buzz CLI argument handling, idempotency, threads, edits, deletes,
channel filtering, and Socket Mode acknowledgement order.

## Security notes

- The adapter is one-way. It never posts to Slack.
- It does not download Slack files; file-only events mirror authenticated links.
- The `buzz` process is spawned directly without a shell.
- Runtime state is written with owner-only file permissions.
- Slack and Buzz credentials are read from environment variables and are never
  logged.
- Give the Buzz publishing identity access only to the intended private mirror
  channel.

## Next milestones

1. Historical backfill with `conversations.history` and
   `conversations.replies`.
2. Multiple channel mappings in one workspace adapter.
3. Automatic public-channel discovery and joining.
4. Managed private-channel creation.
5. Reactions, channel rename/archive handling, and coverage reporting.
6. A separate private `Signals` forum for cited cross-project analysis.
