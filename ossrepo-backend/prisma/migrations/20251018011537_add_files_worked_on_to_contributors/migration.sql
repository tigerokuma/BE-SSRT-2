/*
  Warnings:

  - Added the required column `files_worked_on` to the `package_contributors` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."package_contributors" ADD COLUMN     "files_worked_on" JSONB;

-- Update existing rows with default empty object
UPDATE "public"."package_contributors" SET "files_worked_on" = '{}' WHERE "files_worked_on" IS NULL;

-- Make the column NOT NULL after setting defaults
ALTER TABLE "public"."package_contributors" ALTER COLUMN "files_worked_on" SET NOT NULL;
