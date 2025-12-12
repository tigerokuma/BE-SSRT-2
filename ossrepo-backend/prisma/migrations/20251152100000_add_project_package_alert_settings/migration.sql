-- CreateTable
CREATE TABLE "project_package_alert_settings" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "anomaly_threshold" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "vulnerability_threshold" TEXT NOT NULL DEFAULT 'medium',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_package_alert_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_package_alert_settings_project_id_package_id_key" ON "project_package_alert_settings"("project_id", "package_id");

-- CreateIndex
CREATE INDEX "project_package_alert_settings_project_id_idx" ON "project_package_alert_settings"("project_id");

-- CreateIndex
CREATE INDEX "project_package_alert_settings_package_id_idx" ON "project_package_alert_settings"("package_id");

-- AddForeignKey
ALTER TABLE "project_package_alert_settings" ADD CONSTRAINT "project_package_alert_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_package_alert_settings" ADD CONSTRAINT "project_package_alert_settings_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "Packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

