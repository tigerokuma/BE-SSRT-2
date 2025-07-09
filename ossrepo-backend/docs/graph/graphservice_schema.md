## Table: graphs

- repo_id               UUID PRIMARY KEY
- current_snapshot_id   UUID REFERENCES graph_snapshots(snapshot_id)
- status                TEXT CHECK (status IN ('none','pending','in_progress','ready','error'))
- last_updated          TIMESTAMPTZ
- last_error            TEXT

## Table: graph_exports

- export_id     UUID PRIMARY KEY
- repo_id       UUID REFERENCES graphs(repo_id)
- snapshot_id   UUID REFERENCES graph_snapshots(snapshot_id)
- format        TEXT CHECK (format IN ('graphml','json'))
- request_time  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
- ready_time    TIMESTAMPTZ
- s3_url        TEXT
- status        TEXT CHECK (status IN ('queued','in_progress','ready','failed'))
- actor         TEXT

## Table: graph_views

- view_id      UUID PRIMARY KEY
- repo_id      UUID REFERENCES graphs(repo_id)
- snapshot_id  UUID REFERENCES graph_snapshots(snapshot_id)
- generated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
- status       TEXT CHECK (status IN ('generating','ready','error'))
- actor        TEXT

## Table: service_logs

- log_id      UUID PRIMARY KEY
- endpoint    TEXT
- repo_id     UUID
- actor       TEXT
- timestamp   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
- status      INTEGER
- latency_ms  INTEGER
- details     JSONB
