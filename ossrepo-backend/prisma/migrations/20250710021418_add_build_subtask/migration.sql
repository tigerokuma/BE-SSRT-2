-- CreateTable
CREATE TABLE "BuildSubtask" (
    "subtask_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "BuildSubtask_pkey" PRIMARY KEY ("subtask_id")
);

-- AddForeignKey
ALTER TABLE "BuildSubtask" ADD CONSTRAINT "BuildSubtask_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "BuildTask"("task_id") ON DELETE CASCADE ON UPDATE CASCADE;
