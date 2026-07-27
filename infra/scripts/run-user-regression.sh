#!/bin/sh
set -eu

test_database_url=$(node -e "require('dotenv').config({quiet:true}); const url=new URL(process.env.DATABASE_URL); url.pathname='/aigateway_test'; url.searchParams.delete('schema'); process.stdout.write(url.toString())")

DATABASE_URL="$test_database_url" TEST_DATABASE_URL="$test_database_url" \
  corepack pnpm --filter @supermind/api test:e2e -- \
  chat/chat.e2e-spec.ts \
  chat/chat-compare.e2e-spec.ts \
  image/image.e2e-spec.ts \
  prompt/prompt.e2e-spec.ts \
  admin/admin-privacy.e2e-spec.ts
