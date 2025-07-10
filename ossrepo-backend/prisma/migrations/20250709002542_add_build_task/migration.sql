-- CreateTable
CREATE TABLE "BuildTask" (
    "task_id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "logs" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "commit_id" TEXT,
    "assigned_to" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BuildTask_pkey" PRIMARY KEY ("task_id")
);
