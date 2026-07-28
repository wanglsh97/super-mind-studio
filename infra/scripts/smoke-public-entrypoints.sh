#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
root_dir="$(CDPATH= cd -- "$script_dir/../.." && pwd)"
env_file="${ENV_FILE:-$root_dir/.env.production}"
public_ip_url="${PUBLIC_IP_BASE_URL:-}"
domain_url="${DOMAIN_BASE_URL:-}"

if [ ! -f "$env_file" ]; then
  echo "生产环境文件不存在：$env_file" >&2
  exit 1
fi
if [ -z "$public_ip_url" ] || [ -z "$domain_url" ]; then
  echo '必须同时设置 PUBLIC_IP_BASE_URL 和 DOMAIN_BASE_URL。' >&2
  exit 1
fi
if [ "$public_ip_url" = "$domain_url" ]; then
  echo '公网 IP 与域名验收 URL 必须是两个独立入口。' >&2
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
  ' "$env_file"
}

assert_env_value() {
  key="$1"
  expected="$2"
  actual="$(env_value "$key")" || {
    echo "$key 必须在生产环境文件中出现且只能出现一次。" >&2
    exit 1
  }
  if [ "$actual" != "$expected" ]; then
    echo "首次公网验收要求 $key=$expected，当前为 $actual。" >&2
    exit 1
  fi
}

assert_env_value MOCK_PROVIDER_ENABLED true
for provider in QWEN GLM DEEPSEEK KIMI; do
  assert_env_value "${provider}_ENABLED" false
done

SMOKE_MODEL_ALIAS=qwen "$script_dir/smoke-production.sh" "$public_ip_url"
SMOKE_MODEL_ALIAS=qwen "$script_dir/smoke-production.sh" "$domain_url"

printf 'public_entrypoints_smoke=ok ip=%s domain=%s mode=mock-only\n' \
  "$public_ip_url" "$domain_url"
