-- AddForeignKey
ALTER TABLE "public"."watchlist_comments" ADD CONSTRAINT "watchlist_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
