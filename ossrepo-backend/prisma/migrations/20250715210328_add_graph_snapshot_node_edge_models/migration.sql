-- CreateTable
CREATE TABLE "graph_snapshots" (
    "snapshot_id" TEXT NOT NULL,
    "subtask_id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "commit_id" TEXT,
    "language" TEXT NOT NULL,
    "graph_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "node_count" INTEGER,
    "edge_count" INTEGER,
    "s3_url" TEXT,
    "status" TEXT NOT NULL,

    CONSTRAINT "graph_snapshots_pkey" PRIMARY KEY ("snapshot_id")
);

-- CreateTable
CREATE TABLE "graph_nodes" (
    "node_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "file_path" TEXT,
    "commit_id" TEXT,
    "metadata" JSONB,

    CONSTRAINT "graph_nodes_pkey" PRIMARY KEY ("node_id")
);

-- CreateTable
CREATE TABLE "graph_edges" (
    "edge_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "graph_edges_pkey" PRIMARY KEY ("edge_id")
);

-- CreateIndex
CREATE INDEX "graph_snapshots_subtask_id_idx" ON "graph_snapshots"("subtask_id");

-- CreateIndex
CREATE INDEX "graph_snapshots_repo_id_idx" ON "graph_snapshots"("repo_id");

-- CreateIndex
CREATE INDEX "graph_nodes_snapshot_id_idx" ON "graph_nodes"("snapshot_id");

-- CreateIndex
CREATE INDEX "graph_nodes_name_idx" ON "graph_nodes"("name");

-- CreateIndex
CREATE INDEX "graph_edges_relation_idx" ON "graph_edges"("relation");

-- AddForeignKey
ALTER TABLE "graph_snapshots" ADD CONSTRAINT "graph_snapshots_subtask_id_fkey" FOREIGN KEY ("subtask_id") REFERENCES "BuildSubtask"("subtask_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "graph_snapshots"("snapshot_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "graph_snapshots"("snapshot_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "graph_nodes"("node_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "graph_nodes"("node_id") ON DELETE RESTRICT ON UPDATE CASCADE;
