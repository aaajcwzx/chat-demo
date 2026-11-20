#!/usr/bin/env bash

CHAT_DEMO_SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CHAT_DEMO_CACHE_DIR="${CHAT_DEMO_CACHE_DIR:-/home/ubuntu/.cache/chat-demo}"
CHAT_DEMO_BUILD_IMAGE="node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54"
CHAT_DEMO_PNPM_VERSION="12.6.0"
source "$CHAT_DEMO_SOURCE_DIR/scripts/resource-guard.sh"

chat_demo_require_custom_clean() {
  if [[ "$(git -C "$CHAT_DEMO_SOURCE_DIR" branch --show-current)" != custom ]]; then
    printf '请先切换到二开分支：git switch custom\n' >&2
    return 1
  fi
  if [[ -n "$(git -C "$CHAT_DEMO_SOURCE_DIR" status --porcelain)" ]]; then
    printf '请先提交当前修改，再同步官方或部署。使用 git status 查看待提交文件。\n' >&2
    return 1
  fi
  if git -C "$CHAT_DEMO_SOURCE_DIR" rev-parse -q --verify MERGE_HEAD >/dev/null; then
    printf '请先完成或取消当前合并，再同步官方或部署。\n' >&2
    return 1
  fi
}

chat_demo_run_node() (
  chat_build_guard || exit 1
  CHAT_DEMO_CONTAINER_NAME="chat-demo-${1}-$(id -u)-${BASHPID}-${RANDOM}"
  chat_build_watch_memory "$CHAT_DEMO_CONTAINER_NAME" &
  CHAT_DEMO_WATCH_PID=$!
  chat_demo_cleanup_container() {
    kill "$CHAT_DEMO_WATCH_PID" 2>/dev/null || true
    sudo -n docker stop --time 5 "$CHAT_DEMO_CONTAINER_NAME" >/dev/null 2>&1 || true
  }
  trap chat_demo_cleanup_container EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  install -d "$CHAT_DEMO_CACHE_DIR"
  sudo -n docker run --rm --name "$CHAT_DEMO_CONTAINER_NAME" --user "$(id -u):$(id -g)" --network host \
    --memory "${CHAT_BUILD_LIMIT_MIB}m" --memory-swap "${CHAT_BUILD_LIMIT_MIB}m" --cpus 1 --cpuset-cpus "$CHAT_BUILD_CPU" --pids-limit 128 \
    --label com.chat-demo.build=true \
    --label "com.chat-demo.task=$1" --label "com.chat-demo.source=$CHAT_DEMO_SOURCE_DIR" \
    -e npm_config_cache=/cache/npm \
    -e NODE_OPTIONS=--max-old-space-size=384 -e RAYON_NUM_THREADS=1 -e UV_THREADPOOL_SIZE=1 \
    -e "CHAT_DEMO_PNPM_VERSION=$CHAT_DEMO_PNPM_VERSION" \
    -v "$CHAT_DEMO_SOURCE_DIR:/workspace" -v "$CHAT_DEMO_CACHE_DIR:/cache" \
    -w /workspace "$CHAT_DEMO_BUILD_IMAGE" sh -c 'set -eu
      if [ ! -x /cache/tools/node_modules/.bin/pnpm ] || [ "$(/cache/tools/node_modules/.bin/pnpm --version)" != "$CHAT_DEMO_PNPM_VERSION" ]; then
        npm install --prefix /cache/tools --no-audit --no-fund "pnpm@$CHAT_DEMO_PNPM_VERSION"
      fi
      /cache/tools/node_modules/.bin/pnpm install --frozen-lockfile --store-dir /cache/pnpm-store
      exec /cache/tools/node_modules/.bin/pnpm "$@"' sh "$@"
)

chat_demo_dist_digest() {
  python3 - "$CHAT_DEMO_SOURCE_DIR/dist" <<'PY'
import hashlib, sys
from pathlib import Path
root = Path(sys.argv[1])
digest = hashlib.sha256()
for path in sorted(root.rglob('*')):
    if path.is_file():
        digest.update(path.relative_to(root).as_posix().encode('utf-8') + b'\0')
        digest.update(hashlib.sha256(path.read_bytes()).digest())
print(digest.hexdigest())
PY
}
