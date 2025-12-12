-- AlterTable
ALTER TABLE "package_contributors" ALTER COLUMN "commit_time_heatmap" DROP DEFAULT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "anomalies_notifications" JSONB;

-- CreateTable
CREATE TABLE "project_package_alerts" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "version" TEXT,
    "alert_type" TEXT NOT NULL,
    "vulnerability_id" TEXT,
    "severity" TEXT,
    "vulnerability_details" JSONB,
    "commit_sha" TEXT,
    "anomaly_score" DOUBLE PRECISION,
    "score_breakdown" JSONB,
    "status" TEXT NOT NULL DEFAULT 'unread',
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_package_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_alerts" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "package_id" TEXT,
    "alert_type" TEXT NOT NULL,
    "severity" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "status" TEXT NOT NULL DEFAULT 'unread',
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_package_alerts_project_id_idx" ON "project_package_alerts"("project_id");

-- CreateIndex
CREATE INDEX "project_package_alerts_package_id_idx" ON "project_package_alerts"("package_id");

-- CreateIndex
CREATE INDEX "project_package_alerts_status_idx" ON "project_package_alerts"("status");

-- CreateIndex
CREATE INDEX "project_package_alerts_detected_at_idx" ON "project_package_alerts"("detected_at");

-- CreateIndex
CREATE INDEX "project_package_alerts_alert_type_idx" ON "project_package_alerts"("alert_type");

-- CreateIndex
CREATE INDEX "project_package_alerts_vulnerability_id_idx" ON "project_package_alerts"("vulnerability_id");

-- CreateIndex
CREATE INDEX "project_package_alerts_commit_sha_idx" ON "project_package_alerts"("commit_sha");

-- CreateIndex
CREATE INDEX "project_alerts_project_id_idx" ON "project_alerts"("project_id");

-- CreateIndex
CREATE INDEX "project_alerts_package_id_idx" ON "project_alerts"("package_id");

-- CreateIndex
CREATE INDEX "project_alerts_alert_type_idx" ON "project_alerts"("alert_type");

-- CreateIndex
CREATE INDEX "project_alerts_status_idx" ON "project_alerts"("status");

-- CreateIndex
CREATE INDEX "project_alerts_detected_at_idx" ON "project_alerts"("detected_at");

-- AddForeignKey
ALTER TABLE "project_package_alerts" ADD CONSTRAINT "project_package_alerts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_package_alerts" ADD CONSTRAINT "project_package_alerts_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "Packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_alerts" ADD CONSTRAINT "project_alerts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_alerts" ADD CONSTRAINT "project_alerts_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "Packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
