## Why

`/skills` 目前只是静态预览，服务端 `AgentSkillRegistry` 也固定返回空集合。用户无法发现、安装或启用平台维护的 Skill，Agent Prompt Composer 因而无法加载已经预留的 Skill 信任层。

## What Changes

- 新增平台维护的 Skill 清单与严格注册校验。Skill 随服务端代码发布，不扫描本地目录、不执行 Skill 代码，也不接受用户上传。
- 新增用户隔离的 Skill 安装状态，支持列出市场、安装、启用/停用和卸载。
- 将 `AgentSkillRegistry` 改为按用户加载已安装且启用的 Skill，并在每次模型调用的 Prompt Composer 阶段注入 Skill 指令和版本 manifest。
- 将 `/skills` 从静态预览升级为真实市场页面，通过 `@supermind/sdk` 访问同源 Agent Skill API。
- Skill 只能提供工作方法，不能注册工具、扩大工具白名单、修改平台策略或携带凭证。

## Capabilities

### New Capabilities

- `agent-skills`: 平台 Skill 注册、市场目录、用户安装状态、运行时加载及安全边界。

### Modified Capabilities

- `agent-context`: Prompt Composer 从用户已启用的平台注册 Skill 动态装配 selected_skills 与 manifest。

## Impact

- Prisma 新增用户与 Skill ID 的安装关联表；Skill 正文和版本仍以仓库内受审清单为真源。
- `apps/api` 新增 Skill registry、repository/service/API，并将 Prompt Composer 的 Skill 查询改为用户维度。
- `packages/sdk` 新增 Skill 市场与安装状态契约。
- `apps/web/src/app/skills` 新增真实加载和安装/启用交互。
- 回滚时可隐藏 `/skills` 入口并停止 Skill API；用户安装关联数据可保留，未加载 Skill 时 Agent 继续正常运行。

