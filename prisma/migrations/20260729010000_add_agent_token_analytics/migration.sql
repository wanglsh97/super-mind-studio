CREATE TYPE "AgentInvocationStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TYPE "AgentInvocationAttributionKind" AS ENUM ('SKILL', 'TOOL');

CREATE TABLE "AgentModelInvocation" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "requestLogId" UUID NOT NULL,
    "agentRunId" UUID,
    "userId" UUID NOT NULL,
    "status" "AgentInvocationStatus" NOT NULL,
    "provider" VARCHAR(64),
    "resolvedModel" VARCHAR(128),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "usageUnknown" BOOLEAN NOT NULL DEFAULT true,
    "cacheUsageAvailable" BOOLEAN NOT NULL DEFAULT false,
    "reasoningUsageAvailable" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AgentModelInvocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentModelInvocationAttribution" (
    "id" UUID NOT NULL,
    "invocationId" UUID NOT NULL,
    "kind" "AgentInvocationAttributionKind" NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "weight" DECIMAL(10,8) NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentModelInvocationAttribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentModelInvocation_requestId_key"
ON "AgentModelInvocation"("requestId");

CREATE UNIQUE INDEX "AgentModelInvocation_requestLogId_key"
ON "AgentModelInvocation"("requestLogId");

CREATE INDEX "AgentModelInvocation_userId_completedAt_idx"
ON "AgentModelInvocation"("userId", "completedAt");

CREATE INDEX "AgentModelInvocation_resolvedModel_completedAt_idx"
ON "AgentModelInvocation"("resolvedModel", "completedAt");

CREATE INDEX "AgentModelInvocation_completedAt_idx"
ON "AgentModelInvocation"("completedAt");

CREATE UNIQUE INDEX "AgentModelInvocationAttribution_invocationId_kind_name_key"
ON "AgentModelInvocationAttribution"("invocationId", "kind", "name");

CREATE INDEX "AgentModelInvocationAttribution_kind_name_idx"
ON "AgentModelInvocationAttribution"("kind", "name");

ALTER TABLE "AgentModelInvocation"
ADD CONSTRAINT "AgentModelInvocation_requestLogId_fkey"
FOREIGN KEY ("requestLogId") REFERENCES "RequestLog"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentModelInvocation"
ADD CONSTRAINT "AgentModelInvocation_agentRunId_fkey"
FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentModelInvocation"
ADD CONSTRAINT "AgentModelInvocation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentModelInvocationAttribution"
ADD CONSTRAINT "AgentModelInvocationAttribution_invocationId_fkey"
FOREIGN KEY ("invocationId") REFERENCES "AgentModelInvocation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
