-- CreateTable
CREATE TABLE "GraphExport" (
    "export_id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "ready_time" TIMESTAMP(3),
    "s3_url" TEXT,
    "status" TEXT NOT NULL,
    "actor" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphExport_pkey" PRIMARY KEY ("export_id")
);
