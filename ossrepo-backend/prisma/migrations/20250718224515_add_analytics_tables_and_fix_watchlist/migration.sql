/*
  Warnings:

  - Made the column `commits_since_last_health_update` on table `Watchlist` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Watchlist" ALTER COLUMN "commits_since_last_health_update" SET NOT NULL,
ALTER COLUMN "commits_since_last_health_update" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "logs" ADD COLUMN     "diff_data" JSONB,
ADD COLUMN     "files_changed" INTEGER DEFAULT 0,
ADD COLUMN     "lines_added" INTEGER DEFAULT 0,
ADD COLUMN     "lines_deleted" INTEGER DEFAULT 0;

-- CreateTable
CREATE TABLE "health_data" (
    "id" TEXT NOT NULL,
    "watchlist_id" TEXT NOT NULL,
    "commit_sha" TEXT,
    "commit_date" TIMESTAMP(3),
    "scorecard_metrics" JSONB,
    "overall_health_score" DECIMAL(5,2),
    "analysis_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'scorecard',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_factor_data" (
    "id" TEXT NOT NULL,
    "watchlist_id" TEXT NOT NULL,
    "bus_factor" INTEGER NOT NULL,
    "total_contributors" INTEGER NOT NULL,
    "top_contributors" JSONB NOT NULL,
    "risk_level" TEXT NOT NULL,
    "risk_reason" TEXT,
    "analysis_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bus_factor_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_data" (
    "id" TEXT NOT NULL,
    "watchlist_id" TEXT NOT NULL,
    "activity_score" INTEGER NOT NULL,
    "activity_level" TEXT NOT NULL,
    "total_commits" INTEGER NOT NULL,
    "total_files_analyzed" INTEGER NOT NULL,
    "file_churn_data" JSONB,
    "activity_heatmap" JSONB,
    "peak_activity" JSONB,
    "analysis_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_summary_data" (
    "id" TEXT NOT NULL,
    "watchlist_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "model_used" TEXT NOT NULL DEFAULT 'gemma2:2b',
    "prompt_length" INTEGER,
    "output_length" INTEGER,
    "generation_time_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_summary_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_summary_data" (
    "id" TEXT NOT NULL,
    "watchlist_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "week_end" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "model_used" TEXT NOT NULL DEFAULT 'gemma2:2b',
    "metrics_summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_summary_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_data_watchlist_id_idx" ON "health_data"("watchlist_id");

-- CreateIndex
CREATE INDEX "health_data_commit_sha_idx" ON "health_data"("commit_sha");

-- CreateIndex
CREATE INDEX "bus_factor_data_watchlist_id_idx" ON "bus_factor_data"("watchlist_id");

-- CreateIndex
CREATE INDEX "activity_data_watchlist_id_idx" ON "activity_data"("watchlist_id");

-- CreateIndex
CREATE INDEX "ai_summary_data_watchlist_id_idx" ON "ai_summary_data"("watchlist_id");

-- CreateIndex
CREATE INDEX "weekly_summary_data_watchlist_id_idx" ON "weekly_summary_data"("watchlist_id");

-- CreateIndex
CREATE INDEX "weekly_summary_data_week_start_idx" ON "weekly_summary_data"("week_start");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_summary_data_watchlist_id_week_start_key" ON "weekly_summary_data"("watchlist_id", "week_start");

-- CreateIndex
CREATE INDEX "logs_watchlist_id_idx" ON "logs"("watchlist_id");

-- CreateIndex
CREATE INDEX "logs_event_type_idx" ON "logs"("event_type");

-- CreateIndex
CREATE INDEX "logs_timestamp_idx" ON "logs"("timestamp");

-- AddForeignKey
ALTER TABLE "health_data" ADD CONSTRAINT "health_data_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "Watchlist"("watchlist_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_factor_data" ADD CONSTRAINT "bus_factor_data_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "Watchlist"("watchlist_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_data" ADD CONSTRAINT "activity_data_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "Watchlist"("watchlist_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_summary_data" ADD CONSTRAINT "ai_summary_data_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "Watchlist"("watchlist_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_summary_data" ADD CONSTRAINT "weekly_summary_data_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "Watchlist"("watchlist_id") ON DELETE CASCADE ON UPDATE CASCADE;
