-- CreateTable
CREATE TABLE "logs" (
    "event_id" TEXT NOT NULL,
    "watchlist_id" TEXT,
    "event_type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,
    "event_hash" TEXT NOT NULL,
    "prev_event_hash" TEXT,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("event_id")
);

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "Watchlist"("watchlist_id") ON DELETE SET NULL ON UPDATE CASCADE;
