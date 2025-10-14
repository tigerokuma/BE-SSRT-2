-- AddForeignKey
ALTER TABLE "public"."project_watchlist_packages" ADD CONSTRAINT "project_watchlist_packages_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
