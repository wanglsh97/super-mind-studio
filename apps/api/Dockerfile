FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
ENV npm_config_registry=https://registry.npmmirror.com

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global pnpm@10.34.5 \
    && pnpm --version

WORKDIR /app

FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json prisma.config.ts ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/sdk/package.json packages/sdk/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/sdk packages/sdk
COPY prisma prisma

RUN DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5432/prisma pnpm --filter @supermind/api... build
RUN pnpm --filter @supermind/api deploy --prod --legacy /prod/api

FROM build AS migration

ENV NODE_ENV=production

USER node

CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV API_PORT=3001

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build --chown=node:node /prod/api ./
COPY --from=build --chown=node:node /app/apps/api/skills ./skills

USER node

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:3001/health/live').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "--import", "./dist/observability/instrumentation.js", "dist/main.js"]
