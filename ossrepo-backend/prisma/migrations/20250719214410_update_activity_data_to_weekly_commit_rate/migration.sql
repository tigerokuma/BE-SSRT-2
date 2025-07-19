/*
  Warnings:

  - You are about to drop the column `total_commits` on the `activity_data` table. All the data in the column will be lost.
  - Added the required column `weekly_commit_rate` to the `activity_data` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "activity_data" DROP COLUMN "total_commits",
ADD COLUMN     "weekly_commit_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.00;
