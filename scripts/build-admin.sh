#!/usr/bin/env bash
set -euo pipefail
CHAT_ADMIN_SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$CHAT_ADMIN_SOURCE/scripts/resource-guard.sh"
chat_build_guard
CHAT_ADMIN_CACHE=/home/ubuntu/.cache/chat-demo
CHAT_ADMIN_BUILD_CONTAINER="chat-demo-admin-build-${BASHPID}"
chat_build_watch_memory "$CHAT_ADMIN_BUILD_CONTAINER" &
CHAT_ADMIN_WATCH_PID=$!
chat_admin_build_cleanup() {
  kill "$CHAT_ADMIN_WATCH_PID" 2>/dev/null || true
  sudo -n docker stop --time 5 "$CHAT_ADMIN_BUILD_CONTAINER" >/dev/null 2>&1 || true
}
trap chat_admin_build_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
chat_admin_run_phase() {
  sudo -n docker run --rm --name "$CHAT_ADMIN_BUILD_CONTAINER" --user "$(id -u):$(id -g)" --network host \
  --memory "${CHAT_BUILD_LIMIT_MIB}m" --memory-swap "${CHAT_BUILD_LIMIT_MIB}m" --cpus 1 --cpuset-cpus "$CHAT_BUILD_CPU" --pids-limit 128 \
  --label com.chat-demo.build=true \
  -e npm_config_cache=/cache/npm -e npm_config_maxsockets=1 -e "NODE_OPTIONS=--max-old-space-size=$1" -e RAYON_NUM_THREADS=1 -e UV_THREADPOOL_SIZE=1 \
  -v "$CHAT_ADMIN_SOURCE/web:/workspace" -v "$CHAT_ADMIN_CACHE:/cache" -w /workspace \
  node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 \
  sh -c "$2"
}
chat_admin_run_phase 256 'set -e
  if [ ! -x /cache/tools/node_modules/.bin/pnpm ]; then
    npm install --prefix /cache/tools --ignore-scripts --no-audit --no-fund pnpm@12.6.0
  fi
  test "$(/cache/tools/node_modules/.bin/pnpm --version)" = 12.6.0
  /cache/tools/node_modules/.bin/pnpm install --frozen-lockfile --store-dir /cache/pnpm-store --child-concurrency=1 --network-concurrency=4'
chat_admin_run_phase 384 'exec node node_modules/vite/bin/vite.js build --mode production'
cp "$CHAT_ADMIN_SOURCE/LICENSE" "$CHAT_ADMIN_SOURCE/web/dist/LICENSE"
test -s "$CHAT_ADMIN_SOURCE/web/dist/index.html"
printf 'Admin production build complete (/admin/).\n'
