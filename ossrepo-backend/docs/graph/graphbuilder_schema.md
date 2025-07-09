## Table: build_tasks

- task_id      UUID PRIMARY KEY
- repo_id      UUID NOT NULL
- repo_path    TEXT NOT NULL
- status       TEXT CHECK (status IN ('queued','in_progress','completed','failed'))
- created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
- started_at   TIMESTAMPTZ
- finished_at  TIMESTAMPTZ
- logs         TEXT[]
- assigned_to  TEXT
- retry_count  INTEGER DEFAULT 0

## Table: build_subtasks

- subtask_id   UUID PRIMARY KEY
- task_id      UUID REFERENCES build_tasks(task_id) ON DELETE CASCADE
- language     TEXT NOT NULL
- commit_id    TEXT
- status       TEXT CHECK (status IN ('queued','in_progress','completed','failed'))
- analyzer     TEXT
- started_at   TIMESTAMPTZ
- finished_at  TIMESTAMPTZ
- graph_type   TEXT[]
- logs         TEXT[]

## Table: graph_snapshots

- snapshot_id  UUID PRIMARY KEY
- subtask_id   UUID REFERENCES build_subtasks(subtask_id) ON DELETE CASCADE
- repo_id      UUID NOT NULL
- commit_id    TEXT
- language     TEXT NOT NULL
- graph_type   TEXT NOT NULL
- version      INTEGER NOT NULL
- created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
- node_count   INTEGER
- edge_count   INTEGER
- s3_url       TEXT
- status       TEXT CHECK (status IN ('stored','invalidated','expired'))

## Table: graph_nodes

- node_id      UUID PRIMARY KEY
- snapshot_id  UUID REFERENCES graph_snapshots(snapshot_id)
- type         TEXT NOT NULL
- name         TEXT
- file_path    TEXT
- commit_id    TEXT
- metadata     JSONB

#### Indexes:
- CREATE INDEX idx_graph_nodes_snapshot ON graph_nodes(snapshot_id);
- CREATE INDEX idx_graph_nodes_name ON graph_nodes(name);


## Table: graph_edges

- edge_id      UUID PRIMARY KEY
- snapshot_id  UUID REFERENCES graph_snapshots(snapshot_id)
- source_id    UUID REFERENCES graph_nodes(node_id)
- target_id    UUID REFERENCES graph_nodes(node_id)
- relation     TEXT
- metadata     JSONB

#### Index:
- CREATE INDEX idx_graph_edges_rel ON graph_edges(relation);