-- AlterTable
ALTER TABLE "public"."project_watchlist_packages" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "rejected_by" TEXT;

-- AddForeignKey
ALTER TABLE "public"."project_watchlist_packages" ADD CONSTRAINT "project_watchlist_packages_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_watchlist_packages" ADD CONSTRAINT "project_watchlist_packages_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
