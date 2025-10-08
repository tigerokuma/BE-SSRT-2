/*
  Warnings:

  - You are about to drop the column `settings` on the `monitored_branches` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."monitored_branches" DROP COLUMN "settings";
