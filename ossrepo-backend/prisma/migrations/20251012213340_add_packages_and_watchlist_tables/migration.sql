/*
  Warnings:

  - You are about to drop the `project_watchlist_approvals` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `project_watchlist_comments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `project_watchlist_disapprovals` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."project_watchlist_approvals" DROP CONSTRAINT "project_watchlist_approvals_project_watchlist_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."project_watchlist_approvals" DROP CONSTRAINT "project_watchlist_approvals_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."project_watchlist_comments" DROP CONSTRAINT "project_watchlist_comments_project_watchlist_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."project_watchlist_comments" DROP CONSTRAINT "project_watchlist_comments_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."project_watchlist_disapprovals" DROP CONSTRAINT "project_watchlist_disapprovals_project_watchlist_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."project_watchlist_disapprovals" DROP CONSTRAINT "project_watchlist_disapprovals_user_id_fkey";

-- DropTable
DROP TABLE "public"."project_watchlist_approvals";

-- DropTable
DROP TABLE "public"."project_watchlist_comments";

-- DropTable
DROP TABLE "public"."project_watchlist_disapprovals";

-- CreateTable
CREATE TABLE "public"."Packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "repo_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "activity_score" DOUBLE PRECISION,
    "bus_factor_score" DOUBLE PRECISION,
    "scorecard_score" DOUBLE PRECISION,
    "vulnerability_score" DOUBLE PRECISION,
    "license_score" DOUBLE PRECISION,
    "total_score" DOUBLE PRECISION,
    "stars" INTEGER,
    "contributors" INTEGER,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."project_watchlist_packages" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_watchlist_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Packages_name_key" ON "public"."Packages"("name");

-- CreateIndex
CREATE INDEX "project_watchlist_packages_project_id_idx" ON "public"."project_watchlist_packages"("project_id");

-- CreateIndex
CREATE INDEX "project_watchlist_packages_package_id_idx" ON "public"."project_watchlist_packages"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_watchlist_packages_project_id_package_id_key" ON "public"."project_watchlist_packages"("project_id", "package_id");

-- AddForeignKey
ALTER TABLE "public"."project_watchlist_packages" ADD CONSTRAINT "project_watchlist_packages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_watchlist_packages" ADD CONSTRAINT "project_watchlist_packages_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."Packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
