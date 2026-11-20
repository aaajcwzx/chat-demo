#!/usr/bin/env bash
set -euo pipefail
CHAT_PREVIEW_SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if sudo -n docker inspect chat-demo-preview-qa >/dev/null 2>&1; then
  sudo -n docker rm -f chat-demo-preview-qa >/dev/null
fi
sudo -n docker run -d --name chat-demo-preview-qa --restart unless-stopped \
  --label com.chat-demo.qa=true --user 1000:1000 --network host --memory 128m --memory-swap 128m --cpus 0.5 \
  -e CHAT_FRONTEND_DIST=/frontend/dist -e NODE_OPTIONS=--max-old-space-size=64 \
  -v /home/ubuntu/chat-demo:/frontend:ro -v "$CHAT_PREVIEW_SOURCE/tests:/tests:ro" \
  node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 \
  node /tests/preview-and-gateway.cjs >/dev/null
printf 'QA static preview and fake model gateway started.\n'
