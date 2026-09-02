#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install -d -o root -g root -m 0755 /opt/slack-buzz-mirror/app
if ! getent group slack-buzz-mirror >/dev/null; then groupadd --system slack-buzz-mirror; fi
if ! id slack-buzz-mirror >/dev/null 2>&1; then
  useradd --system --gid slack-buzz-mirror --home-dir /var/lib/slack-buzz-mirror --shell /usr/sbin/nologin slack-buzz-mirror
fi
rsync -a --delete --exclude .git --exclude .env --exclude .data "$source_dir/" /opt/slack-buzz-mirror/app/
cd /opt/slack-buzz-mirror/app
npm install --omit=dev --ignore-scripts
install -d -o root -g slack-buzz-mirror -m 0750 /etc/slack-buzz-mirror
if [[ ! -e /etc/slack-buzz-mirror/env ]]; then
  install -o root -g slack-buzz-mirror -m 0640 deploy/env.template /etc/slack-buzz-mirror/env
fi
install -o root -g root -m 0644 deploy/slack-buzz-mirror.service /etc/systemd/system/slack-buzz-mirror.service
systemctl daemon-reload
echo "Installed but not enabled or started; populate /etc/slack-buzz-mirror/env and run the gated canary first."
