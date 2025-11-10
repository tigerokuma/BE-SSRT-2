-- CreateTable
CREATE TABLE "package_versions" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "release_date" TIMESTAMP(3) NOT NULL,
    "vulnerability_count" INTEGER NOT NULL DEFAULT 0,
    "critical_count" INTEGER NOT NULL DEFAULT 0,
    "high_count" INTEGER NOT NULL DEFAULT 0,
    "medium_count" INTEGER NOT NULL DEFAULT 0,
    "low_count" INTEGER NOT NULL DEFAULT 0,
    "last_checked" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_versions_package_id_idx" ON "package_versions"("package_id");

-- CreateIndex
CREATE INDEX "package_versions_version_idx" ON "package_versions"("version");

-- CreateIndex
CREATE INDEX "package_versions_release_date_idx" ON "package_versions"("release_date");

-- CreateIndex
CREATE UNIQUE INDEX "package_versions_package_id_version_key" ON "package_versions"("package_id", "version");

-- AddForeignKey
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "Packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
