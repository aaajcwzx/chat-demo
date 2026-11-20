# DeepTalk 后端与部署

产品名称为 **DeepTalk**，由用户于 2026-11-20 确定；前后端项目文档及后续二开统一使用此名称。

用户端：https://101.34.83.198/；管理端：https://101.34.83.198/admin/。
后端采用 Gin-Vue-Admin 官方 `v2.9.2`（实际 LICENSE 为 Apache-2.0），用户端保留 React chat-demo。
模板的版权、许可、品牌与后台功能均保留。`v2.9.2-stable` 使用不同许可，未采用。

## 使用

初始管理员 `admin`、普通聊天用户 `chat` 和注册邀请码保存在服务器私有文件
`/opt/chat-demo-backend/config/bootstrap-accounts.txt`，没有写入 Git。登录后可以修改密码。
管理后台和聊天页面使用同一用户表、独立的登录会话。新注册账号固定为聊天用户，无法自行获得管理员权限。

聊天页面右上角可登录、注册、改密码、刷新记录和打开迁移入口。未登录时仍使用浏览器本地数据；
登录后会话与附件原件保存在账号下的 PostgreSQL 数据中。每 15 秒及回到页面时检查其他设备的更新。
并发修改使用版本校验，旧版本收到 409 后需要先导出备份，再重新加载服务器版本。

原 HTTP 页面 `http://101.34.83.198/` 保留，用于读取之前保存在该来源的 IndexedDB。
在 HTTPS 页面选择“导入原 HTTP 页面的记录”，或从 HTTP 页面打开安全登录：
先在原页面允许传送，再在安全页面确认导入账号。原数据不删除，迁移默认添加缺少的会话。
渠道迁移可单独取消；云端已有的官方密钥保留，冲突的自定义渠道复制为独立渠道。

云端渠道密钥使用 AES-GCM 加密，不向浏览器返回明文或密文。浏览器仅收到 `hasKey`，
保存时留空保留原密钥，可输入新值替换。模型、附件和语音请求由后端转发。
生产默认拒绝连接服务器内网的渠道。当前附件单文件上限 20 MB，账号附件总上限 250 MB，单会话 JSON 上限 8 MB。

用户端 ZIP 沿用官方格式：会话与图片原件可导出，其他附件保留元数据。
服务器数据库备份包含全部聊天附件原件和加密渠道配置。

## 目录与分支

| 用途 | 路径或分支 |
| --- | --- |
| React 用户端源码 | `/home/ubuntu/chat-demo`，`custom` |
| Go 与 Vue 管理端源码 | `/home/ubuntu/chat-demo-backend`，`backend-custom` |
| GVA 官方基线 | `backend-main`，上游 `flipped-aurora/gin-vue-admin` |
| 二开远端 | `aaajcwzx/chat-demo` 的 `backend-main` / `backend-custom` 分支 |
| 后端发布版本、配置与数据 | `/opt/chat-demo-backend` |
| 用户端静态发布 | `/opt/1panel/www/sites/chat-demo` |
| 管理端静态发布 | `/opt/1panel/www/sites/chat-demo-admin` |
| OpenResty 站点配置 | `/opt/1panel/www/conf.d/chat-demo.conf` |

后端只绑定 `127.0.0.1:8092`，由 1Panel/OpenResty 在 HTTPS 下代理 `/api/`。
Docker Compose 位于 `deploy/chat-demo.compose.yaml`，使用现有 `1panel-network` 与 PostgreSQL 容器，
数据库和数据库角色均为本项目专用的 `chat_demo_gva`。应用以非 root 用户运行，根文件系统只读。
后端源代码与 React 源代码是两个独立 checkout，使用同一个 fork 中的不同分支保留各自上游历史。

## 二开与发布

聊天业务全部位于 `server/plugin/chat/`，按照 Router → API → Service → Model 分层。
前后端契约见 `aiDoc/frontend-backend/chat-contract.md`；变更需求同步更新 `aiDoc/memory/business/`。
React 的账号、网络、迁移与云端存储封装位于 `src/services/backend/`；
现有会话格式保持不变，存储适配入口为 `src/services/chat/db.ts`。

后端和管理端使用固定 Docker 构建镜像，不依赖服务器安装全局 Go 或新版 Node：

本机只有 4 GB 内存。所有构建、开发预览与浏览器回归通过同一资源锁严格串行，
单任务硬上限 640 MiB，启动前保留至少 1 GiB 可用内存；运行中余量不足时停止自身任务。
不要并行手动启动编译器，也不要在生产机执行全量 `swag init`；完整文档生成移到独立 CI / 开发机。
本项目新增接口的文档由 `./scripts/update-chat-swagger.py` 轻量更新；修改接口时同步 API 注释与该脚本。
完整管理端构建使用 `.github/workflows/chat-backend-build.yml` 的独立 CI，Go 与管理端仍顺序构建。
服务器受限构建超过 120 秒会停止；不要为构建提高资源上限。当前部署可发布已经验证的静态产物。

完整管理端的生产发布流程：

1. 提交并推送 `backend-custom`，等待 GitHub Actions 的 Go 测试、后端编译与管理端构建成功。
2. 下载对应提交的 `chat-backend-<完整提交号>` 产物，核对 GitHub artifact 的 SHA-256 摘要及 `commit.txt`。
3. 将产物中的 `admin/` 放到 `web/dist/`，保留该产物的提交号与校验记录，再执行 `./scripts/deploy-admin.sh --publish-only`。
4. 通过 `./scripts/run-browser-test.sh tests/production-smoke.cjs` 验收线上登录与接口。

生产服务器不承担完整管理端编译。下面的受限 Go 构建流程适用于只修改后端的情况：

```bash
cd /home/ubuntu/chat-demo-backend
./scripts/build-backend.sh
git add .
git commit -m "feat: describe the change"
git push origin backend-custom
./scripts/deploy-backend.sh
```

React 按已有发布流程提交、检查、推送和部署：

```bash
cd /home/ubuntu/chat-demo
git add .
git commit -m "feat: describe the change"
./scripts/check-project.sh
git push origin custom
./scripts/deploy-1panel.sh --publish-only
```

管理端使用 `/admin/` 资源基路径与 hash 路由；依赖由 `web/pnpm-lock.yaml` 固定。
仪表盘的公开插件列表由 OpenResty 精确代理 `/admin/plugin/shopPlugin/getShopPluginList`；
只接受 GET / HEAD，校验上游 HTTPS 证书，且不转发本地 Cookie、登录令牌或用户信息。
管理端安装固定使用 pnpm 12.6.0，降低安装并发；编译直接运行 Vite，不叠加包管理器父进程。
已下架的 `vite-auto-import-svg` 由项目内 `web/vitePlugin/localSvg/` 替代，保持原 SVG 图标 ID 与资产。
旧 Vue CLI 构建依赖与全局增大内存的脚本已移除，当前构建只使用 Vite；依赖安装和编译分阶段运行。
更新 GVA 时先 fetch，在 `backend-main` 审核目标 tag 和实际 LICENSE 后更新基线，再将基线 merge 到 `backend-custom`。
不要对二开分支 reset 或用上游文件直接覆盖插件与部署配置。React 继续使用原有 upstream 同步脚本。

## 验证

`./scripts/build-backend.sh` 执行 Go 测试与编译。完整联调使用独立数据库：

```bash
./scripts/start-qa.sh
node tests/preview-and-gateway.cjs
# 在另一个终端运行
node tests/backend-integration.cjs
./scripts/run-browser-test.sh tests/chat-browser.cjs
./scripts/run-browser-test.sh tests/browser-origin-migration.cjs
```

浏览器测试需要 Playwright / Chromium，位置可由 `CHAT_PLAYWRIGHT` 指定。
测试模型服务只绑定 Docker bridge，生产应用仍拒绝内网渠道；测试不调用付费模型。
测试数据库名称经过严格校验，清理脚本只删除本次 QA 资源。
验证结束后运行 `./scripts/cleanup-qa.py`。

## 运维

`chat-demo-backup.timer` 每天运行 `backup.py`，备份保存在 `/opt/chat-demo-backend/backups/`。
备份包含数据库、自身配置和管理端上传文件。配置中包含密钥解密所必需的随机加密密钥，需与数据库备份共同保管。
备份文件与账号文件均限制访问权限。

```bash
./scripts/backup.py
sudo systemctl list-timers chat-demo-backup.timer chat-demo-tls.timer
sudo docker logs --tail 100 chat-demo-backend
```

恢复操作会替换本项目数据库与配置，并暂时停止后端；只在明确需要恢复时执行：

```bash
./scripts/restore-backup.py /opt/chat-demo-backend/backups/<UTC时间目录> --confirm
```

IP 证书使用 Let’s Encrypt 的 shortlived profile，`chat-demo-tls.timer` 每天检查两次并自动更新 OpenResty 证书。
不要开启强制 HTTP 跳转或 HSTS，直到旧浏览器的记录迁移完成。
新增域名时同时更新 `CHAT_PUBLIC_ORIGIN`、证书和 OpenResty 站点配置，并明确原记录的 HTTP 来源。
