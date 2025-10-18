-- CreateTable
CREATE TABLE "public"."package_commits" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "author_email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "lines_added" INTEGER NOT NULL DEFAULT 0,
    "lines_deleted" INTEGER NOT NULL DEFAULT 0,
    "files_changed" INTEGER NOT NULL DEFAULT 0,
    "diff_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_commits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."package_contributors" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "author_email" TEXT NOT NULL,
    "author_name" TEXT,
    "total_commits" INTEGER NOT NULL,
    "avg_lines_added" DOUBLE PRECISION NOT NULL,
    "avg_lines_deleted" DOUBLE PRECISION NOT NULL,
    "avg_files_changed" DOUBLE PRECISION NOT NULL,
    "stddev_lines_added" DOUBLE PRECISION NOT NULL,
    "stddev_lines_deleted" DOUBLE PRECISION NOT NULL,
    "stddev_files_changed" DOUBLE PRECISION NOT NULL,
    "commit_time_histogram" JSONB NOT NULL,
    "typical_days_active" JSONB NOT NULL,
    "first_commit_date" TIMESTAMP(3) NOT NULL,
    "last_commit_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_contributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."package_scorecard_history" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "scorecard_data" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_scorecard_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_commits_package_id_idx" ON "public"."package_commits"("package_id");

-- CreateIndex
CREATE INDEX "package_commits_timestamp_idx" ON "public"."package_commits"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "package_commits_package_id_sha_key" ON "public"."package_commits"("package_id", "sha");

-- CreateIndex
CREATE INDEX "package_contributors_package_id_idx" ON "public"."package_contributors"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "package_contributors_package_id_author_email_key" ON "public"."package_contributors"("package_id", "author_email");

-- CreateIndex
CREATE INDEX "package_scorecard_history_package_id_idx" ON "public"."package_scorecard_history"("package_id");

-- CreateIndex
CREATE INDEX "package_scorecard_history_commit_sha_idx" ON "public"."package_scorecard_history"("commit_sha");

-- AddForeignKey
ALTER TABLE "public"."package_commits" ADD CONSTRAINT "package_commits_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."Packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."package_contributors" ADD CONSTRAINT "package_contributors_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."Packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."package_scorecard_history" ADD CONSTRAINT "package_scorecard_history_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."Packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
