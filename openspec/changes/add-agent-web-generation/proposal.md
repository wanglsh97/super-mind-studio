## Why

现有 Agent 已具备 Thread、Run、SSE、Sandbox 和通用文件工具，但“会写前端代码”还不等于可稳定交付网站。网页创作需要用内置 Skill 固定“怎么建”，再用单一内置 Tool 以平台可验证的方式完成构建、预览和 ZIP 交付，而不是新增一套网站 Agent API。

## What Changes

- 在既有 Agent Run 请求中增加 `mode: website`，继续复用同一 Thread、Run、SSE 和 Sandbox 链路。
- 新增平台内置、不可编辑的 `static-website-builder` Skill，固定 React + TypeScript + Vite + Tailwind CSS + shadcn/ui + Lucide、项目目录、初始化脚本和构建命令。
- 新增唯一网站交付 Tool `create_website`：执行构建、校验静态产物、生成 ZIP、原子覆盖最终产物并返回当前 Thread 的临时预览入口。
- 一个 Thread 仅保留一份最新成功网站产物；修改不建立版本历史，新成功交付覆盖旧产物，失败构建必须由 Agent 继续修复。
- 网页选择态由前端按 Thread 保留，每次 Run 都传 `mode: website`；用户手动取消后恢复普通 Chat。
- 删除旧 `/creations/websites*` 创建、详情、预览和下载套件；“我的创作”仅通过通用列表和通用 Creation Asset 下载读取最终产物。
- 删除 Thread 时立即销毁 Sandbox 并使预览失效；最终 `source.zip` 与 `dist.zip` 继续私有保留 30 天。

## Capabilities

### New Capabilities

- `agent-web-generation`: 基于既有 Agent 链路的内置建站 Skill、单一交付 Tool、Thread 临时预览和单份最终 ZIP 产物。
- `creative-library`: 用户隔离的“我的创作”统一列表与通用产物下载。

### Modified Capabilities

- `agent-tools`: 增加只在 website mode 可见的 `create_website`，不再组合多个项目交付 Tool。
- `user-files`: 网站最终产物投影到可过期 Creation Asset，不对外暴露 OSS URL。

## V1 Boundary

V1 及可预见范围内都只生成纯静态网站；不支持或预留数据库、登录、评论、支付、服务端运行时、私密密钥、全栈 Skill、版本历史、回滚、GitHub/Cloudflare Connector 或公网发布。
