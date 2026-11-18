#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/chat-demo-env.sh"
chat_demo_require_custom_clean

git -C "$CHAT_DEMO_SOURCE_DIR" fetch origin
if git -C "$CHAT_DEMO_SOURCE_DIR" show-ref --verify --quiet refs/remotes/origin/custom; then
  git -C "$CHAT_DEMO_SOURCE_DIR" merge --ff-only origin/custom
fi

# Fetch refuses to overwrite a divergent main branch or one checked out elsewhere.
git -C "$CHAT_DEMO_SOURCE_DIR" fetch upstream main:main
if ! git -C "$CHAT_DEMO_SOURCE_DIR" merge --no-edit main; then
  printf '\n官方更新合并未完成。请用 git status 检查；解决冲突后 git add 指定文件并 git commit，或用 git merge --abort 取消合并。\n' >&2
  exit 1
fi
printf '\n官方更新已合并到 custom。运行 ./scripts/check-project.sh 验证，随后 git push origin main custom 保存到 fork。\n'
