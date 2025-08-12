/*
  Warnings:

  - You are about to drop the column `file_churn_data` on the `activity_data` table. All the data in the column will be lost.
  - You are about to drop the column `total_files_analyzed` on the `activity_data` table. All the data in the column will be lost.
  - Added the required column `activity_factors` to the `activity_data` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "activity_data" DROP COLUMN "file_churn_data",
DROP COLUMN "total_files_analyzed",
ADD COLUMN     "activity_factors" JSONB NOT NULL;
