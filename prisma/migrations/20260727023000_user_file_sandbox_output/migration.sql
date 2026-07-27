ALTER TABLE "UserFile"
ADD COLUMN "sandboxPath" VARCHAR(1024);

CREATE UNIQUE INDEX "UserFile_runId_direction_sandboxPath_key"
ON "UserFile"("runId", "direction", "sandboxPath");
