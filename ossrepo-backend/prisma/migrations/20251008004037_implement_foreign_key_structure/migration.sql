/*
  Warnings:

  - You are about to drop the column `project_id` on the `monitored_branches` table. All the data in the column will be lost.
  - You are about to drop the column `branch` on the `projects` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[repository_url,branch_name]` on the table `monitored_branches` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `repository_url` to the `monitored_branches` table without a default value. This is not possible if the table is not empty.
  - Added the required column `monitored_branch_id` to the `projects` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."monitored_branches" DROP CONSTRAINT "monitored_branches_project_id_fkey";

-- DropIndex
DROP INDEX "public"."monitored_branches_project_id_branch_name_key";

-- DropIndex
DROP INDEX "public"."monitored_branches_project_id_idx";

-- AlterTable
ALTER TABLE "public"."monitored_branches" DROP COLUMN "project_id",
ADD COLUMN     "repository_url" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."projects" DROP COLUMN "branch",
ADD COLUMN     "monitored_branch_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "monitored_branches_repository_url_idx" ON "public"."monitored_branches"("repository_url");

-- CreateIndex
CREATE UNIQUE INDEX "monitored_branches_repository_url_branch_name_key" ON "public"."monitored_branches"("repository_url", "branch_name");

-- AddForeignKey
ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_monitored_branch_id_fkey" FOREIGN KEY ("monitored_branch_id") REFERENCES "public"."monitored_branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
