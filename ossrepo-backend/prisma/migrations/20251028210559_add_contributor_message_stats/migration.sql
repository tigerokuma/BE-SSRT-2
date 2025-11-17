-- AlterTable
ALTER TABLE "package_contributors" ADD COLUMN     "avg_commit_message_length" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "insert_to_delete_ratio" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "stddev_commit_message_length" DOUBLE PRECISION NOT NULL DEFAULT 0;
