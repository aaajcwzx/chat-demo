#!/usr/bin/env bash
# Shared across both project checkouts; all builds and browser tests use this lock.
CHAT_BUILD_LOCK_FILE=/home/ubuntu/.cache/chat-demo/production-build.lock
CHAT_BUILD_LIMIT_MIB=640
CHAT_BUILD_RESERVE_MIB=1024
CHAT_BUILD_CPU="$(awk '/^Cpus_allowed_list:/ { print $2 }' /proc/self/status | cut -d, -f1 | cut -d- -f1)"

chat_build_guard() {
  local chat_requested_mib="${1:-640}"
  if [[ ! "$chat_requested_mib" =~ ^[0-9]+$ ]] || (( chat_requested_mib < 64 || chat_requested_mib > 640 )); then
    printf '重任务预算只能在 64–640 MiB 范围内，不能提高生产机上限。\n' >&2
    return 1
  fi
  CHAT_BUILD_LIMIT_MIB="$chat_requested_mib"
  install -d "$(dirname -- "$CHAT_BUILD_LOCK_FILE")"
  exec {CHAT_BUILD_LOCK_FD}>"$CHAT_BUILD_LOCK_FILE"
  if ! flock -n "$CHAT_BUILD_LOCK_FD"; then
    printf '已有构建、开发预览或浏览器测试在运行；资源规则禁止并行重任务。\n' >&2
    return 1
  fi
  local chat_orphan_builds
  chat_orphan_builds="$(sudo -n docker ps -q --filter label=com.chat-demo.build=true)"
  if [[ -n "$chat_orphan_builds" ]]; then
    printf '仍有之前的构建容器运行，拒绝启动新的重任务。\n' >&2
    flock -u "$CHAT_BUILD_LOCK_FD"
    return 1
  fi
  if [[ -n "$(systemctl list-units --type=scope --state=running --no-legend 'chat-demo-browser-*.scope')" ]]; then
    printf '仍有浏览器回归 scope 运行，拒绝启动新的重任务。\n' >&2
    flock -u "$CHAT_BUILD_LOCK_FD"
    return 1
  fi
  local chat_available_kib chat_required_kib
  chat_available_kib="$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)"
  chat_required_kib=$(( (CHAT_BUILD_LIMIT_MIB + CHAT_BUILD_RESERVE_MIB) * 1024 ))
  if [[ -z "$chat_available_kib" ]] || (( chat_available_kib < chat_required_kib )); then
    printf '内存余量不足：当前可用 %s MiB；重任务启动前需至少 %s MiB，保留 1 GiB 给线上服务与登录通道。\n' \
      "$(( ${chat_available_kib:-0} / 1024 ))" "$(( chat_required_kib / 1024 ))" >&2
    flock -u "$CHAT_BUILD_LOCK_FD"
    return 1
  fi
  printf '资源检查通过：任务硬上限 %s MiB，严格串行，保留 %s MiB。\n' "$CHAT_BUILD_LIMIT_MIB" "$CHAT_BUILD_RESERVE_MIB"
}

chat_build_watch_memory() {
  local chat_job_name="$1" chat_job_kind="${2:-docker}" chat_watch_available
  while true; do
    chat_watch_available="$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)"
    if [[ -n "$chat_watch_available" ]] && (( chat_watch_available < CHAT_BUILD_RESERVE_MIB * 1024 )); then
      printf '线上内存余量低于 1 GiB，停止本次构建或测试，保护线上服务与登录通道。\n' >&2
      if [[ "$chat_job_kind" == scope ]]; then
        sudo -n systemctl stop "$chat_job_name" >/dev/null 2>&1 || true
      else
        sudo -n docker stop --time 5 "$chat_job_name" >/dev/null 2>&1 || true
      fi
    fi
    sleep 2
  done
}
