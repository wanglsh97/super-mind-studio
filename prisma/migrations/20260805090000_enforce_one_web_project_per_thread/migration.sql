-- Collapse any pre-constraint duplicate website rows to the most recently updated
-- result. Deleting Creation cascades to its WebProject and CreationAsset metadata;
-- the corresponding OSS objects remain covered by the bucket lifecycle.
WITH ranked AS (
  SELECT
    "creationId",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "agentThreadId"
      ORDER BY "updatedAt" DESC, "id" DESC
    ) AS position
  FROM "WebProject"
  WHERE "agentThreadId" IS NOT NULL
)
DELETE FROM "Creation"
USING ranked
WHERE "Creation"."id" = ranked."creationId"
  AND ranked.position > 1;

-- A Thread has at most one mutable website projection. PostgreSQL permits multiple
-- NULL values here, so rows without a Thread remain valid.
CREATE UNIQUE INDEX "WebProject_userId_agentThreadId_key"
ON "WebProject"("userId", "agentThreadId");
