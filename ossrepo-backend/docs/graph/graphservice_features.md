# 📡 External Features – Graph Service

The **Graph Service** exposes APIs that allow other services and users to trigger graph builds, check graph metadata, download exports, and visualize repository graphs.

---

### 🔌 External API Features

| Feature | Purpose | Flow | Endpoint(s) |
|---------|---------|------|-------------|
| **Trigger Graph Build** | Initiate graph construction for a repo (initial or full) | Called by Repository Activity or manually | `POST /api/graph/build/:repoId` |
| **Trigger Graph Rebuild on Code Update** | Trigger graph regeneration when new code is detected | Repo activity service passes repoId + optional commitId | `POST /api/graph/update/:repoId/:commitId` |
| **Check Build Status** | Monitor progress or completion of graph builds | Clients poll or subscribe to task status | `GET /api/graph/status/:repoId` |
| **Export Graph** | Download graph in GraphML or JSON | Retrieve stored graph snapshot from storage | `GET /api/graph/export/:repoId` |
| **Visualize Graph** | View graph structure via Cytoscape or other frontend | Render from stored JSON | `GET /api/graph/view/:repoId` |
| **Metadata Summary** | Fetch summary details (types, size, contributors) | Pulls metadata from DB | `GET /api/graph/summary/:repoId` |
| **Optional RAG Preparation** | Transform graph into text/triples for LLM use | Converts to vectorizable format (future) | `POST /api/graph/rag/:repoId` *(planned)* |

---

### ⚙️ Internal Features

| Internal Feature | Purpose |
|------------------|---------|
| **Graph Trigger Handler** | Accepts build/rebuild calls, validates repoId |
| **Task Scheduler** | Records tasks into `build_tasks`, updates status |
| **Storage Gateway** | Reads/writes GraphML to S3, JSON to local or cache |
| **Metadata Service** | Summarizes graph version, contributors, health |
| **Validator** | Ensures graph meets spec before marking status complete |

---

### 🔄 Integration Triggers

Graph builds are triggered **via API** or future webhook integration.

- Repo Activity Service → calls build or update endpoint
- Graph Service stores task → calls Graph Builder with task metadata
- Later: Queue-based system can replace direct call

---

### 📂 Data Storage

- PostgreSQL → `build_tasks`, `graph_snapshots`, `graph_nodes`, `graph_edges`
- S3/R2 → GraphML files (`graph_snapshots.s3_url`)
- Redis (optional) → Cache for visualization/rendering

---

### 🗂 Planned Enhancements

- [ ] Graph comparison API (diff snapshots)
- [ ] Graph version rollback
- [ ] Contributor analytics from graph nodes
- [ ] Alerts if build fails repeatedly