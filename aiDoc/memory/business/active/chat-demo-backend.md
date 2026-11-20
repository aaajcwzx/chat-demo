# Chat Demo Go 后端与服务器存储

- 提出日期：2026-11-19
- 当前状态：active
- 用户意图：使用成熟 Go 后台模板与 PostgreSQL 为现有 React AI 对话项目提供账号、服务器端聊天存储和多设备同步。
- 基线：Gin-Vue-Admin v2.9.2，实际 LICENSE 为 Apache-2.0。v2.9.2-stable 标签实际使用 BSL，未采用。
- 后端目录：/home/ubuntu/chat-demo-backend，独立编译部署；前端：/home/ubuntu/chat-demo。
- 复用现有 1Panel PostgreSQL，使用项目专用数据库和角色；保留模板版权、许可及管理端品牌。
- 新业务使用 Router → API → Service → Model 分层和统一 JSON 响应；文件与模型 SSE 透传使用其原始协议。
- 用户数据以登录账号隔离，未登录的浏览器数据保持本地；迁移本地历史与渠道需要用户在界面确认。
- 渠道密钥加密存储、仅可更换不回显，通过后端转发模型请求。
- 当前域名尚未提供，默认沿用服务器 IP 并配置 HTTPS。
- 待办：后端模块、模板初始化、账号界面、历史存储接入、迁移、HTTPS、管理端部署、回归测试、推送与文档。
