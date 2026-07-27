## Why

普通 `/chat` 与 `/agent` 都提供模型选择、流式消息和 Composer，但 `/chat` 仅保存浏览器内存状态，缺少持久会话、工具、Skill、MCP 和上下文管理。并列入口让用户难以理解差异，也重复维护同类对话 UI。用户已确认普通聊天应视为 Agent 的基础子场景。

## What Changes

- 将 `/agent` 设为用户端普通对话和多步任务的唯一主入口。
- 移除 `/chat` 的独立页面实现；访问旧 URL 时服务端兼容跳转到 `/agent`。
- 首页、全局导航和登录默认回跳统一指向 `/agent`。
- 在 Agent Composer 中保留“模型对比”入口；`/chat/compare` 暂时保持独立页面和现有并发隔离语义。
- 删除只服务于旧 `/chat` 页面的浏览器内存 Chat adapter。
- 保留 `POST /api/v1/chat/completions`、`@supermind/sdk` Chat 能力、Prompt 内部复用和管理员 Chat 日志，不改变网关协议。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-agent`: `/agent` 成为普通对话和工具型任务的统一入口，并提供模型对比子入口。
- `user-workspace-routing`: 用户端导航、登录回跳和旧 `/chat` 兼容行为。

## Impact

- `apps/web` 删除旧 Chat 页面代码，更新导航、首页 CTA、登录回跳和对比页返回入口。
- `spec/需求文档.md`、`spec/技术选型方案.md` 和 README 同步新的用户端信息架构。
- API、SDK、数据库和部署拓扑不变，无 migration。
- 回滚时可恢复旧 `/chat` 页面和导航；底层 Chat API 始终保留。
