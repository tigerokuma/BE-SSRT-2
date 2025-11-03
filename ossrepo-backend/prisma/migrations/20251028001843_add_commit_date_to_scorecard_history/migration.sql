-- AlterTable
ALTER TABLE "package_scorecard_history" ADD COLUMN     "commit_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "package_scorecard_history_commit_date_idx" ON "package_scorecard_history"("commit_date");
