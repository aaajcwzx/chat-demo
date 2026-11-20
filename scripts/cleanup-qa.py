#!/usr/bin/env python3
"""Remove only the isolated database and temporary containers created for these tests."""
import json, re, subprocess
from pathlib import Path

ROOT=Path('/home/ubuntu/.cache/chat-demo/backend-qa')
metadata=ROOT/'qa.json'
if not metadata.exists(): raise SystemExit('No QA database metadata to clean.')
database=json.loads(metadata.read_text())['database']
if not re.fullmatch(r'chat_demo_qa_[a-f0-9]{12}',database): raise SystemExit('Refusing to clean an unrecognized database.')
for container in ['chat-demo-preview-qa','chat-demo-backend-qa']:
    exists=subprocess.run(['sudo','-n','docker','inspect','--format','{{.Id}}',container],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if exists.returncode==0:
        subprocess.run(['sudo','-n','docker','stop',container],stdout=subprocess.DEVNULL,check=True)
        subprocess.run(['sudo','-n','docker','rm',container],stdout=subprocess.DEVNULL,check=True)
command=['sudo','-n','docker','exec','-i','1Panel-postgresql-HptZ','sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -v ON_ERROR_STOP=1']
result=subprocess.run(command,input=f'DROP DATABASE {database} WITH (FORCE);',text=True,capture_output=True)
if result.returncode: raise SystemExit('QA database cleanup failed.')
metadata.rename(ROOT/'qa-completed.json')
print('Temporary QA containers and isolated database removed; production resources retained.')
