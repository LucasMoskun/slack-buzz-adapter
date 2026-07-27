#!/bin/zsh
set -eu

script_dir=${0:A:h}
project_dir=${script_dir:h}
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin:/usr/bin:/bin"

status_path="${project_dir}/.data/channel-sync-last-run"
log_path="${project_dir}/.data/channel-sync-cron.log"
mapping_path="${project_dir}/channel-mappings.json"
applied_hash_path="${project_dir}/.data/channel-sync-applied-hash"
mkdir -p "${project_dir}/.data"

if ! (
  cd "${project_dir}"
  /usr/bin/env npm run --silent sync-channels:cron
) >> "${log_path}" 2>&1; then
  print -r -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) channel sync failed" >> "${log_path}"
  exit 1
fi

mapping_hash=$(/usr/bin/shasum -a 256 "${mapping_path}" | /usr/bin/awk '{print $1}')
applied_hash=$(/bin/cat "${applied_hash_path}" 2>/dev/null || true)
if [[ "${mapping_hash}" != "${applied_hash}" ]]; then
  if ! (
    cd "${project_dir}"
    /usr/bin/env npm run --silent refresh-live:cron
  ) >> "${log_path}" 2>&1; then
    print -r -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) live refresh failed" >> "${log_path}"
    exit 1
  fi
fi

print -r -- "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${status_path}"
