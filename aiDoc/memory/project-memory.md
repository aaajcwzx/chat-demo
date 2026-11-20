# 项目记忆总览

## 当前记忆结构

- `long-term/`: 长期稳定偏好与协作模式
- `business/`: 每次业务需求的独立记忆

## 当前关键决策

### 2026-11-20

- 用户确认产品名称为 **DeepTalk**；后续产品文案与二开文档统一使用该名称。
- 前台中英文侧边栏和浏览器标签页标题已统一为 **DeepTalk**，并完成生产发布与验收。
- 聊天前台基于 DeepSeek `chat-demo`，后端及管理端基于 Gin-Vue-Admin；沿用现有源码目录、分支及部署配置。
- 命名决定见 [DeepTalk 产品命名](business/done/deeptalk-product-name.md)。

### 2026-04-01

- `AGENT.MD` 是项目级 AI 规则的唯一真源
- `aiDoc/` 是结构化 AI 文档层
- `aiDoc/examples/` 是讲解型示例层
- `aiDoc/memory/` 正式拆分为“长期记忆”和“业务记忆”
- 用户提出业务需求时，AI 必须同步更新 `memory/business/`

## 读取建议

1. 先看 `long-term/` 中与用户偏好、协作方式相关的内容
2. 再看 `business/` 中当前活跃或已完成的业务需求记录
3. 如果某条业务需求已经演变为稳定规则，再回写到 `long-term/` 或对应模块文档
