/*
  Warnings:

  - You are about to drop the column `job_id` on the `EmailTime` table. All the data in the column will be lost.
  - You are about to drop the `Alert` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `next_email_time` to the `EmailTime` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Alert" DROP CONSTRAINT "Alert_id_fkey";

-- DropForeignKey
ALTER TABLE "EmailTime" DROP CONSTRAINT "EmailTime_id_fkey";

-- DropForeignKey
ALTER TABLE "Jira" DROP CONSTRAINT "Jira_id_fkey";

-- DropForeignKey
ALTER TABLE "Slack" DROP CONSTRAINT "Slack_id_fkey";

-- AlterTable
ALTER TABLE "EmailTime" DROP COLUMN "job_id",
ADD COLUMN     "next_email_time" TIMESTAMP(3) NOT NULL;

-- DropTable
DROP TABLE "Alert";

-- DropEnum
DROP TYPE "Risk";

-- DropEnum
DROP TYPE "Status";

-- AddForeignKey
ALTER TABLE "EmailTime" ADD CONSTRAINT "EmailTime_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slack" ADD CONSTRAINT "Slack_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jira" ADD CONSTRAINT "Jira_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
