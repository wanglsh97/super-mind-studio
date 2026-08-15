-- The creative library supports website and image artifacts only. Abort instead of
-- silently discarding data if an environment has populated the unused enum values.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Creation" WHERE "type" = 'VIDEO') THEN
    RAISE EXCEPTION 'Cannot remove CreationType.VIDEO while video creations exist';
  END IF;
  IF EXISTS (SELECT 1 FROM "CreationAsset" WHERE "kind" = 'VIDEO') THEN
    RAISE EXCEPTION 'Cannot remove CreationAssetKind.VIDEO while video assets exist';
  END IF;
END $$;

ALTER TYPE "CreationType" RENAME TO "CreationType_old";
CREATE TYPE "CreationType" AS ENUM ('WEBSITE', 'IMAGE');
ALTER TABLE "Creation"
  ALTER COLUMN "type" TYPE "CreationType"
  USING ("type"::text::"CreationType");
DROP TYPE "CreationType_old";

ALTER TYPE "CreationAssetKind" RENAME TO "CreationAssetKind_old";
CREATE TYPE "CreationAssetKind" AS ENUM ('SOURCE_ZIP', 'DIST_ZIP', 'PREVIEW', 'IMAGE');
ALTER TABLE "CreationAsset"
  ALTER COLUMN "kind" TYPE "CreationAssetKind"
  USING ("kind"::text::"CreationAssetKind");
DROP TYPE "CreationAssetKind_old";
