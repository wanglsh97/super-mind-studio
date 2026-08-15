FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
ENV npm_config_registry=https://registry.npmmirror.com

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global pnpm@10.34.5 \
    && pnpm --version

WORKDIR /app

FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/migration-runtime/package.json packages/migration-runtime/package.json
COPY packages/sdk/package.json packages/sdk/package.json

RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/sdk packages/sdk

ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=$API_INTERNAL_URL

RUN pnpm --filter @supermind/web... build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "apps/web/server.js"]
