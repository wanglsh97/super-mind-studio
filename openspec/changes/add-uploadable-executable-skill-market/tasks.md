## 1. Mock Skill 执行首个纵向闭环

- [x] 1.1 为 `@supermind/sdk` 定义 Skill 市场项、添加状态、手动选择、激活事件、Shell/文件工具事件和标准错误契约，并添加序列化测试
- [x] 1.2 新增 `Skill`、`SkillReview`、`UserFile` 及 AgentRun/AgentToolCall 扩展字段的 Prisma migration，验证全局名称、用户添加唯一约束和关联删除边界
- [x] 1.3 定义 `SkillObjectStorePort` 与确定性内存实现，支持包元数据、`SKILL.md`、文件树、输入文件和结果文件 fixture
- [x] 1.4 定义 `SandboxRuntimePort` 与确定性 Fake Adapter，覆盖创建、命令、文件、取消、预算超限、销毁和泄漏查询
- [x] 1.5 实现最小 Skill repository/service：一个预置 published Skill、用户幂等添加、50 个上限、手动激活和当前包 SHA-256 manifest
- [x] 1.6 将 Agent Tool registry 接入 `activate_skill`、Fake Shell 和文件工具，保证所有调用仍经过 Pi harness、Run 状态机和持久化事件
- [x] 1.7 扩展 Agent Run API 与 SDK，使手动选择的 Skill 完成 Mock tool call → Fake Sandbox → tool result → follow-up 模型 turn → SSE cursor
- [x] 1.8 在 `/agent` 增加最小 Skill 选择器和 Shell/文件工具卡片，覆盖 loading、running、success、failed、cancelled 和 limit 状态
- [x] 1.9 添加无外网 E2E，串通 Web → SDK → Agent API → Mock Adapter → Fake Sandbox → SSE → PostgreSQL AgentRun/AgentToolCall/RequestLog/BillingRecord
- [x] 1.10 运行首个闭环相关单测、Prisma 集成测试、Agent E2E、typecheck、lint 和 build，并确认未启用功能旗标时现有 Agent/Skill 回归通过

## 2. 私有 OSS 与传统 Skill 包上传

- [x] 2.1 实现阿里云 OSS 配置校验和 `SkillObjectStorePort` 生产 Adapter，Bucket 保持私有且凭证只存在服务端
- [x] 2.2 实现短时单对象上传会话、object key 作用域、大小约束、幂等 finalize 和 abandoned staging cleanup 状态
- [x] 2.3 实现 ZIP 检查器，验证根 `SKILL.md`、20 MiB 压缩、200 MiB 解压、2,000 文件、50 MiB 单文件、20 层目录及链接拒绝
- [x] 2.4 实现安全的 `SKILL.md` 读取、Markdown 消毒和不含脚本正文的文件树投影，覆盖乱码、二进制、路径穿越和损坏 ZIP fixture
- [x] 2.5 扩展 SDK 上传契约并实现浏览器直传 OSS、进度、取消、失败重试和 finalize，不让包字节经过 NestJS
- [x] 2.6 在 `/skills` 由上传按钮直接打开文件夹选择器，选择后弹窗展示根 `SKILL.md` YAML 默认值、固定分类、可编辑标题/简介和上传状态，覆盖桌面与移动端
- [x] 2.7 添加 OSS Adapter contract tests 和本地兼容对象存储集成测试，验证签名范围、对象私有性、覆盖写与清理

## 3. 首次审核、市场发现与用户添加

- [x] 3.1 实现全局 Skill 名称校验、首次占用、owner 授权和固定分类枚举，覆盖并发抢名与跨用户覆盖拒绝
- [x] 3.2 实现 pending_review → published/rejected 状态机、驳回原因和固定管理员审核 API
- [x] 3.3 将审核、驳回和管理员下架与 `AdminAuditLog` 放入一致的事务边界，并覆盖失败回滚测试
- [x] 3.4 实现 owner 对已发布 Skill 的同 key 直接覆盖和元数据更新，确认不创建 revision、不触发复审且更新 SHA-256
- [x] 3.5 实现 owner/admin 立即下架、市场隐藏、既有添加记录保留和新 Run 激活拒绝
- [x] 3.6 实现公开分页、关键词搜索、固定分类筛选、最新/添加人数排序和 Skill 详情 API
- [x] 3.7 将 `UserAgentSkill` 迁移为无 enabled 的添加状态，实现幂等添加/移除、50 个上限、跨用户隔离和 addCount 一致性
- [x] 3.8 扩展 `@supermind/sdk` 的市场、owner、添加/移除和管理员审核 client，覆盖 URL、credentials、分页和错误 envelope
- [x] 3.9 完成 `/skills`、详情、集成式“已添加/我的 Skill”分类和管理员审核页面，覆盖 empty/auth/pending/rejected/delisted/error 状态
- [x] 3.10 运行市场 service、PostgreSQL 事务、SDK、页面与管理员未授权 E2E，并执行 typecheck、lint 和 build

## 4. OpenSandbox PoC 与生产 Adapter

- [ ] 4.1 锁定候选 OpenSandbox、Docker 和 gVisor 版本，在独立测试节点记录安装、启动、升级和卸载步骤
- [x] 4.2 编写可重复 PoC 验收，覆盖创建、ready、Shell、工作目录、文件上传/下载、退出码、stdout/stderr、取消和销毁
- [ ] 4.3 验证 OpenSandbox 一 vCPU、1 GiB 内存、2 GiB 磁盘、64 进程、120 秒 TTL 和 60 秒命令超时的实际强制行为
- [ ] 4.4 验证任意公网访问可用，同时 loopback、VPC 私网、云元数据、业务服务和 OpenSandbox 控制面不可达
- [ ] 4.5 测量冷启动、包下载、首条命令、销毁和并发延迟，记录目标 ECS 规格、最大安全并发与月成本估算
- [x] 4.6 实现 OpenSandbox TypeScript Adapter，将厂商类型限制在 Adapter 内，并通过与 Fake Adapter 相同的 contract suite
- [x] 4.7 实现 API 到 OpenSandbox 的私网认证、连接/请求超时、重试边界、健康检查和 readiness 降级
- [x] 4.8 实现终态幂等销毁和过期 sandbox reconciliation，覆盖 NestJS 重启、网络中断和部分创建失败
- [ ] 4.9 使用真实 OpenSandbox 完成最低资源端到端 smoke，记录版本、节点规格和每 Run 实测资源，不执行无界压力测试

## 5. 模型自主 Skill 激活与 Run 级 Shell

- [x] 5.1 将 Prompt Composer 改为初始只注入最多 50 个 added published Skill 的名称与简介，添加信任层和 context budget 测试
- [x] 5.2 实现 `activate_skill` JSON Schema、用户添加/发布授权、幂等单次激活、当前 OSS 下载和 SHA-256 记录
- [x] 5.3 在激活后把完整转义 `SKILL.md` 加入后续模型调用，验证平台规则、工具权限和硬预算不能被 Skill 文本覆盖
- [x] 5.4 实现手动选择 Skill 的 pre-activation，并允许模型继续激活其他 Skill，不设置独立 active Skill 数上限
- [x] 5.5 实现 Run 内单一 Sandbox workspace 布局和多 Skill 共享，验证不同 Run、用户和线程之间完全隔离
- [x] 5.6 实现 autonomous Shell 工具、cwd、60 秒命令超时、20 次调用限制、AbortSignal 和后台进程终态清理
- [ ] 5.7 实现单次 1 MiB、Run 总计 5 MiB 工具输出截断及 100 MiB 出口流量终止，并将 limit reason 返回模型与 UI
- [ ] 5.8 持久化 Skill 激活、sandbox 生命周期、命令、退出状态、耗时、截断和错误审计，敏感签名 URL 不进入 Pino
- [ ] 5.9 完善 `/agent` 自动/手动 Skill UX、当前激活 Skill、Shell 日志与 Run 限制展示，确认调用不会弹出审批
- [ ] 5.10 添加 Mock 与 OpenSandbox Agent E2E，覆盖模型选择、多 Skill、上下文超限、命令失败、取消、断线重连和下架竞态

## 6. 永久用户文件与 Skill 结果导出

- [ ] 6.1 实现用户文件短时 OSS 上传、finalize、owner 过滤和稳定 Agent `file-reference` 契约
- [ ] 6.2 实现每 Run 50 MiB 输入、100 MiB 输出和每用户 1 GiB 总配额的事务级预占与确认
- [ ] 6.3 将用户选择的输入文件复制或挂载到 `/workspace/input`，验证文件名规范化、只读边界和跨用户拒绝
- [ ] 6.4 实现 `/workspace/output` 显式导出、OSS 持久化、文件哈希和短时签名下载 URL
- [ ] 6.5 实现用户文件永久保留、幂等删除、OSS 失败 cleanup_pending 状态和配额继续占用规则
- [ ] 6.6 确认删除 Agent thread、下架 Skill 或覆盖包均不删除已有用户文件，并添加关联回归测试
- [ ] 6.7 扩展 SDK 文件上传、列表、下载、删除和 Run 附件 client，覆盖大文件进度、取消和过期签名
- [ ] 6.8 完成 `/files` 与 Agent Composer 附件/结果交互，覆盖配额、空状态、永久文件和移动端下载
- [ ] 6.9 添加 OSS/PostgreSQL 文件一致性、跨用户访问、配额竞争、导出失败和清理重试 E2E

## 7. 迁移、部署与交付验收

- [ ] 7.1 将现有三个平台 Skill 转为传统资源包并 seed 为 published 记录，验证市场展示和 Agent 行为保持一致
- [ ] 7.2 编写 `UserAgentSkill` enabled → added 数据迁移和回滚兼容读取，确认迁移后不会自动注入全部 `SKILL.md`
- [ ] 7.3 增加市场上传、sandbox execution、user files 独立 feature flags，并验证逐项关闭不会破坏普通 Agent
- [ ] 7.4 更新 PRD、技术选型、README、Swagger、`.env.example` 和部署文档，明确后 V1 双节点、OSS、OpenSandbox、固定管理员及已接受风险
- [ ] 7.5 配置 Nginx/私网路由、OSS CORS 与 lifecycle、OpenSandbox 日志轮转、健康检查和 sandbox 节点监控
- [ ] 7.6 完成故障演练：OSS 不可用、OpenSandbox 不可用、sandbox 泄漏、API 重启、磁盘/流量/TTL 超限和用户取消
- [ ] 7.7 完成回滚演练：停止新 Run、等待最多 120 秒、销毁剩余 sandbox、关闭上传/执行入口并恢复提示型 Skill 兼容路径
- [ ] 7.8 运行全量单元、contract、PostgreSQL/Redis/OSS 集成、Mock/OpenSandbox 流式 E2E、页面 E2E、typecheck、lint、build 和部署冒烟
- [ ] 7.9 对 `add-uploadable-executable-skill-market` 执行 strict OpenSpec 校验，并确认所有 checkbox 只在实现和对应验证完成后勾选
