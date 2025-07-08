-- CreateTable
CREATE TABLE "users" (
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "RepositoryMetadata" (
    "repo_id" TEXT NOT NULL,
    "package_name" TEXT NOT NULL,
    "downloads" INTEGER,
    "last_updated" TIMESTAMP(3),
    "stars" INTEGER,
    "contributors" INTEGER,
    "pushed_at" TIMESTAMP(3),
    "risk_score" DOUBLE PRECISION,
    "fetched_at" TIMESTAMP(3),
    "repo_url" TEXT NOT NULL,
    "repo_name" TEXT NOT NULL,

    CONSTRAINT "RepositoryMetadata_pkey" PRIMARY KEY ("repo_id")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "watchlist_id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "alert_cve_ids" TEXT[],
    "updated_at" TIMESTAMP(3),
    "default_branch" TEXT,
    "latest_commit_sha" TEXT,
    "commits_since_last_health_update" INTEGER,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("watchlist_id")
);

-- CreateTable
CREATE TABLE "UserWatchlist" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "watchlist_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alerts" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWatchlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "UserWatchlist_user_id_idx" ON "UserWatchlist"("user_id");

-- CreateIndex
CREATE INDEX "UserWatchlist_watchlist_id_idx" ON "UserWatchlist"("watchlist_id");

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "RepositoryMetadata"("repo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWatchlist" ADD CONSTRAINT "UserWatchlist_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "Watchlist"("watchlist_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWatchlist" ADD CONSTRAINT "UserWatchlist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
