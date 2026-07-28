-- This change intentionally does not preserve the GitHub-specific User data model.
-- The product decision allows resetting all User-owned data before this migration.
TRUNCATE TABLE "User" CASCADE;

CREATE TYPE "AuthProvider" AS ENUM ('ANONYMOUS', 'GITHUB', 'GOOGLE');

DROP INDEX "User_githubId_key";
DROP INDEX "User_githubUsername_idx";

ALTER TABLE "User"
  DROP COLUMN "githubId",
  DROP COLUMN "githubUsername",
  DROP COLUMN "displayName",
  ADD COLUMN "authProvider" "AuthProvider" NOT NULL,
  ADD COLUMN "providerUserId" VARCHAR(255) NOT NULL,
  ADD COLUMN "userName" VARCHAR(255) NOT NULL;

CREATE UNIQUE INDEX "User_authProvider_providerUserId_key"
ON "User"("authProvider", "providerUserId");

CREATE INDEX "User_userName_idx" ON "User"("userName");
