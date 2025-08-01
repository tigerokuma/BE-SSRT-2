/*
  Warnings:

  - Added the required column `total_commits` to the `bus_factor_data` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "bus_factor_data" ADD COLUMN     "total_commits" INTEGER NOT NULL DEFAULT 0;

-- Update existing records to calculate total_commits from top_contributors
UPDATE "bus_factor_data" 
SET "total_commits" = (
  SELECT COALESCE(SUM((value->>'totalCommits')::INTEGER), 0)
  FROM jsonb_array_elements("top_contributors") AS value
)
WHERE "total_commits" = 0;
