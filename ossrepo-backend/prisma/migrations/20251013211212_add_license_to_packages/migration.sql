-- AlterTable
ALTER TABLE "public"."Packages" ADD COLUMN     "license" TEXT;

-- Set existing packages to MIT license
UPDATE "public"."Packages" SET "license" = 'MIT' WHERE "license" IS NULL;
