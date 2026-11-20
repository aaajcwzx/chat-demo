# 生产服务器构建资源限制

- 提出日期：2026-11-20
- 状态：completed
- 用户明确约束：服务器 4 GB 内存，不允许并行运行占用大量内存的开发或构建任务。
- 事件：全量 swag init 与 Vite 构建并行，叠加线上 MySQL 等服务使内存达到约 90%，用户登录通道卡挂约 1 小时。
- 必须避免再次出现：两个 checkout 共用构建锁；Go、Node、浏览器回归严格串行；单任务硬上限 640 MiB；启动前保留至少 1 GiB 可用内存。
- 禁止在生产机执行全量 swag init。API 文档使用轻量方式维护，或在独立 CI / 开发机生成。
- 不通过新增并行任务、调高上限或忽略启动检查绕过限制。运行中的线上 MySQL、PostgreSQL、OpenResty 和用户终端均不为构建让路。
- 已验证：两个 checkout 竞争同一把锁均被拒绝；模拟低内存时拒绝启动，测试未额外占用服务器内存。
- 额外保护：监测构建期间可用内存，低于 1 GiB 时停止自身任务；中断时清理自身构建容器；拒绝残留构建容器或浏览器 scope 与新任务并行。
- 完整 Vue 管理端构建已移至独立 GitHub Actions；生产使用 `deploy-admin.sh --publish-only`，不承担完整编译。
- CI 验证：运行 https://github.com/aaajcwzx/chat-demo/actions/runs/44669922850 成功，对应提交 `c9df87915c80a54f423940e3e20847dcf8528acf`；下载 ZIP 的 SHA-256 与 GitHub artifact 元数据一致。
- 发布验证：CI 产物、`web/dist/index.html`、线上管理端入口文件一致；384 MiB、单 CPU 的串行生产浏览器验收通过，完成后无残留构建容器或浏览器 scope，服务器可用内存约 1.6 GiB。
- 浏览器 scope 使用 `CPUWeight=10` 设置相对优先级；scope 不支持 service 专用的 `Nice` 属性。
