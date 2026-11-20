#!/usr/bin/env bash
set -euo pipefail
CHAT_QA_SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
"$CHAT_QA_SOURCE/scripts/prepare-qa.py"
sudo -n docker run -d --name chat-demo-backend-qa --user 1000:1000 \
  --network 1panel-network --memory 384m --memory-swap 384m --cpus 2 \
  --cap-drop ALL --security-opt no-new-privileges:true --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m,uid=1000,gid=1000 \
  --env-file /home/ubuntu/.cache/chat-demo/backend-qa/backend.env \
  -v /home/ubuntu/.cache/chat-demo/go/chat-demo-backend:/app/server:ro \
  -v /home/ubuntu/.cache/chat-demo/backend-qa/config.yaml:/config/config.yaml:ro \
  -v /home/ubuntu/.cache/chat-demo/backend-qa/runtime:/runtime \
  -v "$CHAT_QA_SOURCE/server/resource:/runtime/resource:ro" \
  -w /runtime -p 127.0.0.1:8093:8092 \
  alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf \
  /app/server -c /config/config.yaml >/dev/null
for CHAT_QA_ATTEMPT in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:8093/api/chat/status >/dev/null; then
    printf 'Isolated QA backend available on 127.0.0.1:8093.\n'; exit 0
  fi
  sleep 1
done
exit 1
