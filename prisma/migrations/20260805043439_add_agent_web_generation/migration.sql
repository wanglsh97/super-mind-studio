-- CreateEnum
CREATE TYPE "CreationType" AS ENUM ('WEBSITE', 'IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "CreationStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WebProjectStatus" AS ENUM ('PENDING', 'GENERATING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CreationAssetKind" AS ENUM ('SOURCE_ZIP', 'DIST_ZIP', 'PREVIEW', 'IMAGE', 'VIDEO');

-- CreateTable
CREATE TABLE "Creation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "CreationType" NOT NULL,
    "status" "CreationStatus" NOT NULL DEFAULT 'PENDING',
    "title" VARCHAR(200) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "imageTaskId" UUID,

    CONSTRAINT "Creation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebProject" (
    "id" UUID NOT NULL,
    "creationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "agentThreadId" UUID,
    "agentRunId" UUID,
    "status" "WebProjectStatus" NOT NULL DEFAULT 'PENDING',
    "framework" VARCHAR(64),
    "buildCommand" VARCHAR(512),
    "outputDir" VARCHAR(256),
    "errorCode" VARCHAR(64),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WebProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreationAsset" (
    "id" UUID NOT NULL,
    "creationId" UUID NOT NULL,
    "kind" "CreationAssetKind" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(255) NOT NULL,
    "objectKey" VARCHAR(1024) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" CHAR(64),
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreationAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Creation_imageTaskId_key" ON "Creation"("imageTaskId");

-- CreateIndex
CREATE INDEX "Creation_userId_createdAt_idx" ON "Creation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Creation_userId_type_createdAt_idx" ON "Creation"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Creation_expiresAt_idx" ON "Creation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebProject_creationId_key" ON "WebProject"("creationId");

-- CreateIndex
CREATE INDEX "WebProject_userId_createdAt_idx" ON "WebProject"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WebProject_agentThreadId_idx" ON "WebProject"("agentThreadId");

-- CreateIndex
CREATE INDEX "WebProject_agentRunId_idx" ON "WebProject"("agentRunId");

-- CreateIndex
CREATE UNIQUE INDEX "CreationAsset_objectKey_key" ON "CreationAsset"("objectKey");

-- CreateIndex
CREATE INDEX "CreationAsset_creationId_kind_idx" ON "CreationAsset"("creationId", "kind");

-- CreateIndex
CREATE INDEX "CreationAsset_expiresAt_idx" ON "CreationAsset"("expiresAt");

-- AddForeignKey
ALTER TABLE "Creation" ADD CONSTRAINT "Creation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creation" ADD CONSTRAINT "Creation_imageTaskId_fkey" FOREIGN KEY ("imageTaskId") REFERENCES "ImageGenerationTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebProject" ADD CONSTRAINT "WebProject_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "Creation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebProject" ADD CONSTRAINT "WebProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreationAsset" ADD CONSTRAINT "CreationAsset_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "Creation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
