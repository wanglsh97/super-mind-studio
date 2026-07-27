DROP INDEX IF EXISTS "AgentRun_sandboxId_key";

ALTER TABLE "AgentThread"
ADD COLUMN "sandboxId" VARCHAR(191),
ADD COLUMN "sandboxStatus" VARCHAR(32),
ADD COLUMN "sandboxCreatedAt" TIMESTAMPTZ(3),
ADD COLUMN "sandboxLastUsedAt" TIMESTAMPTZ(3),
ADD COLUMN "sandboxExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN "sandboxDestroyedAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "AgentThread_sandboxId_key" ON "AgentThread"("sandboxId");
CREATE INDEX "AgentThread_sandboxExpiresAt_idx" ON "AgentThread"("sandboxExpiresAt");
CREATE INDEX "AgentRun_sandboxId_idx" ON "AgentRun"("sandboxId");
