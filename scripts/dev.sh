#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/chat-demo-env.sh"

CHAT_DEMO_DEV_PORT="${CHAT_DEMO_DEV_PORT:-8091}"
CHAT_DEMO_DEV_HOST="${CHAT_DEMO_DEV_HOST:-127.0.0.1}"
if [[ ! "$CHAT_DEMO_DEV_PORT" =~ ^[0-9]+$ ]] || (( CHAT_DEMO_DEV_PORT < 1 || CHAT_DEMO_DEV_PORT > 65535 )); then
  printf 'CHAT_DEMO_DEV_PORT 必须是 1 至 65535 的端口号。\n' >&2
  exit 2
fi
printf '开发预览：http://%s:%s/，按 Ctrl+C 停止。\n' "$CHAT_DEMO_DEV_HOST" "$CHAT_DEMO_DEV_PORT"
chat_demo_run_node dev --host "$CHAT_DEMO_DEV_HOST" --port "$CHAT_DEMO_DEV_PORT"
