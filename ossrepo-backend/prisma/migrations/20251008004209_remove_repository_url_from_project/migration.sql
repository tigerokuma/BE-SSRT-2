/*
  Warnings:

  - You are about to drop the column `repository_url` on the `projects` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."projects" DROP COLUMN "repository_url";
