-- CreateTable
CREATE TABLE "public"."monitored_branches" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "branch_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitored_branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monitored_branches_project_id_idx" ON "public"."monitored_branches"("project_id");

-- CreateIndex
CREATE INDEX "monitored_branches_branch_name_idx" ON "public"."monitored_branches"("branch_name");

-- CreateIndex
CREATE INDEX "monitored_branches_is_active_idx" ON "public"."monitored_branches"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "monitored_branches_project_id_branch_name_key" ON "public"."monitored_branches"("project_id", "branch_name");

-- AddForeignKey
ALTER TABLE "public"."monitored_branches" ADD CONSTRAINT "monitored_branches_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
