-- CreateTable
CREATE TABLE "package_anomalies" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "contributor_id" TEXT NOT NULL,
    "anomaly_score" DOUBLE PRECISION NOT NULL,
    "score_breakdown" JSONB NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_anomalies_package_id_idx" ON "package_anomalies"("package_id");

-- CreateIndex
CREATE INDEX "package_anomalies_contributor_id_idx" ON "package_anomalies"("contributor_id");

-- CreateIndex
CREATE INDEX "package_anomalies_anomaly_score_idx" ON "package_anomalies"("anomaly_score");

-- CreateIndex
CREATE UNIQUE INDEX "package_anomalies_package_id_commit_sha_key" ON "package_anomalies"("package_id", "commit_sha");

-- AddForeignKey
ALTER TABLE "package_anomalies" ADD CONSTRAINT "package_anomalies_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "Packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_anomalies" ADD CONSTRAINT "package_anomalies_contributor_id_fkey" FOREIGN KEY ("contributor_id") REFERENCES "package_contributors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
