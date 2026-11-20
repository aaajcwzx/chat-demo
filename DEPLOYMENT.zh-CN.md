# 本机部署

本项目生成静态页面，使用本机已有的 1Panel 静态网站和 OpenResty 托管。构建在受限的临时 Node.js 24 容器中执行，pnpm 固定为 12.6.0。Go 后端独立运行，OpenResty 将 `/api/` 转发到本机后端。

| 项目 | 位置 |
| --- | --- |
| 访问地址 | https://101.34.83.198/ |
| 1Panel 网站别名 | `chat-demo` |
| 源代码 | `/home/ubuntu/chat-demo` |
| 网站目录 | `/opt/1panel/www/sites/chat-demo/index` |
| 历次发布 | `/opt/1panel/www/sites/chat-demo/releases` |
| 网站配置 | `/opt/1panel/www/conf.d/chat-demo.conf` |
| 网站日志 | `/opt/1panel/www/sites/chat-demo/log` |

## 部署二开版本

本机当前使用 `custom` 二开分支，`main` 用于同步官方。开发、同步和冲突处理方法见 [二开维护说明](DEVELOPMENT.zh-CN.md)。

以 `ubuntu` 用户运行：

```sh
cd /home/ubuntu/chat-demo
git switch custom
./scripts/deploy-1panel.sh
```

部署要求处于 `custom` 分支且修改已经提交。脚本安装锁定依赖，执行类型检查、代码检查和生产构建，再切换到新的发布目录。首页 HTTP 校验失败时会自动恢复上一次发布。

也可以先运行 `./scripts/check-project.sh`，验证完成后用 `./scripts/deploy-1panel.sh --publish-only` 发布。脚本会核对提交版本和所有构建文件的摘要，防止发布过期或被修改的产物。

Docker 和 1Panel 服务已启用开机启动；OpenResty 的 `unless-stopped` 重启策略已同步保存到 1Panel 配置，服务器重启后会自动恢复网站服务。构建容器执行完成后退出。

首页使用 `Cache-Control: no-cache`；带内容哈希的静态文件缓存一年。`LICENSE` 随构建产物发布。

## 使用

未登录可继续在设置中配置本地渠道，记录保存在浏览器。登录账号后使用云端会话、附件和加密渠道密钥，管理后台位于 `/admin/`，详见 [Go 后端说明](BACKEND.zh-CN.md)。

IP 的 HTTPS 证书已启用并自动续期。原 HTTP 页面保留供迁移旧 IndexedDB 数据；完成迁移前不强制跳转或开启 HSTS。
