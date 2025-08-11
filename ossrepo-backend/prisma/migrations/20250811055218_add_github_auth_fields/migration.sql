/*
  Warnings:

  - A unique constraint covering the columns `[github_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "access_token" TEXT,
ADD COLUMN     "github_id" TEXT,
ADD COLUMN     "github_username" TEXT,
ADD COLUMN     "last_login" TIMESTAMP(3),
ADD COLUMN     "refresh_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_github_id_key" ON "public"."users"("github_id");
