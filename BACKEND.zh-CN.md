# DeepTalk：Go 后端与云端账号

DeepTalk 的聊天前台基于 DeepSeek 官方 React `chat-demo`，连接独立的 Gin-Vue-Admin Go 后端和 PostgreSQL。未登录继续使用本地模式，
登录后会话、消息分支和附件原件保存在账号下，可以在不同设备查看；已配置的云端渠道密钥不回显。

- 用户端：`https://101.34.83.198/`
- 管理端：`https://101.34.83.198/admin/`
- Go / Vue 管理端源码：`/home/ubuntu/chat-demo-backend`，fork 的 `backend-custom` 分支。
- 初始账号与邀请码：服务器私有文件 `/opt/chat-demo-backend/config/bootstrap-accounts.txt`。

在右上角登录账号。旧 HTTP 页面的本地记录可通过“账号与同步 → 导入原 HTTP 页面的记录”迁移：
在原页面允许传送，再在 HTTPS 页面确认保存到当前账号。迁移不会删除原浏览器数据。
同一 HTTPS 来源的旧本地数据使用“导入本页本地记录”。

原 ZIP 导入会覆盖当前使用的数据来源，登录后的覆盖和删除影响该账号的其他设备。
并发保存遇到版本冲突时先导出备份，再刷新页面读取最新记录。用户端 ZIP 保持官方格式，非图片附件只有元数据；
服务器数据库备份包含所有附件原件。

| 代码入口 | 职责 |
| --- | --- |
| `src/services/backend/state.ts`、`account.ts` | 账号状态与 HttpOnly Cookie 登录 |
| `src/services/backend/client.ts` | API 信封、错误处理和发起请求时的账号检查 |
| `src/services/backend/storage.ts` | 会话、附件、版本校验和串行保存 |
| `src/services/backend/migration.ts` | 明确确认后的本地导入和跨协议传送 |
| `src/services/chat/db.ts` | 本地 / 云端存储适配，保留原 IndexedDB |
| `src/services/chat/store.ts` | 切换来源、清理旧请求、云端刷新和失败保存恢复 |
| `src/services/channels.ts` | 本地渠道与云端渠道元数据 |
| `src/services/api/http.ts` | 云端模型代理，浏览器不携带已保存密钥 |
| `src/components/account/` | 登录、账号菜单与迁移确认界面 |

新增功能保持官方会话 JSON 格式，避免将数据库或鉴权细节散落到展示组件中。
修改接口时同步后端 `aiDoc/frontend-backend/chat-contract.md`。
完整服务器部署、备份、恢复和后端同步说明见后端仓库 `docs/CHAT_DEMO.md`。
