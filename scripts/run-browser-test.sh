#!/usr/bin/env bash
set -euo pipefail
CHAT_BROWSER_SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$CHAT_BROWSER_SOURCE/scripts/resource-guard.sh"
chat_build_guard 384
if [[ $# != 1 ]] || [[ ! -f "$1" ]]; then
  printf 'Usage: %s <test.cjs>\n' "$0" >&2; exit 2
fi
CHAT_BROWSER_SCOPE="chat-demo-browser-${BASHPID}.scope"
chat_build_watch_memory "$CHAT_BROWSER_SCOPE" scope &
CHAT_BROWSER_WATCH_PID=$!
chat_browser_cleanup() {
  kill "$CHAT_BROWSER_WATCH_PID" 2>/dev/null || true
  sudo -n systemctl stop "$CHAT_BROWSER_SCOPE" >/dev/null 2>&1 || true
}
trap chat_browser_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
sudo -n systemd-run --scope --quiet --unit "$CHAT_BROWSER_SCOPE" \
  -p "MemoryMax=${CHAT_BUILD_LIMIT_MIB}M" -p MemorySwapMax=0 -p CPUQuota=100% -p "AllowedCPUs=$CHAT_BUILD_CPU" -p TasksMax=256 -p Nice=10 \
  /usr/bin/sudo -u ubuntu -- /usr/bin/node "$(realpath "$1")"
