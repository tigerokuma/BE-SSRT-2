-- CreateTable
CREATE TABLE "project_dependencies" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "monitored_branch_id" TEXT,
    "repo_url" TEXT,
    "repo_owner" TEXT,
    "repo_name" TEXT,
    "package_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "setup_type" TEXT NOT NULL DEFAULT 'fast',
    "activity_score" DOUBLE PRECISION,
    "bus_factor_score" DOUBLE PRECISION,
    "health_score" DOUBLE PRECISION,
    "scorecard_score" DOUBLE PRECISION,
    "vulnerability_count" INTEGER NOT NULL DEFAULT 0,
    "license_compliant" BOOLEAN,
    "github_stars" INTEGER,
    "contributors_count" INTEGER,
    "last_commit_date" TIMESTAMP(3),
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_analyzed_at" TIMESTAMP(3),

    CONSTRAINT "project_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_dependencies_project_id_name_key" ON "project_dependencies"("project_id", "name");

-- CreateIndex
CREATE INDEX "project_dependencies_project_id_idx" ON "project_dependencies"("project_id");

-- CreateIndex
CREATE INDEX "project_dependencies_status_idx" ON "project_dependencies"("status");

-- CreateIndex
CREATE INDEX "project_dependencies_package_id_idx" ON "project_dependencies"("package_id");

-- CreateIndex
CREATE INDEX "project_dependencies_monitored_branch_id_idx" ON "project_dependencies"("monitored_branch_id");

-- AddForeignKey
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_monitored_branch_id_fkey" FOREIGN KEY ("monitored_branch_id") REFERENCES "monitored_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "Package"("package_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "projects" DROP COLUMN "dependencies",
ADD COLUMN "dependencies_json" JSONB;
