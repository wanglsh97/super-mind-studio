# 阿里云 ECS 单机部署与回滚

本文适用于华东 1（杭州）的 Ubuntu 4 核 8G ECS。V1 在一台服务器上运行 Nginx、Web、API、PostgreSQL 和 Redis；只有 Nginx 暴露宿主机端口。

## 1. 上线边界

- Nginx 是唯一公网入口；不要在安全组开放 `3000`、`3001`、`5432`、`6379`。
- 安全组只向公网开放 `80`、`443`；`22` 只允许可信管理 IP。
- Compose 的 Nginx 同时提供公网 IP 的 HTTP 入口和域名 HTTPS 入口；域名 HTTP 会重定向到 HTTPS。浏览器看到的入口、`WEB_ORIGIN` 以及 GitHub/Google callback 必须使用同一个 HTTPS 域名。
- 公网 IP 只能验收首页、Swagger 和 health 等公开入口，不能作为生产 OAuth callback 或用户能力入口。Chat、文生图和 Prompt 优化均要求有效用户 Session；一次性匿名登录也会创建独立 User。
- V1 尚未实现全站成本硬顶和独立内容审核。首次部署必须使用 Mock-only；真实 Key 只在基础链路验收后逐个启用。
- 生产模板默认关闭固定管理员账号。若按已确认的临时决策设置 `ADMIN_FIXED_CREDENTIALS_ENABLED=true`，
  线上将直接接受 `root/123456`；该凭据公开且易猜测，不能把管理入口视为安全的公网认证能力。
- 管理员登录仍有默认 5 次/IP/分钟限流、短期 Secure/HttpOnly Cookie 和审计，但这些措施不能阻止分布式猜测，
  也不能降低凭据泄漏后的后台数据读取与修改风险。

## 2. ECS 初始化

在阿里云控制台确认域名 A 记录指向 ECS 公网 IP，并按上述边界配置安全组。登录服务器后安装 Git、Docker Engine 和 Compose plugin：

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/wanglsh97/ai-gateway-studio.git super-mind-studio
cd super-mind-studio
sudo sh infra/scripts/ecs-bootstrap.sh
```

脚本会把发起 `sudo` 的账号加入 `docker` 组。Docker 组具备等同 root 的主机控制能力，只能授予可信部署账号；不要通过开放 Docker TCP socket 解决权限问题。退出 SSH 并重新登录后确认：

```bash
docker version
docker compose version
```

## 3. 选择发布版本

V1 使用人工发布，不自动跟随 `main`。每次发布都必须选择明确 commit：

```bash
git fetch origin
git checkout <待发布的完整 commit SHA>
git status --short
```

`git status --short` 必须为空。部署脚本会再次检查工作区，并校验 `.env.production` 中的 `APP_VERSION` 是当前 commit SHA 或不少于 7 位的唯一前缀。

## 4. 注入生产环境变量

首次部署从模板复制，文件只保存在 ECS：

```bash
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

至少修改：

- `APP_VERSION`：当前 `git rev-parse HEAD` 的结果。
- `DOMAIN`、`PUBLIC_IP`、`HTTP_PORT=80`、`HTTPS_PORT=443`、`WEB_ORIGIN`。
- `POSTGRES_PASSWORD`：长随机密码。
- `DATABASE_URL`：使用 Compose 服务名 `postgres`；其中密码必须进行 URL 编码。
- `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`：只使用独立的生产 OAuth App，不能复用开发 App。
- `GITHUB_CALLBACK_URL`：必须精确为 `https://<DOMAIN>/api/v1/auth/github/callback`，并在 GitHub OAuth App 中配置同一个 callback。
- `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`：只使用独立的生产 OAuth Client，不能复用开发 Client。
- `GOOGLE_CALLBACK_URL`：必须精确为 `https://<DOMAIN>/api/v1/auth/google/callback`，并在 Google Cloud Console 中配置同一个 redirect URI。
- `USER_SESSION_SECRET`：至少 32 个随机字符；`USER_SESSION_TTL_SECONDS` 必须保持 `2592000`。
- `SKILL_OBJECT_STORE_DRIVER=oss`，并配置私有 Bucket 的 `OSS_REGION`、`OSS_BUCKET`、RAM AccessKey 和公网 HTTPS `OSS_ENDPOINT`。当前 `ali-oss` 同时接受 `cn-hangzhou` 和 `oss-cn-hangzhou`，模板采用官方文档常用的后者。
- `OSS_INTERNAL=false`：Skill 包由用户浏览器直传，签名 URL 不能使用仅 ECS 可达的内网 Endpoint。
- `ADMIN_SESSION_SECRET`：与用户 Session Secret 不同的随机值。
- `ADMIN_FIXED_CREDENTIALS_ENABLED`：模板默认 `false`；只有在明确接受固定 `root/123456` 公网风险时才设为
  `true`。恢复为 `false` 并重新部署即可关闭管理员登录。
- `SMOKE_MODEL_ALIAS`：首次保持 `qwen`，同时保持 Qwen 禁用，使该 alias 回退到 Mock Adapter。

首次部署保持：

```dotenv
MOCK_PROVIDER_ENABLED=true
QWEN_ENABLED=false
GLM_ENABLED=false
DEEPSEEK_ENABLED=false
KIMI_ENABLED=false
ADMIN_FIXED_CREDENTIALS_ENABLED=false
AGENT_MCP_SERVERS_JSON=[]
```

GitHub 和 Google OAuth 可独立启用：启用对应 provider 时设置 `GITHUB_OAUTH_ENABLED=true` 或 `GOOGLE_OAUTH_ENABLED=true`，并完整配置该 provider 的 Client ID、Client Secret 和 callback。一次性匿名登录始终可用；生产与 dev 使用相同身份逻辑。Compose 会把 OAuth 和两类 Session 配置显式注入 API；已启用 provider 缺少任一必填值时应在启动前失败。OAuth 应用主页使用 `https://<DOMAIN>`，不要填写公网 IP，也不要把 Client Secret 复制到命令输出、日志或工单。

私有 OSS Bucket 必须配置浏览器直传 CORS：Origin 精确填写 `WEB_ORIGIN`，允许 `PUT`，Allowed Headers 至少覆盖 `content-type`、`x-oss-object-acl`、`x-oss-meta-kind` 和 `x-oss-meta-sha256`（也可按 OSS 官方建议设为 `*`）。不要把 Bucket 改为 public-read；上传权限来自短时单对象签名。AccessKey 必须属于最小权限 RAM 用户，泄漏后立即轮换。生产发布脚本会拒绝缺少 OSS 配置、空 Region、非 HTTPS Endpoint 或 `OSS_INTERNAL=true`。

首次部署保持 MCP 关闭。启用前应审核 Server 身份、工具语义、数据出境和外部副作用，并把精确工具白名单写入 `AGENT_MCP_SERVERS_JSON`。生产 endpoint 必须使用 HTTPS；Bearer token 通过配置中的 `tokenEnv` 引用，不能嵌入 JSON。模板与 Compose 默认提供 `AGENT_MCP_TOKEN` 槽位；如需多个独立 token，先在 `infra/compose/compose.prod.yml` 的 API `environment` 中逐项增加对应变量，再在 JSON 中引用。不要使用 `env_file` 把整份生产配置无差别注入 API。

不要把 `.env.production`、API Key、数据库密码、Cookie secret、证书私钥或数据库备份提交到 Git。

## 5. 签发 HTTPS 证书

确认域名 A 记录和 ECS 安全组的 `80/443` 已生效后，在首次启动 TLS 版 Nginx 前签发证书：

```bash
sudo mkdir -p /var/www/certbot
sudo certbot certonly --standalone -d <域名>
```

首次签发时 `80` 端口不能被其他进程占用。发布后，Nginx 会通过 `/var/www/certbot` 提供 ACME HTTP-01 challenge。将该证书的 Certbot renewal authenticator 改为 webroot，并执行一次 dry-run，确保续期不需要停止 Nginx：

```bash
sudo certbot reconfigure --cert-name <域名> --authenticator webroot --webroot-path /var/www/certbot
sudo install -m 0755 infra/scripts/reload-nginx-after-cert-renewal.sh \
  /etc/letsencrypt/renewal-hooks/deploy/reload-super-mind-nginx
sudo certbot renew --dry-run --run-deploy-hooks --no-random-sleep-on-renew
```

证书只读挂载到 Nginx；续期成功后，deploy hook 会向生产 Nginx 容器发送 `HUP`，无中断热加载新证书。

## 6. 首次发布

```bash
ENV_FILE="$PWD/.env.production" ./infra/scripts/deploy-production.sh
```

脚本依次执行：

1. 校验 Docker、环境文件、commit SHA 和干净工作区。
2. 解析并验证生产 Compose。
3. 构建 Web、API 和 migration 镜像。
4. 已有 PostgreSQL 正在运行时，先创建并验证 custom-format 备份；首次部署跳过。
5. 启动 PostgreSQL、Redis，执行 Prisma migration，再按依赖启动 API、Web、Nginx。
6. 最多等待 180 秒通过 readiness。
7. 通过 Nginx 运行首页、health 和未登录 Chat `401` 门禁冒烟。提供临时用户 Session 时，额外验证 Mock Chat SSE 分段到达和 usage/`[DONE]`。

任何一步失败都会返回非零状态。脚本不会自动删除卷、恢复数据库或切换 Git 版本。

## 7. 发布验收

定义 Compose 命令：

```bash
export ENV_FILE="$PWD/.env.production"
export COMPOSE_FILE="$PWD/infra/compose/compose.prod.yml"
```

查看状态和健康：

```bash
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
curl --fail http://127.0.0.1/health/live
curl --fail http://127.0.0.1/health/ready
```

使用门禁脚本同时验证公网 IP 和域名。脚本会先确认生产环境仍是 Mock-only，再验证公开入口和未登录 Chat `401`，不会绕过用户登录或产生模型调用：

```bash
PUBLIC_IP_BASE_URL="http://<公网IP>" \
DOMAIN_BASE_URL="https://<域名>" \
ENV_FILE="$ENV_FILE" \
./infra/scripts/smoke-public-entrypoints.sh
```

完成 HTTPS 和至少一种生产登录方式验收后，只在受控终端临时读取当前浏览器的 `aigateway_user_session` Cookie，用隐藏输入运行一次登录态 SSE 冒烟。不要把 Cookie 写进 `.env.production`、Shell 历史、日志或聊天；命令结束后立即清除变量：

```bash
read -r -s SMOKE_USER_SESSION_TOKEN
export SMOKE_USER_SESSION_TOKEN
SMOKE_MODEL_ALIAS=qwen ./infra/scripts/smoke-production.sh "https://<域名>"
unset SMOKE_USER_SESSION_TOKEN
```

该 Cookie 只用于验收当前设备；若发生泄露，立即在页面退出以撤销对应数据库 Session。公网 IP 不执行登录态冒烟。

确认 Web/API 不是 root，且宿主机没有暴露内部端口：

```bash
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T web id -u
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api id -u
ss -lntp
```

两个 UID 均不能是 `0`。`ss` 不应显示 `3000`、`3001`、`5432`、`6379` 对公网监听。

验证请求已经持久化：

```bash
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -ec '
  PGPASSWORD="$POSTGRES_PASSWORD" psql \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --command="SELECT \"requestId\", provider, status, \"createdAt\" FROM \"RequestLog\" ORDER BY \"createdAt\" DESC LIMIT 5"
'
```

## 8. 启用 Kimi

Mock 完整验收后，在 `.env.production` 中配置：

```dotenv
MOCK_PROVIDER_ENABLED=true
KIMI_ENABLED=true
KIMI_API_KEY=<仅保存在 ECS 的新 Key>
KIMI_BASE_URL=https://api.moonshot.cn/v1
```

模型 ID 与社区展示名统一维护在 `apps/api/src/chat/chat-models.config.ts`，不能通过 ECS 环境变量覆盖。

保持 `SMOKE_MODEL_ALIAS` 指向一个未启用的文本 alias，使发布脚本仍走确定性 Mock。然后重新运行发布脚本，在浏览器登录后通过页面执行一次最多 16 Token 的受限真实请求，并在管理员请求日志中核对通用 User 归属及 `authProvider`。命令行调用若没有用户 Session 会按设计返回 `401`；如需复验 SSE，使用上一节的隐藏 Cookie 输入方式，不要把 Cookie 或 Key 写在命令行：

```bash
read -r -s SMOKE_USER_SESSION_TOKEN
export SMOKE_USER_SESSION_TOKEN
SMOKE_MODEL_ALIAS=kimi ./infra/scripts/smoke-production.sh "https://<域名>"
unset SMOKE_USER_SESSION_TOKEN
```

输出必须包含正文、usage 和唯一 `data: [DONE]`。不要在命令行参数、日志或聊天中直接填写 Key。

## 9. 日志与诊断

```bash
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 nginx web api
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 migrate postgres redis
```

所有容器使用 `json-file` 日志驱动，单文件上限 `10m`、最多保留 5 个压缩分片。不要把 `docker compose logs` 的完整输出发布到公开 Issue，其中可能包含完整 Prompt。

## 10. 手工备份与保留

已有 PostgreSQL 的环境部署通用 User migration 前，即使发布脚本稍后还会自动备份，也必须先手工创建一个明确的认证迁移前恢复点，并记录其路径、应用 commit 和当前 migration 列表。该 migration 会按已接受的方案清空旧 User 及级联业务数据；全新且尚未创建数据库的首次部署没有可备份数据，可以跳过：

```bash
ENV_FILE="$ENV_FILE" ./infra/scripts/postgres-backup.sh
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -ec '
  PGPASSWORD="$POSTGRES_PASSWORD" psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
    --command="SELECT migration_name, finished_at FROM \"_prisma_migrations\" ORDER BY finished_at"
'
```

备份默认保存在仓库根目录 `backups/`，目录权限为 `0700`，归档权限为 `0600`。脚本使用 `pg_restore --list` 验证归档后才原子改名。Redis 仅保存可重建限流状态，不备份。

`generalize_user_auth_providers` 会用 provider-neutral 字段替换 GitHub 专属字段，并清空现有 User 及其级联业务数据，不尝试兼容或推断历史身份。执行 migration 前必须确认现有数据可丢弃并已创建恢复点；若生产数据需要保留，必须停止发布并另行设计显式迁移。

生产至少保留：

- ECS 本机最近 7 个成功备份。
- 另一故障域中的加密副本，例如开启服务端加密和访问控制的 OSS 私有 Bucket。
- 每月抽取一个备份在隔离环境完成实际恢复演练；只通过 `pg_restore --list` 不等于恢复演练。

## 11. 应用版本回滚

如果新版本冒烟失败且数据库迁移向后兼容：

1. 保存失败版本的 `docker compose ps` 和相关日志。
2. `git checkout <上一个已验收 commit SHA>`。
3. 将 `.env.production` 的 `APP_VERSION` 改为该 SHA。
4. 重新执行 `deploy-production.sh`。
5. 重新执行 IP、域名、health、SSE 和持久化验收。

不要使用 `git reset --hard` 清理服务器；部署脚本会拒绝脏工作区，应先人工确认变更来源。

通用 User migration 与旧 GitHub 专属结构不向后兼容，不能只切回旧镜像。若必须回到认证上线前版本：

1. 立即停止 Nginx/API，阻止继续写入带用户归属的新请求。
2. 为当前失败状态再做一次备份，保留故障调查和人工数据提取能力。
3. 明确确认恢复认证迁移前备份会丢弃其后的 `User`、`UserSession` 和请求数据。
4. 使用下一节的恢复脚本恢复迁移前备份，再 checkout 与该备份匹配的 commit。
5. 完整验收后才重新开放入口。

不存在自动 down migration，也不得通过手工删除用户外键来伪造回滚。

## 12. 数据库恢复

仅在迁移不兼容或数据损坏时恢复数据库。先确认备份文件和目标应用版本匹配：

```bash
CONFIRM_RESTORE=YES \
ENV_FILE="$ENV_FILE" \
./infra/scripts/postgres-restore.sh backups/<backup>.dump
```

恢复脚本会先验证归档，再停止 Nginx/API，使用 `--clean --if-exists` 覆盖当前数据库并执行连通性检查。无论成功或失败，都不会自动重新开放公网入口。

恢复成功后：

1. checkout 与备份匹配的应用 commit。
2. 更新 `.env.production` 的 `APP_VERSION`。
3. 执行 `deploy-production.sh`。
4. 完成全部发布验收后才恢复对外服务。

## 13. 停止与重启

停止应用但保留 PostgreSQL 数据卷：

```bash
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down
```

不要执行 `down -v`，除非已经完成可恢复备份并明确需要删除全部生产数据。重启仍使用发布脚本，确保迁移、备份和冒烟门禁不被绕过。
