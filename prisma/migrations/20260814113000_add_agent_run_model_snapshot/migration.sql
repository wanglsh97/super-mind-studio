ALTER TABLE "AgentRun"
ADD COLUMN "modelId" VARCHAR(128),
ADD COLUMN "provider" VARCHAR(64);

UPDATE "AgentRun" AS run
SET
  "modelId" = thread."modelId",
  "provider" = thread."provider"
FROM "AgentThread" AS thread
WHERE run."threadId" = thread."id";

ALTER TABLE "AgentRun"
ALTER COLUMN "modelId" SET NOT NULL,
ALTER COLUMN "provider" SET NOT NULL;

CREATE INDEX "AgentRun_modelId_createdAt_idx" ON "AgentRun"("modelId", "createdAt");
