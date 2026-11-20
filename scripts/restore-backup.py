#!/usr/bin/env python3
"""Explicitly restore one completed project backup, leaving other databases untouched."""
import argparse, json, os, shutil, subprocess, tarfile
from pathlib import Path

ROOT=Path('/opt/chat-demo-backend')
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('backup',type=Path)
parser.add_argument('--confirm',action='store_true',help='Replace this project database and private configuration')
args=parser.parse_args()
backup=args.backup.resolve()
if not args.confirm: raise SystemExit('恢复会替换本项目数据；确认后请显式加上 --confirm。')
if not backup.is_relative_to((ROOT/'backups').resolve()): raise SystemExit('Backup must be in this project backup directory.')
if json.loads((backup/'backup.json').read_text()).get('database')!='chat_demo_gva': raise SystemExit('This is not a completed Chat Demo backup.')
if not (backup/'database.dump').is_file(): raise SystemExit('Database archive is missing.')
with tarfile.open(backup/'config-and-files.tar.gz') as archive:
    members=archive.getmembers()
    for member in members:
        target=(ROOT/member.name).resolve()
        allowed=member.name=='config' or member.name.startswith('config/') or member.name=='runtime/uploads' or member.name.startswith('runtime/uploads/')
        if not allowed or not target.is_relative_to(ROOT) or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe path or link in backup archive.')
    subprocess.run(['sudo','-n','docker','stop','chat-demo-backend'],check=True,stdout=subprocess.DEVNULL)
    uploads=ROOT/'runtime/uploads'
    if uploads.exists(): shutil.rmtree(uploads)
    for member in members:
        target=ROOT/member.name
        if member.isdir(): target.mkdir(parents=True,exist_ok=True)
        else:
            target.parent.mkdir(parents=True,exist_ok=True)
            with archive.extractfile(member) as source, target.open('wb') as output: shutil.copyfileobj(source,output)
            target.chmod(0o600)
        if os.geteuid()==0: os.chown(target,1000,1000)
values=json.loads((ROOT/'config/credentials.json').read_text())
password=values['databasePassword'].replace("'","''")
command=['sudo','-n','docker','exec','-i','1Panel-postgresql-HptZ','sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -v ON_ERROR_STOP=1']
result=subprocess.run(command,input="ALTER ROLE chat_demo_gva LOGIN PASSWORD '"+password+"';",text=True,capture_output=True)
if result.returncode: raise SystemExit('Dedicated database role restore failed; credentials were not printed.')
command=['sudo','-n','docker','exec','-i','1Panel-postgresql-HptZ','sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U "${POSTGRES_USER:-postgres}" -d chat_demo_gva --clean --if-exists --no-owner --no-acl --role=chat_demo_gva --exit-on-error']
with (backup/'database.dump').open('rb') as source: result=subprocess.run(command,stdin=source,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if result.returncode: raise SystemExit('Project database restore failed; backend remains stopped for inspection.')
subprocess.run(['sudo','-n','docker','start','chat-demo-backend'],check=True,stdout=subprocess.DEVNULL)
print('Chat Demo database, encryption configuration and uploaded assets restored.')
