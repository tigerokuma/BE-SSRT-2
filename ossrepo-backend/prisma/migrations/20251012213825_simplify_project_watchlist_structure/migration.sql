/*
  Warnings:

  - You are about to drop the `project_watchlist` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."project_watchlist" DROP CONSTRAINT "project_watchlist_project_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."project_watchlist" DROP CONSTRAINT "project_watchlist_user_id_fkey";

-- DropTable
DROP TABLE "public"."project_watchlist";
