#!/usr/bin/env python3
"""Provision only this project's database and private runtime configuration."""
import base64, json, os, secrets, subprocess, sys
from pathlib import Path
import yaml

ROOT=Path('/opt/chat-demo-backend')
DB_CONTAINER='1Panel-postgresql-HptZ'
ROLE='chat_demo_gva'
DATABASE='chat_demo_gva'
SOURCE=Path(__file__).resolve().parents[1]

def psql(sql):
    command=['sudo','-n','docker','exec','-i',DB_CONTAINER,'sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -v ON_ERROR_STOP=1 -At']
    result=subprocess.run(command,input=sql,text=True,capture_output=True)
    if result.returncode:
        raise RuntimeError('PostgreSQL provisioning failed; no credentials were printed')
    return result.stdout.strip()

subprocess.run(['sudo','-n','install','-d','-m','700','-o',str(os.getuid()),'-g',str(os.getgid()),str(ROOT),str(ROOT/'config'),str(ROOT/'backups'),str(ROOT/'runtime')],check=True)
private=ROOT/'config'/'credentials.json'
if private.exists():
    values=json.loads(private.read_text())
else:
    if psql(f"SELECT count(*) FROM pg_roles WHERE rolname='{ROLE}';")!='0' or psql(f"SELECT count(*) FROM pg_database WHERE datname='{DATABASE}';")!='0':
        raise RuntimeError('The project database or role already exists without its credential file; inspect before continuing')
    values={'databasePassword':secrets.token_urlsafe(32),'jwtSigningKey':secrets.token_urlsafe(64),'encryptionKey':base64.b64encode(secrets.token_bytes(32)).decode(),'adminPassword':secrets.token_urlsafe(24),'chatPassword':secrets.token_urlsafe(24),'inviteCode':secrets.token_urlsafe(24)}
    fd=os.open(private,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w') as stream:json.dump(values,stream,indent=2)

if psql(f"SELECT count(*) FROM pg_roles WHERE rolname='{ROLE}';")=='0':
    psql(f"CREATE ROLE {ROLE} LOGIN PASSWORD '{values['databasePassword']}';")
if psql(f"SELECT count(*) FROM pg_database WHERE datname='{DATABASE}';")=='0':
    psql(f"CREATE DATABASE {DATABASE} OWNER {ROLE};")
psql(f"REVOKE ALL ON DATABASE {DATABASE} FROM PUBLIC; GRANT CONNECT ON DATABASE {DATABASE} TO {ROLE};")

config=yaml.safe_load((SOURCE/'server'/'config.yaml').read_text())
config['jwt'].update({'signing-key':values['jwtSigningKey'],'expires-time':'30d','buffer-time':'1d','issuer':'chat-demo'})
config['system'].update({'env':'public','addr':8092,'db-type':'pgsql','use-redis':False,'use-multipoint':False,'router-prefix':'/api'})
config['pgsql'].update({'path':DB_CONTAINER,'port':'5432','db-name':DATABASE,'username':ROLE,'password':values['databasePassword'],'max-idle-conns':2,'max-open-conns':10,'log-mode':'silent','config':'sslmode=disable TimeZone=UTC'})
config['zap'].update({'level':'warn','director':'/runtime/logs','log-in-console':True,'retention-day':7})
config['local'].update({'path':'uploads/file','store-path':'uploads/file'})
config['captcha']['open-captcha']=5

def write_private(path,text):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as stream:stream.write(text)
write_private(ROOT/'config'/'config.yaml',yaml.safe_dump(config,allow_unicode=True,sort_keys=False))
write_private(ROOT/'config'/'backend.env','\n'.join([
    'CHAT_PUBLIC_ORIGIN=https://101.34.83.198',
    'CHAT_ENCRYPTION_KEY='+values['encryptionKey'],
    'CHAT_INVITE_CODE='+values['inviteCode'],
    'CHAT_BOOTSTRAP_ADMIN_PASSWORD='+values['adminPassword'],
    'CHAT_BOOTSTRAP_USER_PASSWORD='+values['chatPassword'],
    'CHAT_ALLOW_PRIVATE_CHANNELS=false',
])+'\n')
write_private(ROOT/'config'/'bootstrap-accounts.txt','管理后台与聊天管理员\n用户名：admin\n密码：'+values['adminPassword']+'\n\n普通聊天账号\n用户名：chat\n密码：'+values['chatPassword']+'\n\n注册邀请码：'+values['inviteCode']+'\n')
print('Dedicated PostgreSQL database and private configuration prepared. Credentials: '+str(ROOT/'config'/'bootstrap-accounts.txt'))
