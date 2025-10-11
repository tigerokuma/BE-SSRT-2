/*
  Warnings:

  - You are about to drop the `watchlist_dependencies` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."watchlist_dependencies" DROP CONSTRAINT "watchlist_dependencies_project_id_fkey";

-- DropTable
DROP TABLE "public"."watchlist_dependencies";
