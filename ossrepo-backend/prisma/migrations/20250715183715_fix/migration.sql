/*
  Warnings:

  - You are about to drop the column `createdAt` on the `EmailConfirmation` table. All the data in the column will be lost.
  - You are about to drop the column `expiresAt` on the `EmailConfirmation` table. All the data in the column will be lost.
  - You are about to drop the column `emailConfirmed` on the `users` table. All the data in the column will be lost.
  - Added the required column `expires_at` to the `EmailConfirmation` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "EmailConfirmation_expiresAt_idx";

-- AlterTable
ALTER TABLE "EmailConfirmation" DROP COLUMN "createdAt",
DROP COLUMN "expiresAt",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "expires_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "emailConfirmed",
ADD COLUMN     "email_confirmed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "EmailConfirmation_expires_at_idx" ON "EmailConfirmation"("expires_at");
