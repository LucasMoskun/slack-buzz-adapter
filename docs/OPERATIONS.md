# Slack–Buzz mirror operations

The service is a one-way, derived mirror. Slack remains the source of truth.

## Host prerequisites

- Node.js 22 or newer available as `/usr/bin/node`.
- Buzz CLI installed and available on `PATH`.
- `rsync`, `npm`, systemd, and standard Linux account-management tools.

The installer validates Node and Buzz before changing service files. Install a
supported Node runtime through the host's approved package-management process;
do not pipe an unaudited remote setup script into a privileged shell.

## Health and logs

```bash
systemctl is-active slack-buzz-mirror
journalctl -u slack-buzz-mirror --since '30 minutes ago' --no-pager
```

Healthy startup includes Slack authentication, resolved channel routes, and an
open Socket Mode connection. Treat repeated authentication, mapping, or state
lock failures as unhealthy; do not delete state to force recovery.

## Restart

```bash
sudo systemctl restart slack-buzz-mirror
sudo systemctl status slack-buzz-mirror --no-pager
```

The receipt store records each Slack event and deterministic backfill event
before later reprocessing. A stale lock owned by a dead PID is removed at the
next startup. Replayed messages are classified as duplicates and are not sent
again.

## Gap recovery

Reconciliation discovers only sources in the explicit stable-ID allowlist,
creates missing private Buzz channels, and updates route mappings. It does not
recover historical messages. Use `npm run backfill` after reconciliation to
recover gaps; the shared state lock prevents concurrent mutation by the live
adapter and backfill process. Stop the service for a controlled backfill, then
restart it after the command exits successfully.

Never broaden the allowlist merely to diagnose a mapping. An existing mapping
outside the allowlist intentionally stops reconciliation.

## Media links

The adapter does not re-host Slack files and has no media-link refresh worker.
It mirrors Slack permalinks or `url_private` links, which may require Slack
authentication. A link is rendered again only when Slack emits a message edit.
This preserves Slack as the content authority and avoids copying files into a
second storage system.
