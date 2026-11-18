#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/chat-demo-env.sh"
CHAT_DEMO_SITE_DIR="/opt/1panel/www/sites/chat-demo"
CHAT_DEMO_HOST="101.34.83.198"

case "${1:-}" in
  ""|--publish-only) ;;
  *) printf 'Usage: %s [--publish-only]\n' "$0" >&2; exit 2 ;;
esac
if (( $# > 1 )); then
  printf 'Usage: %s [--publish-only]\n' "$0" >&2
  exit 2
fi
chat_demo_require_custom_clean

install -d "$CHAT_DEMO_CACHE_DIR"
exec 9>"$CHAT_DEMO_CACHE_DIR/deploy.lock"
flock -n 9 || { printf 'Another chat-demo deployment is running.\n' >&2; exit 1; }

if [[ "${1:-}" != --publish-only ]]; then
  "$CHAT_DEMO_SOURCE_DIR/scripts/check-project.sh"
fi
chat_demo_require_custom_clean

CHAT_DEMO_PUBLISH_COMMIT="$(git -C "$CHAT_DEMO_SOURCE_DIR" rev-parse HEAD)"
CHAT_DEMO_PUBLISH_DIGEST="$(chat_demo_dist_digest)"
python3 - "$CHAT_DEMO_CACHE_DIR/build-info.json" "$CHAT_DEMO_PUBLISH_COMMIT" "$CHAT_DEMO_PUBLISH_DIGEST" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
try:
    metadata = json.loads(path.read_text())
except (OSError, ValueError):
    raise SystemExit('请先运行 ./scripts/check-project.sh 生成并验证构建产物。')
if not metadata.get('clean') or metadata.get('commit') != sys.argv[2] or metadata.get('dist_digest') != sys.argv[3]:
    raise SystemExit('构建产物与当前已提交代码不一致，请重新运行 ./scripts/check-project.sh。')
PY

test -s "$CHAT_DEMO_SOURCE_DIR/dist/index.html"
test -f "$CHAT_DEMO_SOURCE_DIR/dist/LICENSE"
test -f /opt/1panel/www/conf.d/chat-demo.conf

CHAT_DEMO_RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$CHAT_DEMO_SOURCE_DIR" rev-parse --short HEAD)"
CHAT_DEMO_RELEASE_DIR="$CHAT_DEMO_SITE_DIR/releases/$CHAT_DEMO_RELEASE"
sudo -n install -d "$CHAT_DEMO_RELEASE_DIR"
sudo -n cp -a "$CHAT_DEMO_SOURCE_DIR/dist/." "$CHAT_DEMO_RELEASE_DIR/"
sudo -n chown -R root:root "$CHAT_DEMO_RELEASE_DIR"

if [[ -d "$CHAT_DEMO_SITE_DIR/index" && ! -L "$CHAT_DEMO_SITE_DIR/index" ]]; then
  sudo -n mv "$CHAT_DEMO_SITE_DIR/index" "$CHAT_DEMO_SITE_DIR/releases/1panel-initial-$CHAT_DEMO_RELEASE"
  CHAT_DEMO_PREVIOUS_TARGET="releases/1panel-initial-$CHAT_DEMO_RELEASE"
else
  CHAT_DEMO_PREVIOUS_TARGET="$(readlink "$CHAT_DEMO_SITE_DIR/index")"
fi

sudo -n ln -s "releases/$CHAT_DEMO_RELEASE" "$CHAT_DEMO_SITE_DIR/index-next-$CHAT_DEMO_RELEASE"
sudo -n mv -Tf "$CHAT_DEMO_SITE_DIR/index-next-$CHAT_DEMO_RELEASE" "$CHAT_DEMO_SITE_DIR/index"

if ! curl --noproxy '*' --fail --silent --show-error --max-time 15 \
  -H "Host: $CHAT_DEMO_HOST" http://127.0.0.1/ -o "$CHAT_DEMO_CACHE_DIR/deployed-index.html" \
  || ! cmp -s "$CHAT_DEMO_SOURCE_DIR/dist/index.html" "$CHAT_DEMO_CACHE_DIR/deployed-index.html"; then
  sudo -n ln -s "$CHAT_DEMO_PREVIOUS_TARGET" "$CHAT_DEMO_SITE_DIR/index-rollback-$CHAT_DEMO_RELEASE"
  sudo -n mv -Tf "$CHAT_DEMO_SITE_DIR/index-rollback-$CHAT_DEMO_RELEASE" "$CHAT_DEMO_SITE_DIR/index"
  printf 'HTTP verification failed; the previous release has been restored.\n' >&2
  exit 1
fi

printf 'Deployed %s to http://%s/\n' "$CHAT_DEMO_RELEASE" "$CHAT_DEMO_HOST"
