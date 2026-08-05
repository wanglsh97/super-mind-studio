ALTER TABLE "WebProject"
ADD CONSTRAINT "WebProject_agentThreadId_fkey"
FOREIGN KEY ("agentThreadId") REFERENCES "AgentThread"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WebProject"
ADD CONSTRAINT "WebProject_agentRunId_fkey"
FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
