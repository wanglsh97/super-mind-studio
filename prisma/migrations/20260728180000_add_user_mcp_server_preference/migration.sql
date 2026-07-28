CREATE TABLE "UserMcpServerPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "serverId" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserMcpServerPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserMcpServerPreference_userId_serverId_key"
ON "UserMcpServerPreference"("userId", "serverId");

CREATE INDEX "UserMcpServerPreference_userId_enabled_idx"
ON "UserMcpServerPreference"("userId", "enabled");

ALTER TABLE "UserMcpServerPreference"
ADD CONSTRAINT "UserMcpServerPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
