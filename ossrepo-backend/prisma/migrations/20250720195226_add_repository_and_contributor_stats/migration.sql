-- CreateTable
CREATE TABLE "contributor_stats" (
    "id" TEXT NOT NULL,
    "watchlist_id" TEXT NOT NULL,
    "author_email" TEXT NOT NULL,
    "author_name" TEXT,
    "total_commits" INTEGER NOT NULL,
    "avg_lines_added" DOUBLE PRECISION NOT NULL,
    "avg_lines_deleted" DOUBLE PRECISION NOT NULL,
    "avg_files_changed" DOUBLE PRECISION NOT NULL,
    "commit_time_histogram" JSONB NOT NULL,
    "last_commit_date" TIMESTAMP(3) NOT NULL,
    "stddev_lines_added" DOUBLE PRECISION NOT NULL,
    "stddev_lines_deleted" DOUBLE PRECISION NOT NULL,
    "stddev_files_changed" DOUBLE PRECISION NOT NULL,
    "typical_days_active" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contributor_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_stats" (
    "id" TEXT NOT NULL,
    "watchlist_id" TEXT NOT NULL,
    "total_commits" INTEGER NOT NULL,
    "avg_lines_added" DOUBLE PRECISION NOT NULL,
    "avg_lines_deleted" DOUBLE PRECISION NOT NULL,
    "avg_files_changed" DOUBLE PRECISION NOT NULL,
    "stddev_lines_added" DOUBLE PRECISION NOT NULL,
    "stddev_lines_deleted" DOUBLE PRECISION NOT NULL,
    "stddev_files_changed" DOUBLE PRECISION NOT NULL,
    "commit_time_histogram" JSONB NOT NULL,
    "typical_days_active" JSONB NOT NULL,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repo_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contributor_stats_watchlist_id_idx" ON "contributor_stats"("watchlist_id");

-- CreateIndex
CREATE UNIQUE INDEX "contributor_stats_watchlist_id_author_email_key" ON "contributor_stats"("watchlist_id", "author_email");

-- CreateIndex
CREATE INDEX "repo_stats_watchlist_id_idx" ON "repo_stats"("watchlist_id");

-- CreateIndex
CREATE UNIQUE INDEX "repo_stats_watchlist_id_key" ON "repo_stats"("watchlist_id");

-- AddForeignKey
ALTER TABLE "contributor_stats" ADD CONSTRAINT "contributor_stats_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "Watchlist"("watchlist_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_stats" ADD CONSTRAINT "repo_stats_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "Watchlist"("watchlist_id") ON DELETE CASCADE ON UPDATE CASCADE;
