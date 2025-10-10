/*
  Warnings:

  - Added the required column `type` to the `projects` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."projects" DROP CONSTRAINT "projects_monitored_branch_id_fkey";

-- AlterTable
ALTER TABLE "public"."projects" ADD COLUMN     "dependencies" JSONB,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "type" TEXT,
ALTER COLUMN "monitored_branch_id" DROP NOT NULL;

-- Update existing projects to have type 'repo' (since they were created from repositories)
UPDATE "public"."projects" SET "type" = 'repo' WHERE "type" IS NULL;

-- Now make the type column NOT NULL
ALTER TABLE "public"."projects" ALTER COLUMN "type" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_monitored_branch_id_fkey" FOREIGN KEY ("monitored_branch_id") REFERENCES "public"."monitored_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
