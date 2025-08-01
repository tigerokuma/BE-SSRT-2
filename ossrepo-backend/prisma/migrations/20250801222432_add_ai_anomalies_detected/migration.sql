-- CreateTable
CREATE TABLE "ai_anomalies_detected" (
    "id" TEXT NOT NULL,
    "watchlist_id" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "anomaly_details" JSONB NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_anomalies_detected_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_anomalies_detected_watchlist_id_idx" ON "ai_anomalies_detected"("watchlist_id");

-- CreateIndex
CREATE INDEX "ai_anomalies_detected_commit_sha_idx" ON "ai_anomalies_detected"("commit_sha");

-- CreateIndex
CREATE UNIQUE INDEX "ai_anomalies_detected_watchlist_id_commit_sha_key" ON "ai_anomalies_detected"("watchlist_id", "commit_sha");

-- AddForeignKey
ALTER TABLE "ai_anomalies_detected" ADD CONSTRAINT "ai_anomalies_detected_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "Watchlist"("watchlist_id") ON DELETE CASCADE ON UPDATE CASCADE;
