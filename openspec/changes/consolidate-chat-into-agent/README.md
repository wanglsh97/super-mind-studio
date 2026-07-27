# consolidate-chat-into-agent

将用户端主工作台收敛到根路径 `/`：登录后直接进入 Agent，普通 Chat 保留兼容跳转，`/agent`、Image、Prompt 页面及其专属入口移除；底层 Gateway API、SDK 和多模型对比保持可用。
