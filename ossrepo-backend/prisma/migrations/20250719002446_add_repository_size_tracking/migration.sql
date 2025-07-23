-- AlterTable
ALTER TABLE "Watchlist" ADD COLUMN     "analysis_strategy" TEXT DEFAULT 'api-only',
ADD COLUMN     "clone_time_ms" INTEGER,
ADD COLUMN     "repo_size_kb" INTEGER;
