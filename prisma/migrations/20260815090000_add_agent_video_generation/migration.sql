ALTER TYPE "RequestCapability" ADD VALUE IF NOT EXISTS 'VIDEO';
ALTER TYPE "CreationType" ADD VALUE IF NOT EXISTS 'VIDEO';
ALTER TYPE "CreationStatus" ADD VALUE IF NOT EXISTS 'DELETING';
ALTER TYPE "CreationAssetKind" ADD VALUE IF NOT EXISTS 'VIDEO';

CREATE TYPE "VideoTaskStatus" AS ENUM ('PENDING','SUBMITTING','RUNNING','PERSISTING','SUCCEEDED','FAILED','TIMED_OUT','CANCELLED','EXPIRED');

ALTER TABLE "AgentThread" ADD COLUMN "preferredMode" VARCHAR(32), ADD COLUMN "videoModelBinding" VARCHAR(128);
ALTER TABLE "Creation" ADD COLUMN "videoTaskId" UUID, ADD COLUMN "parentCreationId" UUID;

CREATE TABLE "VideoGenerationTask" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "taskId" UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "requestLogId" UUID NOT NULL UNIQUE, "userId" UUID NOT NULL, "threadId" UUID NOT NULL,
  "agentRunId" UUID, "agentToolCallId" UUID UNIQUE, "parentVideoTaskId" UUID,
  "videoId" UUID UNIQUE, "idempotencyKey" VARCHAR(191) NOT NULL UNIQUE,
  "prompt" TEXT NOT NULL, "effectivePrompt" TEXT NOT NULL, "inputMode" VARCHAR(32) NOT NULL,
  "referenceImageId" UUID, "options" JSONB, "candidateAudit" JSONB,
  "provider" VARCHAR(64), "resolvedModel" VARCHAR(128), "providerTaskId" VARCHAR(191),
  "status" "VideoTaskStatus" NOT NULL DEFAULT 'PENDING', "providerFinalStatus" VARCHAR(32),
  "providerResultUrl" TEXT, "nextPollAt" TIMESTAMPTZ(3), "lastPolledAt" TIMESTAMPTZ(3),
  "pollAttempts" INTEGER NOT NULL DEFAULT 0, "leaseOwner" VARCHAR(191), "leaseExpiresAt" TIMESTAMPTZ(3),
  "sandboxId" VARCHAR(191), "sandboxPath" TEXT, "sandboxExpiresAt" TIMESTAMPTZ(3),
  "mimeType" VARCHAR(255), "sizeBytes" BIGINT, "sha256" CHAR(64), "durationSeconds" INTEGER,
  "width" INTEGER, "height" INTEGER, "audio" BOOLEAN, "priceVersion" VARCHAR(64),
  "estimatedCostCny" DECIMAL(18,8), "costEstimated" BOOLEAN NOT NULL DEFAULT TRUE,
  "errorCode" VARCHAR(64), "errorMessage" TEXT, "cancelledAt" TIMESTAMPTZ(3),
  "timedOutAt" TIMESTAMPTZ(3), "startedAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "VideoGenerationTask_requestLogId_fkey" FOREIGN KEY ("requestLogId") REFERENCES "RequestLog"("id") ON DELETE CASCADE,
  CONSTRAINT "VideoGenerationTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "VideoGenerationTask_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE,
  CONSTRAINT "VideoGenerationTask_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL,
  CONSTRAINT "VideoGenerationTask_agentToolCallId_fkey" FOREIGN KEY ("agentToolCallId") REFERENCES "AgentToolCall"("id") ON DELETE SET NULL,
  CONSTRAINT "VideoGenerationTask_parentVideoTaskId_fkey" FOREIGN KEY ("parentVideoTaskId") REFERENCES "VideoGenerationTask"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "VideoGenerationTask_provider_providerTaskId_key" ON "VideoGenerationTask"("provider","providerTaskId");
CREATE INDEX "VideoGenerationTask_status_nextPollAt_leaseExpiresAt_idx" ON "VideoGenerationTask"("status","nextPollAt","leaseExpiresAt");
CREATE INDEX "VideoGenerationTask_userId_createdAt_idx" ON "VideoGenerationTask"("userId","createdAt");
CREATE UNIQUE INDEX "Creation_videoTaskId_key" ON "Creation"("videoTaskId");
ALTER TABLE "Creation" ADD CONSTRAINT "Creation_videoTaskId_fkey" FOREIGN KEY ("videoTaskId") REFERENCES "VideoGenerationTask"("id") ON DELETE SET NULL;
ALTER TABLE "Creation" ADD CONSTRAINT "Creation_parentCreationId_fkey" FOREIGN KEY ("parentCreationId") REFERENCES "Creation"("id") ON DELETE SET NULL;

CREATE TABLE "VideoInputAsset" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "userId" UUID NOT NULL, "threadId" UUID NOT NULL,
  "sandboxId" VARCHAR(191) NOT NULL, "sandboxPath" TEXT NOT NULL, "name" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(64) NOT NULL, "sizeBytes" BIGINT NOT NULL, "sha256" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VideoInputAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "VideoInputAsset_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE
);
CREATE INDEX "VideoInputAsset_userId_threadId_createdAt_idx" ON "VideoInputAsset"("userId","threadId","createdAt");
CREATE INDEX "VideoInputAsset_expiresAt_idx" ON "VideoInputAsset"("expiresAt");
