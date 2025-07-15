-- AlterTable
ALTER TABLE "Watchlist" ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "processing_completed_at" TIMESTAMP(3),
ADD COLUMN     "processing_started_at" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'processing';
