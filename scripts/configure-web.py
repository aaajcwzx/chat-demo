#!/usr/bin/env python3
"""Enable HTTPS on this one 1Panel site, retaining HTTP for browser data migration."""
from pathlib import Path
import shutil, subprocess, datetime, re

ROOT=Path('/opt/chat-demo-backend')
SITE=Path('/opt/1panel/www/sites/chat-demo')
CONF=Path('/opt/1panel/www/conf.d/chat-demo.conf')
SSL=SITE/'ssl'
SSL.mkdir(mode=0o700,exist_ok=True)
for name, source in [('fullchain.pem','fullchain.pem'),('privkey.pem','privkey.pem')]:
    temporary=SSL/(name+'.next')
    shutil.copyfile(ROOT/'tls/live/chat-demo-ip'/source,temporary)
    temporary.chmod(0o600)
    temporary.replace(SSL/name)

proxy='''        proxy_pass http://127.0.0.1:8092;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 900s;
        proxy_send_timeout 900s;
        proxy_connect_timeout 5s;
        proxy_buffering off;
        proxy_request_buffering off;'''
content='''# Chat Demo: HTTP remains available for its original browser storage.
server {
    listen 80;
    listen [::]:80;
    server_name 101.34.83.198;
    root /www/sites/chat-demo/index;
    index index.html;
    access_log /www/sites/chat-demo/log/access.log main;
    error_log /www/sites/chat-demo/log/error.log;
    location ^~ /.well-known/acme-challenge/ {
        root /usr/share/nginx/html;
        allow all;
    }
    location = /api/chat/status {
PROXY
    }
    location ^~ /api/ { return 308 https://101.34.83.198$request_uri; }
    location = /admin { return 308 https://101.34.83.198/admin/; }
    location ^~ /admin/ { return 308 https://101.34.83.198$request_uri; }
    location = /index.html { add_header Cache-Control "no-cache"; }
    location ^~ /static/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
    location = /LICENSE { default_type text/plain; }
    location ~ /\. { return 404; }
    location / { try_files $uri $uri/ /index.html; }
}
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    http2 on;
    server_name 101.34.83.198;
    ssl_certificate /www/sites/chat-demo/ssl/fullchain.pem;
    ssl_certificate_key /www/sites/chat-demo/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:chat_demo_tls:10m;
    root /www/sites/chat-demo/index;
    index index.html;
    client_max_body_size 256m;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    access_log /www/sites/chat-demo/log/access.log main;
    error_log /www/sites/chat-demo/log/error.log;
    location ^~ /api/ {
PROXY
    }
    # GVA's relative plugin API URL resolves under the /admin/ base path.
    # Only this public listing is proxied, without local account credentials.
    location = /admin/plugin/shopPlugin/getShopPluginList {
        limit_except GET { deny all; }
        proxy_pass https://plugin.gin-vue-admin.com/api/shopPlugin/getShopPluginList;
        proxy_http_version 1.1;
        proxy_pass_request_headers off;
        proxy_pass_request_body off;
        proxy_set_header Host plugin.gin-vue-admin.com;
        proxy_set_header Accept application/json;
        proxy_set_header Content-Length "";
        proxy_set_header Connection "";
        proxy_ssl_server_name on;
        proxy_ssl_verify on;
        proxy_ssl_verify_depth 5;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
        proxy_connect_timeout 5s;
        proxy_read_timeout 15s;
        add_header Cache-Control "no-cache";
    }
    location = /admin { return 308 /admin/; }
    location ^~ /admin/ {
        alias /www/sites/chat-demo-admin/index/;
        index index.html;
        add_header Cache-Control "no-cache";
    }
    location = /index.html { add_header Cache-Control "no-cache"; }
    location ^~ /static/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
    location = /LICENSE { default_type text/plain; }
    location ~ /\. { return 404; }
    location / { try_files $uri $uri/ /index.html; }
}
'''.replace('PROXY',proxy)
previous=CONF.read_bytes()
default=Path('/opt/1panel/apps/openresty/openresty/conf/default/00.default.conf')
previous_default=default.read_bytes()
default_content=re.sub(r'(listen\s+(?:\[::\]:)?443\s+ssl)\s+default_server',r'\1',previous_default.decode())
backup=ROOT/'backups'/('openresty-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.conf')
backup.write_bytes(previous)
(ROOT/'backups'/(backup.stem+'-default.conf')).write_bytes(previous_default)
default.write_text(default_content)
CONF.write_text(content)
try:
    subprocess.run(['docker','exec','1Panel-openresty-YrFQ','nginx','-t'],check=True)
except subprocess.CalledProcessError:
    CONF.write_bytes(previous)
    default.write_bytes(previous_default)
    raise
subprocess.run(['docker','exec','1Panel-openresty-YrFQ','nginx','-s','reload'],check=True)
print('HTTPS enabled; original HTTP browser storage remains reachable.')
