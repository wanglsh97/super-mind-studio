#!/bin/sh
set -eu

if rg -n 'https?://|localhost|127\.0\.0\.1|API_INTERNAL_URL' apps/web/src \
  --glob '!**/*.spec.ts' \
  --glob '!**/*.svg'; then
  echo 'Public Web source contains a non-same-origin endpoint' >&2
  exit 1
fi

rg -q "source: '/api/:path\\*'" apps/web/next.config.ts
rg -q 'destination:.*apiInternalUrl.*\/api\/:path' apps/web/next.config.ts
rg -q 'API_INTERNAL_URL: http://api:3001' infra/compose/compose.prod.yml

if rg -n 'https?://(localhost|127\.0\.0\.1|api:3001)' apps/web/.next/static; then
  echo 'Browser bundle contains an internal API endpoint' >&2
  exit 1
fi

echo 'Web browser bundle uses same-origin /api; API_INTERNAL_URL remains server-side only.'
