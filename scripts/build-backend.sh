#!/usr/bin/env bash
set -euo pipefail
CHAT_BACKEND_SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$CHAT_BACKEND_SOURCE/scripts/resource-guard.sh"
chat_build_guard
CHAT_BACKEND_CACHE=/home/ubuntu/.cache/chat-demo/go
CHAT_GO_IMAGE='golang:1.27.4-alpine@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280'
install -d "$CHAT_BACKEND_CACHE"
CHAT_BACKEND_BUILD_CONTAINER="chat-demo-go-build-${BASHPID}"
chat_build_watch_memory "$CHAT_BACKEND_BUILD_CONTAINER" &
CHAT_BACKEND_WATCH_PID=$!
chat_backend_build_cleanup() {
  kill "$CHAT_BACKEND_WATCH_PID" 2>/dev/null || true
  sudo -n docker stop --time 5 "$CHAT_BACKEND_BUILD_CONTAINER" >/dev/null 2>&1 || true
}
trap chat_backend_build_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
sudo -n docker run --rm --name "$CHAT_BACKEND_BUILD_CONTAINER" --user "$(id -u):$(id -g)" --network host \
  --memory "${CHAT_BUILD_LIMIT_MIB}m" --memory-swap "${CHAT_BUILD_LIMIT_MIB}m" --cpus 1 --cpuset-cpus "$CHAT_BUILD_CPU" --pids-limit 128 \
  --label com.chat-demo.build=true \
  -e GOCACHE=/go/build-cache -e GOGC=30 -e GOMAXPROCS=1 -e GOTOOLCHAIN=local \
  -e GOPROXY=https://goproxy.cn,https://proxy.golang.org,direct \
  -v "$CHAT_BACKEND_SOURCE/server:/workspace" -v "$CHAT_BACKEND_CACHE:/go" -w /workspace \
  "$CHAT_GO_IMAGE" sh -ec 'gofmt -w plugin/chat main.go service/system/sys_initdb.go model/common/response/response.go initialize/router.go utils/claims.go
    go test -p 1 ./plugin/chat/...
    go build -p 1 -trimpath -ldflags="-s -w" -o /go/chat-demo-backend .'
