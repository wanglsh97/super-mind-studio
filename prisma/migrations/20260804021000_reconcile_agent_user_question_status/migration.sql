-- Repair question batches left pending by cancelled/interrupted runs created before
-- cancellation and startup cleanup updated question state transactionally.
UPDATE "AgentUserQuestion" AS question
SET
    "status" = CASE
        WHEN run."status" = 'CANCELLED' THEN 'CANCELLED'::"AgentUserQuestionStatus"
        ELSE 'INTERRUPTED'::"AgentUserQuestionStatus"
    END,
    "settledAt" = COALESCE(run."completedAt", CURRENT_TIMESTAMP)
FROM "AgentRun" AS run
WHERE question."runId" = run."id"
  AND question."status" = 'PENDING'
  AND run."status" NOT IN ('RUNNING', 'CANCELLING', 'WAITING_FOR_USER');
