-- CreateTable
CREATE TABLE "WatchlistSbom" (
    "id" TEXT NOT NULL,
    "watchlist_id" TEXT NOT NULL,
    "sbom" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistSbom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWatchlistSbom" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sbom" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWatchlistSbom_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistSbom_watchlist_id_key" ON "WatchlistSbom"("watchlist_id");

-- CreateIndex
CREATE INDEX "WatchlistSbom_watchlist_id_idx" ON "WatchlistSbom"("watchlist_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserWatchlistSbom_user_id_key" ON "UserWatchlistSbom"("user_id");

-- CreateIndex
CREATE INDEX "UserWatchlistSbom_user_id_idx" ON "UserWatchlistSbom"("user_id");

-- AddForeignKey
ALTER TABLE "WatchlistSbom" ADD CONSTRAINT "WatchlistSbom_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "Watchlist"("watchlist_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWatchlistSbom" ADD CONSTRAINT "UserWatchlistSbom_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
