-- CreateTable
CREATE TABLE "public"."project_watchlist" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "repo_url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "project_watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_watchlist_project_id_idx" ON "public"."project_watchlist"("project_id");

-- CreateIndex
CREATE INDEX "project_watchlist_user_id_idx" ON "public"."project_watchlist"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_watchlist_project_id_repo_url_key" ON "public"."project_watchlist"("project_id", "repo_url");

-- AddForeignKey
ALTER TABLE "public"."project_watchlist" ADD CONSTRAINT "project_watchlist_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_watchlist" ADD CONSTRAINT "project_watchlist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
