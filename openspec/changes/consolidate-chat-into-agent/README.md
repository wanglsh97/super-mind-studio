# consolidate-chat-into-agent

将用户端主工作台收敛到根路径 `/`：登录后直接进入 Agent，`/chat` 仅保留兼容跳转，`/agent`、`/chat/compare`、Image、Prompt 页面及其专属入口移除；公开 Chat API/SDK 同步退役，内部模型网关与 Image/Prompt API/SDK 保留。
