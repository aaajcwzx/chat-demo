# 本机开发与部署约束

本生产服务器只有 4 GB 内存，同时运行 MySQL、PostgreSQL、1Panel 和登录通道。

- 重构建、依赖安装、开发预览和浏览器回归必须严格串行，不得并行启动 `swag init`、Go 编译、Vite/Rspack 构建或多套浏览器测试。
- 使用 `scripts/resource-guard.sh` 与后端 checkout 共用的锁；单任务硬上限 640 MiB，启动前为线上服务和登录保留至少 1 GiB 可用内存。
- Node 任务使用 `scripts/chat-demo-env.sh` 的受限容器。浏览器回归使用后端 `scripts/run-browser-test.sh` 的受限 scope。
- 不在生产机运行全量 `swag init`。不要绕过保护脚本，内存不足时不得直接提高上限或并行补跑。
- 发布仍需提交、检查、推送，再运行发布脚本。保存的密码、渠道密钥和私有配置不输出、不提交到 Git。
