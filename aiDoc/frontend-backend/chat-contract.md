# Chat Demo 对接契约

后端基于 v2.9.2 Apache-2.0 版本，用户端仍为独立的 React chat-demo。

- 路由前缀 `/api/chat`，JSON 使用 `{code,data,msg}`；账号 Cookie 为 `chat-session`，HttpOnly、SameSite=Lax，仅 HTTPS 公网发送。
- 注册使用管理员提供的邀请码，注册用户固定为聊天用户角色1111；管理后台复用 GVA 的账号、角色、菜单与接口权限。
- `GET /status` 为不含账号信息的后端能力接口；`POST /auth/login`、`POST /auth/register`、`GET /auth/me`、`POST /auth/logout`、`POST /auth/password` 管理会话。
- `X-Chat-Owner` 是客户端发起操作时的账号ID，后端必须与认证身份一致，防止切换账号时的异步请求串入另一个账号。
- `GET /sessions` 返回 `{list,total,page,pageSize}`；`GET /sessions/:id` 返回 `{session,revision}`，session保持现有消息及分支JSON结构。
- `PUT /sessions/:id` 接收 session JSON或 multipart 的 `session` 字段；`If-Match` 为上次读取/保存的revision，新记录为0；冲突返回409，不覆盖另一设备的记录。
- 文件上传使用 `fileMetadata` JSON数组和 `file:<id>` 文件字段；原件仅能由所属账号通过 `GET /files/:id` 下载，响应安全地使用application/octet-stream。
- `POST /history/import` 接收multipart `sessions` JSON数组与文件；默认仅添加新会话，`replace=true` 在一个事务中替换当前账号的全部历史与文件。
- 渠道元数据包含 `hasKey`、`managed=true`、`ownerId`，不返回密钥或密文。PUT中的apiKey未提供/留空保留原密钥，clearKey明确清除。
- `POST /channels/models` 测试保存的或临时渠道配置；`GET /channels` 同时返回渠道的模型缓存。
- `/proxy/:id?path=<relativePath>` 返回模型服务原始SSE、JSON或二进制协议，不套JSON信封；浏览器不再携带API Key，后端从所属渠道解密并添加鉴权。该端点仅允许现有对话、模型列表、附件、ASR/TTS服务接口。
- 本地数据不会在未登录时上传，迁移需要界面上的明确确认；登录/退出/切换账号须先停止生成并清理内存视图，保留原本本地数据。
