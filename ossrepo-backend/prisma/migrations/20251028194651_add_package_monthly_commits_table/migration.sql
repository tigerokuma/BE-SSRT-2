-- CreateTable
CREATE TABLE "package_monthly_commits" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "commit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_monthly_commits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_monthly_commits_package_id_idx" ON "package_monthly_commits"("package_id");

-- CreateIndex
CREATE INDEX "package_monthly_commits_year_month_idx" ON "package_monthly_commits"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "package_monthly_commits_package_id_year_month_key" ON "package_monthly_commits"("package_id", "year", "month");

-- AddForeignKey
ALTER TABLE "package_monthly_commits" ADD CONSTRAINT "package_monthly_commits_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "Packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
