#!/usr/bin/env sh
set -eu

if [ -z "${TEST_DATABASE_URL:-}" ]; then
  echo "TEST_DATABASE_URL 未设置，无法运行 Mock Chat 数据库回归。" >&2
  exit 1
fi

case "$TEST_DATABASE_URL" in
  *_test*|*test_*) ;;
  *)
    echo "TEST_DATABASE_URL 必须包含 _test 或 test_，拒绝使用非测试数据库。" >&2
    exit 1
    ;;
esac

unset QWEN_API_KEY GLM_API_KEY DEEPSEEK_API_KEY KIMI_API_KEY
unset QWEN_ENABLED GLM_ENABLED DEEPSEEK_ENABLED KIMI_ENABLED
export NODE_ENV=test
export MOCK_PROVIDER_ENABLED=true
export DATABASE_URL="$TEST_DATABASE_URL"

corepack pnpm db:generate
corepack pnpm db:migrate:deploy
corepack pnpm --filter @supermind/sdk test
corepack pnpm --filter @supermind/api test
corepack pnpm test:e2e
corepack pnpm --filter @supermind/web test
corepack pnpm --filter @supermind/sdk build
corepack pnpm --filter @supermind/web build
