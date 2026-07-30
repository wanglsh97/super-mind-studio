## Context

现有 `AgentSkillRegistry.list()` 是同步空实现，Prompt Composer 已具备 `selected_skills` 信任层和 `skillVersions` manifest。`/skills` 页面则硬编码三张展示卡片。首版需要串通市场、用户选择和运行时加载，同时避免引入任意文件读取、远程包安装或可执行插件。

## Goals / Non-Goals

**Goals:**

- 提供平台审核 Skill 的统一注册入口和确定性市场目录。
- 持久化每个 GitHub 登录用户的安装、启用状态。
- 在每次 Agent 模型调用前只加载当前用户已启用的 Skill。
- 保证 Skill 是受限的提示组件，不能扩大服务器能力或权限。

**Non-Goals:**

- 不支持用户上传、自定义 Skill、Git 仓库安装、远程市场或磁盘目录扫描。
- 不执行 Skill JavaScript、shell、MCP 或生命周期 hook。
- 不允许 Skill 自行注册工具、读取凭证或绕过工具审批。
- 不实现评分、评论、付费、搜索排序后台或管理员在线编辑器。

## Decisions

### Decision 1: 仓库内清单是 Skill 内容真源

平台 Skill 以 TypeScript 常量随 API 发布。启动注册时校验稳定 ID、语义化版本、字段长度、重复 ID 以及 `allowedTools` 是否存在于实际 Tool registry。数据库只保存 `userId + skillId + enabled`，避免过期正文和数据库在线编辑改变模型策略。

### Decision 2: 安装状态属于用户，不属于 thread

首版安装/启用对用户全局生效。Prompt Composer 已在每次模型调用前执行，因此用户切换状态后，下一次模型调用自然加载最新集合；已有 AgentRun 的 prompt manifest 保留当次实际 Skill 版本以供审计。

### Decision 3: Skill 只提供指令，不提供执行代码

注册 descriptor 包含展示元数据、英文模型指令和可选 `allowedTools` 声明。`allowedTools` 仅用于验证 Skill 不引用未知工具，不会向 Tool registry 添加能力。Prompt 继续明确 Skill 低于平台规则且不能扩展 allowlist。

### Decision 4: API 使用幂等状态变更

`GET /api/v1/agent/skills` 返回目录与当前用户状态；`PUT /skills/:id/install` 幂等安装并默认启用；`PATCH /skills/:id` 修改 enabled；`DELETE /skills/:id/install` 幂等卸载。所有接口使用现有 GitHub 用户 Session guard，未知或下架 Skill fail closed。

## Risks / Trade-offs

- [Skill prompt injection 或越权描述] → 内容仅来自受审代码清单，注册限长并由核心 prompt 固定其信任层。
- [部署升级后安装记录引用已移除 Skill] → 市场和加载只以当前 registry 为准，孤立安装记录不注入模型。
- [状态切换影响正在运行的多轮 Agent] → 每次模型调用都重新加载并记录 manifest；这是动态上下文既有语义，UI 提示变更从下一次模型调用生效。
- [Skill 指令增加上下文占用] → Skill 正文限长并进入现有 token budget/压缩计算，不能绕过 context window。

## Migration Plan

1. 新增 `UserAgentSkill` migration 和 Prisma 关系。
2. 用平台清单替换空 registry，添加注册安全测试。
3. 新增用户状态 repository/service/controller 与 SDK。
4. Prompt Composer 按用户异步加载 enabled Skill，并更新 golden/manifest 测试。
5. 将 `/skills` 接入真实 API，验证安装、停用、卸载和窄屏状态。

