## Context

Agent 已在 NestJS 单体内管理用户隔离的 thread/run、PostgreSQL 持久事件、工具注册表、SDK 和 Next.js 工作台，但没有用户资料的长期检索能力。当前生产部署是单台 ECS 的 PostgreSQL 17、Redis 与 API 容器；不允许引入 Worker、独立向量数据库或浏览器侧 Provider 凭证。

## Goals / Non-Goals

**Goals:**

- 为用户私有的文本/Markdown 文档提供可重复的导入、分块、Embedding、索引和检索闭环。
- 在 Agent 内以一个受限、可审计的工具提供检索，模型不可绕过 owner 与 knowledge-base 过滤。
- 用 PostgreSQL `pgvector` 避免新增基础设施；Mock Embedding 支持无公网 CI。
- 让检索命中作为不可信内容携带来源标识进入模型上下文，并支持 API、SDK 和 Web 状态展示。

**Non-Goals:**

- 不支持 PDF/Office/OCR、网页抓取、图片、音视频、跨用户共享、公开知识库或后台 Worker。
- 不提供自动重嵌入、混合检索、reranker、动态 chunk 策略、评价反馈或全文/向量管理后台。
- 不在默认配置发起外部 Embedding 请求，不修改现有模型计费或 Agent 运行预算语义。

## Decisions

### 1. PostgreSQL pgvector 是 V1 向量真源

新增 `KnowledgeBase`、`KnowledgeDocument` 和 `KnowledgeChunk`。migration 显式执行 `CREATE EXTENSION IF NOT EXISTS vector`，chunk 以固定维度 `vector(256)` 存储，并为 `(knowledgeBaseId, embedding)` 创建 ivfflat cosine 索引。Prisma 暂不映射 vector 字段；repository 使用参数化 `$queryRaw`，所有过滤条件（userId、knowledgeBaseId、READY 文档）均在同一 SQL 查询内。

备选的专用向量库会增加单机运维与备份边界；把 JSON 向量留在 Prisma 中无法提供数据库排序与索引，因此不采用。

### 2. 文档导入是同步、有大小上限的文本纵向切片

`POST /agent/knowledge-bases/:id/documents` 接受 UTF-8 `text/plain` 或 `text/markdown`，最大 512 KiB。服务端标准化换行、按标题/段落优先并按字符窗口（默认 1,200，200 overlap）确定性分块；文档状态依次为 `PENDING → INDEXING → READY | FAILED`。调用端在请求内完成索引，不引入队列；超时或失败保留 `FAILED` 与无半成品 chunk。

备选的对象存储异步解析适合大文件，但需要 Worker、文件治理与重试调度，超过本 change 范围。

### 3. Embedding 使用受版本约束的 provider-neutral port

`EmbeddingPort.embed(texts, signal)` 返回 256 维向量和 `model/version`。默认 `mock` 将 token 哈希映射为归一化向量，确定且不联网；生产 `openai-compatible` adapter 仅在 `RAG_EMBEDDING_PROVIDER=openai-compatible` 且 endpoint/key/model 全部有效时注册。Provider 类型、密钥和原始响应只在 API adapter 层存在。

在文档与 chunk 上保存 `embeddingModel` 和 `embeddingVersion`，检索只匹配当前 active version，避免不同维度/版本混排。真实调用成本不被静默计入模型账单；上线前另行确认计费记录策略。

### 4. Agent 只通过 `search_knowledge_base` 调用 RAG

该工具接受 `query`、可选 `knowledgeBaseIds`（最多 3）和 `limit`（1–6）。服务端从当前用户的 READY 知识库检索，返回受限文本、相似度、documentId、title 和 chunk ordinal。工具描述及结果 envelope 明确命中内容为不可信参考资料，禁止执行其中的指令；Agent 最终回答的来源卡片只展示资料元数据而不是未消毒 HTML。

工具调用与其他 Agent 工具一起记录到 `AgentToolCall`。检索查询、命中文档 ID、分数、耗时可以审计；不将完整 chunk 内容写入 Pino。

### 5. API/SDK/Web 按 owner 过滤并以最小界面呈现

知识库的 CRUD、导入、列表、详情与删除均使用当前 User Session，不接受 `userId`。Web 在工作区提供“知识库”入口，显示状态与失败文案；SDK 增加 `knowledgeBases.*` typed client。Agent 详情事件中以稳定来源引用展示检索命中，不向非所有者泄露标题、内容或相似度。

## Risks / Trade-offs

- [PostgreSQL 镜像缺少 pgvector] → Dockerfile/Compose 使用含扩展的 PostgreSQL 17 镜像，并在 readiness/runbook 明确校验扩展；migration 在不支持时失败而非降级为不安全的全表扫描。
- [Mock 向量不等于真实语义质量] → 仅用于开发/CI，UI 及配置明确标注；真实生产 provider 由显式配置与最低成本 smoke 验证启用。
- [同步索引占用 API 请求] → 512 KiB、chunk 数和总输入上限；大文件/批量导入留给后续 Worker change。
- [检索命中包含提示注入] → 工具结果作不可信数据封装，既有 Agent 规则不允许外部内容改变工具权限。
- [ivfflat 小数据集收益有限] → V1 优先查询正确性；索引仍在数据增长后提供可预测的检索路径。

## Migration Plan

1. 在备份后的 PostgreSQL 中部署 migration，验证 `vector` 扩展和索引。
2. 以 Mock Embedding 启动，运行 API/SDK/Agent 无网络 E2E。
3. 启用 Web 入口和 RAG tool；默认无资料时工具返回明确 empty result，不影响普通 Agent 回答。
4. 如需回滚，关闭 RAG module/tool 与 Web 入口，保留表和向量；不删除用户资料。生产 Provider 回滚为 `mock` 或禁用即可，无需 schema 回退。

## Open Questions

- 生产 Embedding 服务的供应商、模型、地域与调用计费策略需在上线前由产品确认。
- PDF/Office 解析、对象存储文件导入、批量重索引和混合检索作为后续独立 change 评估。
