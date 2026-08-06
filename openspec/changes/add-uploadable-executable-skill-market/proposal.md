## Why

现有 Skill 市场只允许用户从仓库内受审清单安装提示型 Skill，不能上传传统 `SKILL.md` 资源包，也不能在隔离 Linux 环境中执行包内脚本。后 V1 版本需要把它扩展为公开的用户上传市场，并让用户手动指定或由模型自主选择 Skill 完成带文件和 Shell 的 Agent 任务。

## What Changes

- **BREAKING**：Skill 内容真源从随 API 发布的 TypeScript 清单改为 PostgreSQL 有界元数据加私有阿里云 OSS 资源包；数据库不保存 ZIP 或包内文件正文，全局唯一 Skill 名称由首次发布者持有。
- 所有 GitHub 登录用户可通过短时、单对象 OSS 凭证直传传统 ZIP Skill 包；首次发布由固定管理员审核，已发布 Skill 的后续上传直接覆盖当前 OSS 对象且不再次审核。
- 公共市场提供分页、关键词搜索、固定分类筛选、最新/添加人数排序、详情、`SKILL.md` 预览和文件树；用户最多添加 50 个 Skill。
- **BREAKING**：取消已安装 Skill 的启用/停用语义，改为“已添加/未添加”；下架后新 Thread 或当前 Thread 中尚未缓存的 Skill 不能再下载，但当前 Thread Sandbox 已完整下载的包在其剩余生命周期内仍可激活。
- 每个 Agent Thread 首次执行时创建一个可跨多轮 Run 复用的 OpenSandbox Linux 沙箱；默认最大生命周期和空闲清理上限均由 `SANDBOX_TIMEOUT_SECONDS=3600` 控制。每个 Run 绑定到 ready Sandbox 后会以 4 路并发异步增量预取当前用户所有已添加且已发布的候选 Skill，不阻塞 Run 启动；手动选择或模型调用 `activate_skill` 时优先读取带完成标记的 Thread 本地包，不再访问 PostgreSQL 或 OSS，预取失败或本地缺失时才按当前权限签发短时只读 OSS URL 并同步补下载一次。
- 新增永久用户文件能力：输入附件与 Skill 结果存入私有 OSS，使用短时签名 URL 上传/下载，每用户总配额 1 GiB。
- 新增独立 OpenSandbox 执行节点，首选 Docker + gVisor；每个 Agent Thread 最多一个临时沙箱并强制 CPU、内存、磁盘、时长和进程上限，同时继续按 Run 重置流量、Shell 次数和输出预算。
- 本地开发与生产 API 均强制连接真实 OpenSandbox Server，删除进程内 Fake Runtime 与运行时选择开关；单元测试只允许替换 OpenSandbox SDK client，不能形成可被应用启动选择的 fallback。
- 管理后台新增首次发布审核、驳回和强制下架，并写入不可变管理员审计日志。

## Capabilities

### New Capabilities

- `skill-publishing`: 用户上传、首次审核、直接覆盖、下架、市场发现和全局名称所有权。
- `sandbox-execution`: OpenSandbox 生命周期、Run 级 Shell/文件执行、资源预算、结果回传和销毁。
- `user-files`: Agent 输入与输出文件的私有 OSS 存储、用户隔离、永久保留、配额和删除。

### Modified Capabilities

- `agent-skills`: 将仓库内提示型 Skill 清单和启停状态改为用户上传资源包、添加状态、手动/模型激活及精确包摘要记录。
- `agent-context`: Prompt Composer 从“注入全部已启用 Skill”改为先注入候选目录，并在 `activate_skill` 后加载完整 `SKILL.md`。
- `agent-tools`: 增加 `activate_skill`、Shell 与文件工具，并将实际执行委托给当前 Thread 的 OpenSandbox，而非 NestJS 进程或宿主机。

## Impact

- `apps/web` 新增 Skill 上传/详情/我的文件页面，将“已添加”和“我的 Skill”整合为 `/skills` 的一级分类，并扩展 `/agent` 的手动 Skill 选择、工具卡片和文件交互。
- `apps/api` 新增 Skill 发布、审核、OSS 上传签名、用户文件、Sandbox runtime adapter 和 Agent 激活编排；现有固定管理员认证继续用于审核。
- `packages/sdk` 增加市场搜索、上传、审核、添加、文件和沙箱事件契约；浏览器继续只调用同源 `/api`。
- Prisma 仅持久化平台 Skill 的身份、状态、对象 key/hash/size、有界展示投影、审核、用户添加状态和用户文件元数据；AgentThread 持久化当前 sandboxId、生命周期与最后使用时间，AgentRun/AgentToolCall 记录所用 sandboxId、Skill 摘要、资源使用和终止原因。
- 基础设施新增私有 OSS Bucket 与独立 OpenSandbox 节点，突破 V1 单 ECS 部署边界；业务数据库、Redis、模型密钥和 OSS 管理凭证不得进入沙箱。
- 回滚时可隐藏上传与执行入口、停止创建新沙箱并保留 Skill/文件元数据与 OSS 对象；现有提示型 Skill 市场和普通 Agent 对话需要在迁移阶段保持可恢复路径。
