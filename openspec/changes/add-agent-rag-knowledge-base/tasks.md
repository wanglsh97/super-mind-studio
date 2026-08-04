## 1. 数据与 Embedding 基础

- [x] 1.1 新增 KnowledgeBase、KnowledgeDocument、KnowledgeChunk Prisma 模型、状态/索引约束与 pgvector migration，并验证空库迁移
- [x] 1.2 实现 provider-neutral Embedding 契约、256 维确定性 Mock Adapter、配置校验和无网络单测
- [ ] 1.3 实现参数化向量 repository，强制 owner/知识库/READY/embedding-version 过滤并覆盖隔离、排序和空结果测试

## 2. 文档导入与检索最小闭环

- [ ] 2.1 实现 UTF-8 text/Markdown 输入校验、标准化与确定性分块，覆盖大小、格式、overlap、hash 与边界测试
- [ ] 2.2 实现知识库 CRUD、同步导入、原子 READY/FAILED 状态和级联删除 API，全部使用当前 User Session
- [ ] 2.3 在 SDK 实现 typed knowledgeBases client、错误契约和单测
- [ ] 2.4 新增最小知识库 Web 页面（创建、导入、状态、删除），仅通过 SDK 调用
- [ ] 2.5 完成第一条 Mock 端到端验收：Web → SDK → API → Mock Embedding → pgvector → 用户隔离检索，并记录结果

## 3. Agent RAG 工具与引用

- [ ] 3.1 实现 `search_knowledge_base` schema、服务端工具、检索结果不可信 envelope、审计元数据与取消传播
- [ ] 3.2 将 RAG tool 注册到 Agent run，保留无知识库时的正常运行，覆盖 tool 参数、owner 隔离、提示注入和取消测试
- [ ] 3.3 在 SDK/Agent event 中提供稳定来源引用，在 Web Agent 工具卡与最终消息中安全展示文档标题和 chunk 引用
- [ ] 3.4 完成 Mock Agent E2E：导入资料 → Agent 检索 → follow-up 回答 → SSE/event cursor → PostgreSQL tool audit

## 4. 生产配置、质量与交付

- [ ] 4.1 实现显式启用的 OpenAI-compatible Embedding Adapter、去敏 fixture 与最低成本 smoke 脚本，不在默认配置调用外部服务
- [ ] 4.2 更新 `.env.example`、Docker PostgreSQL pgvector 配置、README、Swagger、部署/备份说明和 RAG 数据保留边界
- [ ] 4.3 运行 RAG 单元、集成、Agent E2E、Web E2E、typecheck、lint、build 与 migration validate，修复问题后记录验证结果
- [ ] 4.4 执行 `openspec validate add-agent-rag-knowledge-base --type change --strict`，仅在所有对应验证通过后更新 checkbox
