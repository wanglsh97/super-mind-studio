# 验收记录

日期：2026-07-27（America/Los_Angeles）

## 自动化

- `pnpm lint`：通过。
- `pnpm db:validate`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过；SDK 47、Web 49、API 585 个测试通过。
- 用户认证、用户授权和管理员隐私 E2E：9 个通过、1 个真实 Redis 用例因未提供
  `TEST_REDIS_URL` 跳过。
- 用户认证 E2E 增补“已有 Session 必须先退出再切换身份”：6 个通过、1 个真实 Redis
  用例跳过。
- `pnpm build`：API、Web、SDK 均通过。
- 测试 PostgreSQL `aigateway_test`：15 个 migration 全部应用，schema up to date。
- `generalize-user-auth-providers` 与 `build-aigateway-v1`：OpenSpec strict validate 通过。
- 本 change 涉及的 TypeScript、Markdown 和 YAML 文件：Prettier check 通过。

仓库级 `pnpm format:check` 已执行，但被 105 个既有未格式化文件阻断，主要位于
`.agents/skills`、既有 Agent/API 文件和用户未提交的后台样式；未对这些无关文件做批量改写。

## 浏览器回归

- 登录页同时展示 GitHub、Google 和匿名三个入口。
- GitHub 入口指向同源 `/api/v1/auth/github?returnTo=%2F`，本地 API 返回 GitHub authorize
  302，包含 callback、scope 和一次性 state。
- Google 入口指向同源 `/api/v1/auth/google?returnTo=%2F`；authorize 参数和 provider-bound
  state 由单元测试与 E2E 覆盖。
- 匿名登录成功创建 Session、进入 `/`，页面显示 `Anonymous User`；退出后返回
  `/login?returnTo=%2F`。
- 已有有效 Session 时，GitHub、Google 和匿名登录均返回 409，必须先退出再切换。

## 待真实凭证冒烟

当前未提供可用的 GitHub/Google OAuth Client 凭证，因此没有把外部账号授权和真实 callback
描述为已通过。上线前分别执行一次真实 GitHub callback 和 Google callback 冒烟，确认：

1. callback URI 与生产 HTTPS 域名完全一致；
2. GitHub verified primary email 与 Google `email_verified` 映射符合规格；
3. 相同邮箱不会合并 User；
4. OAuth token、code、Cookie 和 Client Secret 不进入日志或数据库。
