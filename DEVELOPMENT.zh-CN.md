# 二开与官方同步

本机代码位于 `/home/ubuntu/chat-demo`，已创建并切换到 `custom` 分支。二开修改、维护脚本和本说明保存在该分支。

服务器只有 4 GB 内存。前端、Go 后端和管理端构建，以及浏览器回归共用资源锁，严格串行。
单任务硬上限 640 MiB，为线上服务与登录通道保留至少 1 GiB 内存余量。
开发预览占用同一锁，构建其他项目前需先结束预览；不要绕过脚本并行编译或在本机运行全量 `swag init`。

| 名称 | 用途 |
| --- | --- |
| `upstream` | 官方仓库 `https://github.com/deepseek-ai/chat-demo.git` |
| `origin` | 你的 fork `https://github.com/aaajcwzx/chat-demo.git` |
| `main` | 官方源码同步分支 |
| `custom` | 二开和生产部署分支 |

## 开发预览

在本机 `custom` 分支修改 `src/`、样式或配置，预览会自动更新：

```sh
cd /home/ubuntu/chat-demo
git switch custom
./scripts/dev.sh
```

预览地址为 `http://127.0.0.1:8091/`，按 Ctrl+C 停止。脚本使用独立的 Node.js 24 和 pnpm 12.6.0 容器，首次运行会安装锁定依赖。构建工具版本集中在 `scripts/chat-demo-env.sh`。

从自己的电脑访问服务器上的开发预览，可在电脑终端建立 SSH 转发：

```sh
ssh -N -L 8091:127.0.0.1:8091 ubuntu@101.34.83.198
```

然后在电脑浏览器打开 `http://127.0.0.1:8091/`。预览端口与 1Panel 的 8090 端口分开。

## 提交和发布二开

按功能分别提交。比如修改了前端和构建配置：

```sh
git add src rspack.config.ts
git commit -m "feat: add custom chat features"
```

每一步成功后再继续：

```sh
./scripts/check-project.sh &&
git push origin custom &&
./scripts/deploy-1panel.sh --publish-only
```

检查脚本运行类型检查、代码检查和生产构建。开发中也可以随时检查未提交的修改；发布时要求 `custom` 已提交，并且构建产物对应当前提交。

部署路径、日志和回滚行为见 [部署说明](DEPLOYMENT.zh-CN.md)。

## 合并官方更新

先提交当前二开，然后执行：

```sh
./scripts/sync-upstream.sh &&
./scripts/check-project.sh &&
git push origin main custom
```

脚本先读取 fork 的最新分支，在可以快进时更新本机 `custom`，再快进更新 `main` 为官方版本，并把官方更新合并到 `custom`。二开提交保留在 Git 历史中；同步后运行部署脚本才会发布到 1Panel。

如果远端 `custom` 与本机各自有新提交，或 `main` 存在与官方分叉的提交，脚本会停止。先查看 `git status` 和 `git log --graph --oneline --all`，合并需要保留的提交后再继续。

如果官方与二开修改了同一处代码，Git 会列出冲突文件。编辑文件保留需要的内容，用 `git add 文件路径` 标记已解决，再运行 `git commit` 完成合并。随后重新检查并推送。用 `git merge --abort` 可以取消本次未完成的合并；部署脚本会拦截未提交或未完成的合并。

二开尽量使用独立组件、配置和样式，并拆成小提交，方便以后判断哪些改动需要保留。

## GitHub 写入认证

本机使用此仓库专用的 SSH 部署密钥推送到 fork。公钥文件：

```text
/home/ubuntu/.ssh/chat-demo_github_ed25519.pub
```

在 [仓库 Settings → Deploy keys](https://github.com/aaajcwzx/chat-demo/settings/keys) 添加该公钥，勾选 `Allow write access`。`origin` 通过 HTTPS 读取、SSH 443 端口推送；SSH 配置和密钥位于本机，不纳入仓库。

本仓库的 Git 提交身份已配置为 `aaajcwzx` 和 GitHub 隐私邮箱 `51935118+aaajcwzx@users.noreply.github.com`。如需其他署名，可在本仓库使用 `git config user.name` 和 `git config user.email` 设置。
