## Why

当前 Agent 只能依赖对话上下文、联网工具、Skill 和用户工作区文件，无法把用户自有资料稳定、可追溯地用于多轮问答。需要以一个可在单机部署、可用 Mock 验收的最小 RAG 闭环，为后续文档知识问答提供受用户隔离的数据与检索边界。

## What Changes

- 新增用户私有知识库、文本/Markdown 文档导入、确定性分块和异步可观测的索引状态。
- 新增 provider-neutral Embedding 端口：开发、测试和 CI 默认使用不联网的确定性 Mock；生产 Embedding Provider 仅在显式配置后启用。
- 使用 PostgreSQL `pgvector` 保存版本化向量与文档分块，并按用户与知识库严格过滤检索结果。
- 新增仅由 Agent 调用的 `search_knowledge_base` 工具；命中内容作为不可信工具结果回灌，并携带文档与分块引用，供最终回答引用来源。
- 提供用户知识库管理 API 与最小 Web 入口，支持创建、导入、查看索引状态和删除；删除同时级联清除文档及分块。

## Capabilities

### New Capabilities

- `agent-rag-knowledge-base`: 用户隔离的知识库、文档导入、分块、Embedding、向量检索、Agent 工具调用、来源归因与删除语义。

### Modified Capabilities

- `web-agent`: Agent 在已存在的受控工具注册表中按用户可访问知识库调用检索工具，并将命中内容按不可信上下文边界注入模型。

## Impact

- `apps/api` 新增 Knowledge Base 模块、Embedding 端口、`pgvector` migration、索引/检索服务和 Agent RAG tool。
- `packages/sdk` 增加知识库管理与检索引用类型；`apps/web` 增加最小知识库页面及 Agent 检索来源展示。
- PostgreSQL 需要安装 `vector` 扩展；默认 Mock Embedding 不产生外部调用成本，生产 Embedding 的密钥、模型和维度通过显式环境配置启用。
- 现有会话、模型调用、Skill、MCP 和 Sandbox 行为保持兼容。回滚时隐藏知识库入口并停用 RAG tool；已写入的 RAG 表和向量保留，不做破坏性回滚。
