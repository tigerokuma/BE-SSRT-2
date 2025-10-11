/*
  Warnings:

  - You are about to drop the `project_dependencies` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."project_dependencies" DROP CONSTRAINT "project_dependencies_project_id_fkey";

-- DropTable
DROP TABLE "public"."project_dependencies";

-- CreateTable
CREATE TABLE "public"."branch_dependencies" (
    "id" TEXT NOT NULL,
    "monitored_branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_dependencies_monitored_branch_id_idx" ON "public"."branch_dependencies"("monitored_branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_dependencies_monitored_branch_id_name_key" ON "public"."branch_dependencies"("monitored_branch_id", "name");

-- AddForeignKey
ALTER TABLE "public"."branch_dependencies" ADD CONSTRAINT "branch_dependencies_monitored_branch_id_fkey" FOREIGN KEY ("monitored_branch_id") REFERENCES "public"."monitored_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
