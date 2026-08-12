#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="$ROOT_DIR/infra/compose/compose.prod.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "生产环境文件不存在：$ENV_FILE" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Engine 或 Compose plugin 不可用。' >&2
  exit 1
fi

env_value() {
  key="$1"
  awk -v key="$key" '
    index($0, key "=") == 1 { count += 1; value = substr($0, length(key) + 2) }
    END {
      if (count != 1) exit 2
      print value
    }
  ' "$ENV_FILE"
}

app_version="$(env_value APP_VERSION)" || {
  echo 'APP_VERSION 必须在生产环境文件中出现且只能出现一次。' >&2
  exit 1
}
http_port="$(env_value HTTP_PORT)" || {
  echo 'HTTP_PORT 必须在生产环境文件中出现且只能出现一次。' >&2
  exit 1
}
smoke_model_alias="$(env_value SMOKE_MODEL_ALIAS)" || {
  echo 'SMOKE_MODEL_ALIAS 必须在生产环境文件中出现且只能出现一次。' >&2
  exit 1
}
sandbox_image="$(env_value OPEN_SANDBOX_IMAGE)" || {
  echo 'OPEN_SANDBOX_IMAGE 必须在生产环境文件中出现且只能出现一次。' >&2
  exit 1
}
skill_object_store_driver="$(env_value SKILL_OBJECT_STORE_DRIVER)" || {
  echo 'SKILL_OBJECT_STORE_DRIVER 必须在生产环境文件中出现且只能出现一次。' >&2
  exit 1
}
oss_region="$(env_value OSS_REGION)" || {
  echo 'OSS_REGION 必须在生产环境文件中出现且只能出现一次。' >&2
  exit 1
}
oss_endpoint="$(env_value OSS_ENDPOINT)" || {
  echo 'OSS_ENDPOINT 必须在生产环境文件中出现且只能出现一次。' >&2
  exit 1
}
oss_internal="$(env_value OSS_INTERNAL)" || {
  echo 'OSS_INTERNAL 必须在生产环境文件中出现且只能出现一次。' >&2
  exit 1
}
for required_oss_secret in OSS_BUCKET OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET; do
  required_oss_value="$(env_value "$required_oss_secret")" || {
    echo "$required_oss_secret 必须在生产环境文件中出现且只能出现一次。" >&2
    exit 1
  }
  if [ -z "$required_oss_value" ]; then
    echo "$required_oss_secret 不能为空。" >&2
    exit 1
  fi
done

case "$app_version" in
  '' | *[!0-9a-f]*)
    echo 'APP_VERSION 必须是当前 Git commit SHA。' >&2
    exit 1
    ;;
esac
if [ "${#app_version}" -lt 7 ] || [ "${#app_version}" -gt 40 ]; then
  echo 'APP_VERSION 必须是 7～40 位 Git commit SHA。' >&2
  exit 1
fi
case "$http_port" in
  '' | *[!0-9]*)
    echo 'HTTP_PORT 必须是数字。' >&2
    exit 1
    ;;
esac
if [ "$http_port" -lt 1 ] || [ "$http_port" -gt 65535 ]; then
  echo 'HTTP_PORT 必须在 1～65535 之间。' >&2
  exit 1
fi
case "$smoke_model_alias" in
  qwen | glm | deepseek | kimi) ;;
  *)
    echo 'SMOKE_MODEL_ALIAS 必须是 qwen、glm、deepseek 或 kimi。' >&2
    exit 1
    ;;
esac
if [ "$skill_object_store_driver" != 'oss' ]; then
  echo '生产环境 SKILL_OBJECT_STORE_DRIVER 必须为 oss。' >&2
  exit 1
fi
if [ -z "$oss_region" ]; then
  echo 'OSS_REGION 不能为空。' >&2
  exit 1
fi
case "$oss_endpoint" in
  https://*) ;;
  *)
    echo 'OSS_ENDPOINT 必须是浏览器可访问的公网 HTTPS Endpoint。' >&2
    exit 1
    ;;
esac
if [ "$oss_internal" != 'false' ]; then
  echo '浏览器直传 Skill 包要求 OSS_INTERNAL=false。' >&2
  exit 1
fi
case "$sandbox_image" in
  *.aliyuncs.com/*:* ) ;;
  *)
    echo 'OPEN_SANDBOX_IMAGE 必须是带版本 tag 的阿里云 ACR 镜像地址。' >&2
    exit 1
    ;;
esac

cd "$ROOT_DIR"

head_sha="$(git rev-parse HEAD)"
case "$head_sha" in
  "$app_version"*) ;;
  *)
    echo "APP_VERSION 与当前 commit 不一致：$app_version != $head_sha" >&2
    exit 1
    ;;
esac

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo '工作区存在未提交变更，拒绝生产发布。' >&2
  exit 1
fi

compose() {
  # 单机 ECS 磁盘空间有限，禁止 Compose 并行构建多个 Node 镜像，
  # 避免 Next standalone 复制依赖时因 BuildKit 临时层耗尽空间。
  COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

nginx_was_running=0
if compose ps --status running --services 2>/dev/null | grep -qx nginx; then
  nginx_was_running=1
fi

enter_maintenance_mode() {
  echo '切换至发布维护页。'
  MAINTENANCE_MODE=on compose up -d --no-deps --force-recreate nginx
}

leave_maintenance_mode() {
  echo '恢复应用入口。'
  MAINTENANCE_MODE=off compose up -d --no-deps --force-recreate nginx
}

wait_for_readiness() {
  attempt=1
  while [ "$attempt" -le 60 ]; do
    if curl --fail --silent --show-error --max-time 5 \
      "http://127.0.0.1:$http_port/health/ready" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
    attempt=$((attempt + 1))
  done
  return 1
}

reset_tempo_trace_storage() {
  echo '发布前重置 Tempo 诊断 Trace 存储（仅 tempo-data，不影响 PostgreSQL）。'
  compose stop tempo otel-collector 2>/dev/null || true
  compose rm -f tempo otel-collector 2>/dev/null || true
  compose_project_name="$(awk '/^name: / { print $2; exit }' "$COMPOSE_FILE")"
  tempo_volume="${compose_project_name}_tempo-data"
  if docker volume inspect "$tempo_volume" >/dev/null 2>&1; then
    if ! docker volume rm -f "$tempo_volume"; then
      echo "警告：无法删除 Tempo 卷 ${tempo_volume}，将跳过本次 Trace 存储重置。" >&2
    fi
  fi
}

compose config >/dev/null
compose build web api migrate

if compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo '发布前执行 PostgreSQL 备份。'
  ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/postgres-backup.sh"
else
  echo '首次部署未发现运行中的 PostgreSQL，跳过发布前备份。'
fi

if [ "$nginx_was_running" -eq 1 ]; then
  enter_maintenance_mode
fi

# 业务主链路与 Tempo 解耦：Trace 存储不 ready 不得阻塞发布。
if ! compose up -d --remove-orphans postgres redis migrate api web; then
  if [ "$nginx_was_running" -eq 1 ]; then
    echo '应用启动失败，维护页将继续显示；修复后重新执行发布脚本。' >&2
  fi
  exit 1
fi

reset_tempo_trace_storage
if ! compose up -d --remove-orphans tempo otel-collector; then
  echo '警告：Tempo/otel-collector 启动失败，已继续发布（不影响业务主链路）。' >&2
fi

if [ "$nginx_was_running" -eq 0 ]; then
  leave_maintenance_mode
fi

if ! wait_for_readiness; then
  echo '生产 readiness 在 180 秒内未通过。' >&2
  compose ps >&2 || true
  compose logs --tail=200 migrate api nginx >&2 || true
  exit 1
fi

if [ "$nginx_was_running" -eq 1 ]; then
  leave_maintenance_mode
  if ! wait_for_readiness; then
    echo '关闭维护页后 readiness 在 180 秒内未通过。' >&2
    compose ps >&2 || true
    compose logs --tail=200 nginx api web >&2 || true
    enter_maintenance_mode
    exit 1
  fi
fi

if ! SMOKE_MODEL_ALIAS="$smoke_model_alias" \
  "$SCRIPT_DIR/smoke-production.sh" "http://127.0.0.1:$http_port"; then
  if [ "$nginx_was_running" -eq 1 ]; then
    enter_maintenance_mode
    echo '发布冒烟失败，维护页将继续显示；修复后重新执行发布脚本。' >&2
  fi
  exit 1
fi

compose ps
printf 'production_deploy=ok version=%s\n' "$app_version"
