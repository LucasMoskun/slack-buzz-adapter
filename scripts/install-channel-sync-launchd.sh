#!/bin/zsh
set -eu

script_dir=${0:A:h}
project_dir=${script_dir:h}
label="com.buzz.slack-channel-sync"
plist_path="${project_dir}/.data/${label}.plist"
service_target="gui/${UID}/${label}"

mkdir -p "${project_dir}/.data"
/usr/bin/plutil -create xml1 "${plist_path}"
/usr/bin/plutil -insert Label -string "${label}" "${plist_path}"
/usr/bin/plutil -insert ProgramArguments -json '[]' "${plist_path}"
/usr/bin/plutil -insert ProgramArguments.0 -string "/bin/zsh" "${plist_path}"
/usr/bin/plutil -insert ProgramArguments.1 -string \
  "${project_dir}/scripts/channel-sync-cron.sh" "${plist_path}"
/usr/bin/plutil -insert WorkingDirectory -string "${project_dir}" "${plist_path}"
/usr/bin/plutil -insert StartInterval -integer 60 "${plist_path}"
/usr/bin/plutil -insert RunAtLoad -bool true "${plist_path}"
/usr/bin/plutil -insert ProcessType -string "Background" "${plist_path}"
/usr/bin/plutil -insert StandardOutPath -string \
  "${project_dir}/.data/channel-sync-launchd.out" "${plist_path}"
/usr/bin/plutil -insert StandardErrorPath -string \
  "${project_dir}/.data/channel-sync-launchd.err" "${plist_path}"
/usr/bin/plutil -lint "${plist_path}"

/bin/launchctl bootout "${service_target}" 2>/dev/null || true
/bin/launchctl bootstrap "gui/${UID}" "${plist_path}"
/bin/launchctl enable "${service_target}"
/bin/launchctl kickstart "${service_target}"
print -r -- "Installed 60-second Slack/Buzz channel reconciliation with launchd."
