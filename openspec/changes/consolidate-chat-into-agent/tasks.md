## 1. 规格与路由收敛

- [x] 1.1 新增 proposal、design、web-agent/user-workspace-routing delta specs，并通过 OpenSpec strict validation
- [x] 1.2 将 `/chat` 替换为到 `/agent` 的服务端兼容跳转，删除旧页面专属 adapter 与测试

## 2. 用户入口与文档

- [x] 2.1 更新侧栏、站点导航、首页 CTA、登录默认回跳和对比页返回入口，使 Agent 成为唯一普通对话入口
- [x] 2.2 更新 PRD、技术方案和 README，明确 Chat API 保留、普通对话由 Agent 承载、对比页暂时独立

## 3. 验收

- [x] 3.1 增加路由与认证 helper 回归测试，运行 Web test、typecheck、lint、build 和 OpenSpec strict validation

## 4. Agent-only C 端收敛

- [x] 4.1 扩展 proposal、design 和 user-workspace-routing spec，明确 `/image`、`/prompt` 无兼容跳转且底层 API/SDK 保留，通过 strict validation
- [x] 4.2 删除 Image/Prompt 页面及页面专属 helper/test，确认无残留前端引用
- [x] 4.3 从首页、导航、登录页和 returnTo 白名单移除 Image/Prompt，只保留 Agent 主入口及配套 Skill/API
- [x] 4.4 同步 README、PRD、技术方案，运行 Web test、typecheck、lint、build、dev 404 冒烟和 OpenSpec strict validation
