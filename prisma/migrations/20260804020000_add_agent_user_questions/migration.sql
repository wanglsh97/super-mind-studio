-- AlterEnum
ALTER TYPE "AgentRunStatus" ADD VALUE 'WAITING_FOR_USER';

-- CreateEnum
CREATE TYPE "AgentUserQuestionStatus" AS ENUM ('PENDING', 'ANSWERED', 'SKIPPED', 'CANCELLED', 'INTERRUPTED');

-- CreateTable
CREATE TABLE "AgentUserQuestion" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "toolCallId" VARCHAR(191) NOT NULL,
    "status" "AgentUserQuestionStatus" NOT NULL DEFAULT 'PENDING',
    "questions" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMPTZ(3),

    CONSTRAINT "AgentUserQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentUserQuestionAnswer" (
    "id" UUID NOT NULL,
    "userQuestionId" UUID NOT NULL,
    "questionItemId" VARCHAR(191) NOT NULL,
    "optionIds" JSONB NOT NULL,
    "customText" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentUserQuestionAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentUserQuestion_runId_toolCallId_key" ON "AgentUserQuestion"("runId", "toolCallId");
CREATE INDEX "AgentUserQuestion_runId_status_idx" ON "AgentUserQuestion"("runId", "status");
CREATE UNIQUE INDEX "AgentUserQuestionAnswer_userQuestionId_questionItemId_key" ON "AgentUserQuestionAnswer"("userQuestionId", "questionItemId");
CREATE INDEX "AgentUserQuestionAnswer_userQuestionId_idx" ON "AgentUserQuestionAnswer"("userQuestionId");
-- At most one pending batch exists per run; settled batches remain as audit history.
CREATE UNIQUE INDEX "AgentUserQuestion_one_pending_per_run" ON "AgentUserQuestion"("runId") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "AgentUserQuestion" ADD CONSTRAINT "AgentUserQuestion_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentUserQuestionAnswer" ADD CONSTRAINT "AgentUserQuestionAnswer_userQuestionId_fkey"
FOREIGN KEY ("userQuestionId") REFERENCES "AgentUserQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
