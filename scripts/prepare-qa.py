#!/usr/bin/env python3
"""Create an isolated test database and credentials, never modify production rows."""
import base64, datetime, json, os, secrets, subprocess
from pathlib import Path
import yaml

ROOT=Path('/home/ubuntu/.cache/chat-demo/backend-qa')
ROOT.mkdir(mode=0o700,exist_ok=True)
os.umask(0o077)
metadata=ROOT/'qa.json'
if metadata.exists():
    raise SystemExit('An earlier QA environment exists; clean it before creating another.')
database='chat_demo_qa_'+secrets.token_hex(6)
runtime=ROOT/'runtime'
runtime.mkdir(mode=0o700)
config=yaml.safe_load(Path('/opt/chat-demo-backend/config/config.yaml').read_text())
config['pgsql']['db-name']=database
config['jwt']['signing-key']=secrets.token_urlsafe(64)
config['zap']['director']='/runtime/logs'
values={'database':database,'adminPassword':secrets.token_urlsafe(24),'chatPassword':secrets.token_urlsafe(24),'inviteCode':secrets.token_urlsafe(24),'encryptionKey':base64.b64encode(secrets.token_bytes(32)).decode()}
sql=f'CREATE DATABASE {database} OWNER chat_demo_gva; REVOKE ALL ON DATABASE {database} FROM PUBLIC;'
command=['sudo','-n','docker','exec','-i','1Panel-postgresql-HptZ','sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -v ON_ERROR_STOP=1']
result=subprocess.run(command,input=sql,text=True,capture_output=True)
if result.returncode: raise SystemExit('QA database preparation failed')
metadata.write_text(json.dumps(values,indent=2))
(ROOT/'config.yaml').write_text(yaml.safe_dump(config,allow_unicode=True,sort_keys=False))
(ROOT/'backend.env').write_text('\n'.join([
    'CHAT_PUBLIC_ORIGIN=https://101.34.83.198','CHAT_ALLOW_PRIVATE_CHANNELS=true',
    'CHAT_ENCRYPTION_KEY='+values['encryptionKey'],'CHAT_INVITE_CODE='+values['inviteCode'],
    'CHAT_BOOTSTRAP_ADMIN_PASSWORD='+values['adminPassword'],'CHAT_BOOTSTRAP_USER_PASSWORD='+values['chatPassword'],
    'GIN_MODE=release','GOMAXPROCS=2','GOMEMLIMIT=256MiB',
])+'\n')
print('Isolated QA PostgreSQL database and private credentials prepared.')
