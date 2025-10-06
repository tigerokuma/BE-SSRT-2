-- CreateTable
CREATE TABLE "public"."project_watchlist_approvals" (
    "id" TEXT NOT NULL,
    "project_watchlist_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_watchlist_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."project_watchlist_disapprovals" (
    "id" TEXT NOT NULL,
    "project_watchlist_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "disapproved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_watchlist_disapprovals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."project_watchlist_comments" (
    "id" TEXT NOT NULL,
    "project_watchlist_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_watchlist_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_watchlist_approvals_project_watchlist_id_idx" ON "public"."project_watchlist_approvals"("project_watchlist_id");

-- CreateIndex
CREATE INDEX "project_watchlist_approvals_user_id_idx" ON "public"."project_watchlist_approvals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_watchlist_approvals_project_watchlist_id_user_id_key" ON "public"."project_watchlist_approvals"("project_watchlist_id", "user_id");

-- CreateIndex
CREATE INDEX "project_watchlist_disapprovals_project_watchlist_id_idx" ON "public"."project_watchlist_disapprovals"("project_watchlist_id");

-- CreateIndex
CREATE INDEX "project_watchlist_disapprovals_user_id_idx" ON "public"."project_watchlist_disapprovals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_watchlist_disapprovals_project_watchlist_id_user_id_key" ON "public"."project_watchlist_disapprovals"("project_watchlist_id", "user_id");

-- CreateIndex
CREATE INDEX "project_watchlist_comments_project_watchlist_id_idx" ON "public"."project_watchlist_comments"("project_watchlist_id");

-- CreateIndex
CREATE INDEX "project_watchlist_comments_user_id_idx" ON "public"."project_watchlist_comments"("user_id");

-- AddForeignKey
ALTER TABLE "public"."project_watchlist_approvals" ADD CONSTRAINT "project_watchlist_approvals_project_watchlist_id_fkey" FOREIGN KEY ("project_watchlist_id") REFERENCES "public"."project_watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_watchlist_approvals" ADD CONSTRAINT "project_watchlist_approvals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_watchlist_disapprovals" ADD CONSTRAINT "project_watchlist_disapprovals_project_watchlist_id_fkey" FOREIGN KEY ("project_watchlist_id") REFERENCES "public"."project_watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_watchlist_disapprovals" ADD CONSTRAINT "project_watchlist_disapprovals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_watchlist_comments" ADD CONSTRAINT "project_watchlist_comments_project_watchlist_id_fkey" FOREIGN KEY ("project_watchlist_id") REFERENCES "public"."project_watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_watchlist_comments" ADD CONSTRAINT "project_watchlist_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
