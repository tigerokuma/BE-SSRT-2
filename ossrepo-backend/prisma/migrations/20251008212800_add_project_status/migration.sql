-- AlterTable
ALTER TABLE "public"."projects" ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'creating';
