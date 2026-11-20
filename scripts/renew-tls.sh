#!/usr/bin/env bash
set -euo pipefail
exec 9>/opt/chat-demo-backend/tls/renew.lock
flock -n 9 || exit 0
docker run --rm --network host \
  -v /opt/chat-demo-backend/tls:/etc/letsencrypt \
  -v /opt/1panel/apps/openresty/openresty/root:/acme-root \
  certbot/certbot:v5.10.0@sha256:c5698da859429ccee0fcc299a8000368198222d1f9e789ab6e388b491e8ce06d \
  renew --cert-name chat-demo-ip --quiet --no-random-sleep-on-renew
CHAT_TLS_LIVE=/opt/chat-demo-backend/tls/live/chat-demo-ip
CHAT_TLS_SITE=/opt/1panel/www/sites/chat-demo/ssl
if ! cmp -s "$CHAT_TLS_LIVE/fullchain.pem" "$CHAT_TLS_SITE/fullchain.pem"; then
  install -m 600 "$CHAT_TLS_LIVE/fullchain.pem" "$CHAT_TLS_SITE/fullchain.pem.next"
  install -m 600 "$CHAT_TLS_LIVE/privkey.pem" "$CHAT_TLS_SITE/privkey.pem.next"
  mv -f "$CHAT_TLS_SITE/fullchain.pem.next" "$CHAT_TLS_SITE/fullchain.pem"
  mv -f "$CHAT_TLS_SITE/privkey.pem.next" "$CHAT_TLS_SITE/privkey.pem"
  docker exec 1Panel-openresty-YrFQ nginx -t
  docker exec 1Panel-openresty-YrFQ nginx -s reload
fi
