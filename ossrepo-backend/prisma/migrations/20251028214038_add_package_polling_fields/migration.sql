-- AlterTable
ALTER TABLE "Packages" ADD COLUMN     "default_branch" TEXT,
ADD COLUMN     "last_polled_at" TIMESTAMP(3),
ADD COLUMN     "latest_commit_sha" TEXT;
