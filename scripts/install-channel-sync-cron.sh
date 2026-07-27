#!/bin/zsh
set -eu

script_dir=${0:A:h}
runner_path="${script_dir}/channel-sync-cron.sh"
begin_marker="# BEGIN slack-buzz-adapter channel-sync"
end_marker="# END slack-buzz-adapter channel-sync"
temporary_path=$(/usr/bin/mktemp)
filtered_path=$(/usr/bin/mktemp)

cleanup() {
  /bin/rm -f "${temporary_path}" "${filtered_path}"
}
trap cleanup EXIT

/usr/bin/crontab -l > "${temporary_path}" 2>/dev/null || true
/usr/bin/awk \
  -v begin="${begin_marker}" \
  -v end="${end_marker}" \
  'index($0, begin) { skip=1; next } index($0, end) { skip=0; next } !skip { print }' \
  "${temporary_path}" > "${filtered_path}"

{
  /bin/cat "${filtered_path}"
  print -r -- "${begin_marker}"
  print -r -- "* * * * * /bin/zsh ${runner_path}"
  print -r -- "${end_marker}"
} > "${temporary_path}"

/usr/bin/crontab "${temporary_path}"
print -r -- "Installed minutely Slack/Buzz channel reconciliation."

