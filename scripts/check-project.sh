#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/chat-demo-env.sh"

CHAT_DEMO_CHECK_COMMIT="$(git -C "$CHAT_DEMO_SOURCE_DIR" rev-parse HEAD)"
CHAT_DEMO_CHECK_STATUS="$(git -C "$CHAT_DEMO_SOURCE_DIR" status --porcelain)"
chat_demo_run_node exec sh -c 'set -eu
  /cache/tools/node_modules/.bin/pnpm type
  /cache/tools/node_modules/.bin/pnpm lint
  /cache/tools/node_modules/.bin/pnpm build'

test -s "$CHAT_DEMO_SOURCE_DIR/dist/index.html"
test -f "$CHAT_DEMO_SOURCE_DIR/dist/LICENSE"
CHAT_DEMO_CHECK_DIGEST="$(chat_demo_dist_digest)"
python3 - "$CHAT_DEMO_SOURCE_DIR" "$CHAT_DEMO_CACHE_DIR" "$CHAT_DEMO_CHECK_COMMIT" "$CHAT_DEMO_CHECK_STATUS" "$CHAT_DEMO_CHECK_DIGEST" <<'PY'
import datetime, json, os, subprocess, sys
from pathlib import Path
root, cache, commit, status_before, digest = sys.argv[1:]
head_now = subprocess.check_output(['git', '-C', root, 'rev-parse', 'HEAD'], text=True).strip()
status_now = subprocess.check_output(['git', '-C', root, 'status', '--porcelain'], text=True).strip()
clean = not status_before and not status_now and commit == head_now
metadata = {'commit': commit, 'clean': clean, 'dist_digest': digest,
            'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
path = Path(cache) / 'build-info.json'
temporary = path.with_name('build-info-' + str(os.getpid()) + '.tmp')
temporary.write_text(json.dumps(metadata, indent=2) + '\n')
temporary.replace(path)
print('类型检查、代码检查和生产构建通过。' if clean else '检查通过；发布前需提交修改并重新检查。')
PY
