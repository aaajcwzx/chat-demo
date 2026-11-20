#!/usr/bin/env bash
set -euo pipefail
CHAT_ADMIN_SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CHAT_ADMIN_SITE=/opt/1panel/www/sites/chat-demo-admin
if [[ "${1:-}" != --publish-only ]]; then "$CHAT_ADMIN_SOURCE/scripts/build-admin.sh"; fi
test -s "$CHAT_ADMIN_SOURCE/web/dist/index.html"
cp "$CHAT_ADMIN_SOURCE/LICENSE" "$CHAT_ADMIN_SOURCE/web/dist/LICENSE"
CHAT_ADMIN_RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$CHAT_ADMIN_SOURCE" rev-parse --short HEAD)"
sudo -n install -d "$CHAT_ADMIN_SITE/releases/$CHAT_ADMIN_RELEASE"
sudo -n cp -a "$CHAT_ADMIN_SOURCE/web/dist/." "$CHAT_ADMIN_SITE/releases/$CHAT_ADMIN_RELEASE/"
sudo -n chown -R root:root "$CHAT_ADMIN_SITE/releases/$CHAT_ADMIN_RELEASE"
sudo -n ln -s "releases/$CHAT_ADMIN_RELEASE" "$CHAT_ADMIN_SITE/index-next"
sudo -n mv -Tf "$CHAT_ADMIN_SITE/index-next" "$CHAT_ADMIN_SITE/index"
curl --fail --silent --show-error --max-time 10 https://101.34.83.198/admin/ -o /home/ubuntu/.cache/chat-demo/admin-published.html
cmp "$CHAT_ADMIN_SOURCE/web/dist/index.html" /home/ubuntu/.cache/chat-demo/admin-published.html
printf 'Admin deployed: https://101.34.83.198/admin/ (%s)\n' "$CHAT_ADMIN_RELEASE"
