ALTER TYPE "ImageTaskStatus" ADD VALUE IF NOT EXISTS 'SUBMITTING';
ALTER TYPE "ImageTaskStatus" ADD VALUE IF NOT EXISTS 'PERSISTING';
ALTER TYPE "ImageTaskStatus" ADD VALUE IF NOT EXISTS 'CANCEL_REQUESTED';
ALTER TYPE "ImageTaskStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "ImageTaskStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "ImageTaskStatus" ADD VALUE IF NOT EXISTS 'SUBMISSION_UNKNOWN';

ALTER TABLE "AgentRun" ADD COLUMN "mode" VARCHAR(32);

ALTER TABLE "AgentToolCall"
  ADD COLUMN "result" JSONB,
  ADD COLUMN "resumeLeaseOwner" VARCHAR(191),
  ADD COLUMN "resumeLeaseExpiresAt" TIMESTAMPTZ(3);

ALTER TABLE "ImageGenerationTask"
  ADD COLUMN "effectivePrompt" TEXT,
  ADD COLUMN "nextPollAt" TIMESTAMPTZ(3),
  ADD COLUMN "pollAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "persistAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseOwner" VARCHAR(191),
  ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "agentRunId" UUID,
  ADD COLUMN "agentToolCallId" UUID,
  ADD COLUMN "parentImageTaskId" UUID,
  ADD COLUMN "imageId" UUID,
  ADD COLUMN "sandboxId" VARCHAR(191),
  ADD COLUMN "sandboxPath" TEXT,
  ADD COLUMN "sandboxExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "mimeType" VARCHAR(255),
  ADD COLUMN "sizeBytes" BIGINT,
  ADD COLUMN "sha256" CHAR(64),
  ADD COLUMN "providerResultUrl" TEXT,
  ADD COLUMN "cancelRequestedAt" TIMESTAMPTZ(3),
  ADD COLUMN "expiredAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "ImageGenerationTask_imageId_key" ON "ImageGenerationTask"("imageId");
CREATE UNIQUE INDEX "ImageGenerationTask_agentToolCallId_key" ON "ImageGenerationTask"("agentToolCallId");
CREATE INDEX "ImageGenerationTask_status_nextPollAt_leaseExpiresAt_idx"
  ON "ImageGenerationTask"("status", "nextPollAt", "leaseExpiresAt");
CREATE INDEX "ImageGenerationTask_agentRunId_idx" ON "ImageGenerationTask"("agentRunId");
CREATE INDEX "ImageGenerationTask_parentImageTaskId_idx" ON "ImageGenerationTask"("parentImageTaskId");

ALTER TABLE "ImageGenerationTask"
  ADD CONSTRAINT "ImageGenerationTask_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ImageGenerationTask_agentToolCallId_fkey"
  FOREIGN KEY ("agentToolCallId") REFERENCES "AgentToolCall"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ImageGenerationTask_parentImageTaskId_fkey"
  FOREIGN KEY ("parentImageTaskId") REFERENCES "ImageGenerationTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
