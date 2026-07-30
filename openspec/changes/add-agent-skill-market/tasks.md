## 1. Skill 注册与持久化

- [x] 1.1 定义平台 Skill descriptor、仓库内清单和注册校验，覆盖重复 ID、非法版本、字段限长、未知工具与确定性排序测试
- [x] 1.2 新增 `UserAgentSkill` Prisma 模型和正式 migration，验证用户级唯一约束、级联清理与 schema validation
- [x] 1.3 实现用户安装 repository/service，覆盖目录合并、幂等安装/卸载、启停、未知 Skill 与跨用户隔离

## 2. API、SDK 与运行时加载

- [x] 2.1 新增认证 Skill 市场 API 与 DTO，覆盖列表、安装、启停、卸载和错误 envelope
- [x] 2.2 扩展 `@supermind/sdk` Skill 契约与 client，覆盖 URL、credentials、响应解析和协议错误
- [x] 2.3 将 Prompt Composer 改为每次模型调用按用户加载 enabled Skill，验证信任层转义、manifest 版本和 Tool allowlist 不变

## 3. Skill 市场页面与验收

- [x] 3.1 将 `/skills` 接入真实 SDK，展示市场目录、安装/启用状态及 loading/empty/auth/error 状态
- [x] 3.2 实现安装、启停和卸载交互，验证并发禁用、服务端响应回写和窄屏布局
- [x] 3.3 更新 Swagger、README 与相关 OpenSpec 说明，明确平台清单、安全边界和变更生效时机
- [x] 3.4 运行相关单元/集成/UI 测试、Prisma validate、typecheck、lint、build 与 strict OpenSpec 校验
