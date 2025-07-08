/*
  Warnings:

  - You are about to drop the `RepositoryMetadata` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Watchlist" DROP CONSTRAINT "Watchlist_repo_id_fkey";

-- DropTable
DROP TABLE "RepositoryMetadata";

-- CreateTable
CREATE TABLE "Package" (
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

    CONSTRAINT "Package_pkey" PRIMARY KEY ("repo_id")
);

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "Package"("repo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
