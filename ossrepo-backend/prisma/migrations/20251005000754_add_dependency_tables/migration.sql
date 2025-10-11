-- CreateTable
CREATE TABLE "project_dependencies" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_dependencies" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watchlist_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_dependencies_project_id_idx" ON "project_dependencies"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_dependencies_project_id_name_key" ON "project_dependencies"("project_id", "name");

-- CreateIndex
CREATE INDEX "watchlist_dependencies_project_id_idx" ON "watchlist_dependencies"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_dependencies_project_id_name_key" ON "watchlist_dependencies"("project_id", "name");

-- AddForeignKey
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_dependencies" ADD CONSTRAINT "watchlist_dependencies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
