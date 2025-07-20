-- CreateTable
CREATE TABLE "alert_triggered" (
    "id" TEXT NOT NULL,
    "user_watchlist_id" TEXT NOT NULL,
    "watchlist_id" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "contributor" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "alert_level" TEXT NOT NULL,
    "threshold_type" TEXT NOT NULL,
    "threshold_value" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "details_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "alert_triggered_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_triggered_user_watchlist_id_idx" ON "alert_triggered"("user_watchlist_id");

-- CreateIndex
CREATE INDEX "alert_triggered_watchlist_id_idx" ON "alert_triggered"("watchlist_id");

-- CreateIndex
CREATE INDEX "alert_triggered_commit_sha_idx" ON "alert_triggered"("commit_sha");

-- CreateIndex
CREATE INDEX "alert_triggered_created_at_idx" ON "alert_triggered"("created_at");

-- AddForeignKey
ALTER TABLE "alert_triggered" ADD CONSTRAINT "alert_triggered_user_watchlist_id_fkey" FOREIGN KEY ("user_watchlist_id") REFERENCES "UserWatchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_triggered" ADD CONSTRAINT "alert_triggered_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "Watchlist"("watchlist_id") ON DELETE CASCADE ON UPDATE CASCADE;
