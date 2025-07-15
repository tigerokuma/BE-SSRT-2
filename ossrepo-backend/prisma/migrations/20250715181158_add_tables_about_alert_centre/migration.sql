-- CreateEnum
CREATE TYPE "Risk" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('OPEN', 'REVIEWED', 'CLOSED');

-- CreateEnum
CREATE TYPE "WaitValue" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Alert" (
    "alert_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "risk" "Risk" NOT NULL,
    "status" "Status" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id","alert_id")
);

-- CreateTable
CREATE TABLE "EmailTime" (
    "id" TEXT NOT NULL,
    "last_email_time" TIMESTAMP(3) NOT NULL,
    "job_id" TEXT NOT NULL,
    "wait_value" "WaitValue" NOT NULL,
    "wait_unit" INTEGER NOT NULL,

    CONSTRAINT "EmailTime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailConfirmation" (
    "token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailConfirmation_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "Slack" (
    "id" TEXT NOT NULL,
    "slack_token" TEXT NOT NULL,
    "slack_channel" TEXT,

    CONSTRAINT "Slack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Jira" (
    "id" TEXT NOT NULL,
    "webtrigger_url" TEXT NOT NULL,
    "project_key" TEXT,

    CONSTRAINT "Jira_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailConfirmation_user_id_key" ON "EmailConfirmation"("user_id");

-- CreateIndex
CREATE INDEX "EmailConfirmation_expiresAt_idx" ON "EmailConfirmation"("expiresAt");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_id_fkey" FOREIGN KEY ("id") REFERENCES "UserWatchlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTime" ADD CONSTRAINT "EmailTime_id_fkey" FOREIGN KEY ("id") REFERENCES "UserWatchlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailConfirmation" ADD CONSTRAINT "EmailConfirmation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slack" ADD CONSTRAINT "Slack_id_fkey" FOREIGN KEY ("id") REFERENCES "UserWatchlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jira" ADD CONSTRAINT "Jira_id_fkey" FOREIGN KEY ("id") REFERENCES "UserWatchlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
