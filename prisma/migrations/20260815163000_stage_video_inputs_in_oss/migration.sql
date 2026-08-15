ALTER TABLE "VideoInputAsset"
  ALTER COLUMN "sandboxId" DROP NOT NULL,
  ALTER COLUMN "sandboxPath" DROP NOT NULL,
  ADD COLUMN "objectKey" TEXT;

CREATE INDEX "VideoInputAsset_objectKey_idx" ON "VideoInputAsset"("objectKey");
