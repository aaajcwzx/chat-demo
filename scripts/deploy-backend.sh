#!/usr/bin/env bash
set -euo pipefail
CHAT_BACKEND_SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CHAT_BACKEND_ROOT=/opt/chat-demo-backend
"$CHAT_BACKEND_SOURCE/scripts/build-backend.sh"
CHAT_BACKEND_RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$CHAT_BACKEND_SOURCE" rev-parse --short HEAD)"
CHAT_BACKEND_TARGET="$CHAT_BACKEND_ROOT/releases/$CHAT_BACKEND_RELEASE"
install -d "$CHAT_BACKEND_TARGET"
install -m 755 /home/ubuntu/.cache/chat-demo/go/chat-demo-backend "$CHAT_BACKEND_TARGET/server"
cp -a "$CHAT_BACKEND_SOURCE/server/resource" "$CHAT_BACKEND_TARGET/resource"
cp "$CHAT_BACKEND_SOURCE/LICENSE" "$CHAT_BACKEND_TARGET/LICENSE"
if [[ -e "$CHAT_BACKEND_ROOT/current" ]]; then
  "$CHAT_BACKEND_SOURCE/scripts/backup.py"
  readlink "$CHAT_BACKEND_ROOT/current" > "$CHAT_BACKEND_ROOT/previous-release.txt"
fi
ln -s "releases/$CHAT_BACKEND_RELEASE" "$CHAT_BACKEND_ROOT/current-next"
mv -Tf "$CHAT_BACKEND_ROOT/current-next" "$CHAT_BACKEND_ROOT/current"
ln -sfn /app/resource "$CHAT_BACKEND_ROOT/runtime/resource"
sudo -n docker compose -f "$CHAT_BACKEND_SOURCE/deploy/chat-demo.compose.yaml" up -d --force-recreate
for CHAT_BACKEND_ATTEMPT in {1..30}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8092/api/chat/status >/dev/null; then
    printf 'Chat backend deployed: %s (127.0.0.1:8092)\n' "$CHAT_BACKEND_RELEASE"
    exit 0
  fi
  sleep 1
done
printf 'Backend startup failed; inspect docker logs chat-demo-backend.\n' >&2
exit 1
