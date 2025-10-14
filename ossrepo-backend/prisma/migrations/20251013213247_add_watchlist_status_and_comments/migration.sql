/*
  Warnings:

  - Added the required column `added_by` to the `project_watchlist_packages` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."project_watchlist_packages" ADD COLUMN     "added_by" TEXT NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "public"."watchlist_comments" (
    "id" TEXT NOT NULL,
    "project_watchlist_package_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "watchlist_comments_project_watchlist_package_id_idx" ON "public"."watchlist_comments"("project_watchlist_package_id");

-- AddForeignKey
ALTER TABLE "public"."watchlist_comments" ADD CONSTRAINT "watchlist_comments_project_watchlist_package_id_fkey" FOREIGN KEY ("project_watchlist_package_id") REFERENCES "public"."project_watchlist_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
