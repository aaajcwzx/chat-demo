#!/usr/bin/env python3
"""Back up only the Chat Demo database, encryption configuration and uploaded assets."""
import datetime, json, os, subprocess, tarfile
from pathlib import Path

ROOT=Path('/opt/chat-demo-backend')
DATABASE='chat_demo_gva'
os.umask(0o077)
target=ROOT/'backups'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
target.mkdir(mode=0o700)
command=['sudo','-n','docker','exec','1Panel-postgresql-HptZ','sh','-c',
         'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "${POSTGRES_USER:-postgres}" -d chat_demo_gva --format=custom --no-owner --no-acl']
with (target/'database.dump').open('wb') as output:
    result=subprocess.run(command,stdout=output,stderr=subprocess.PIPE)
if result.returncode: raise SystemExit('Project PostgreSQL backup failed; incomplete backup was not marked complete.')
with tarfile.open(target/'config-and-files.tar.gz','w:gz') as archive:
    archive.add(ROOT/'config',arcname='config')
    uploads=ROOT/'runtime'/'uploads'
    if uploads.exists(): archive.add(uploads,arcname='runtime/uploads')
(target/'backup.json').write_text(json.dumps({'database':DATABASE,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'includes':['database','JWT and encryption configuration','admin upload files']},indent=2)+'\n')
print('Project backup completed: '+str(target))
