# 🧠 Internal Features – Graph Builder

The **Graph Builder** service is responsible for extracting semantic representations of repositories in the form of structured code graphs (AST, CFG, PDG), which can later be used for visualization, querying, or integration into downstream systems like RAG-based search.

---

### 🔧 Core Internal Features

| Internal Feature | Purpose |
|------------------|---------|
| **Graph Build Engine (`code-graph-rag`)** | Uses Tree-sitter-powered `code-graph-rag` to extract AST/CFG/PDG from supported languages and generate GraphML and JSON outputs |
| **Repo Cloner** | Securely clones a repository (latest state or at a known commit) into a local directory for analysis |
| **Snapshot Generator (Timestamp-Based)** | Initiates builds based on latest available state; associates snapshots with timestamps rather than fixed commits (if commit tracking is unavailable or impractical) |
| **Commit-to-Graph Mapper (Optional)** | Optionally links generated graphs to specific commit SHAs for traceability (if commit is available from activity tracker) |
| **Output Formatter** | Converts internal graph format (NetworkX) to GraphML (for long-term storage) and JSON (for frontend rendering) |
| **Graph Validation Module (Optional)** | Validates generated graph for structural consistency (e.g., orphaned nodes, invalid edges) |
| **Graph Metadata Extractor** | Extracts statistics such as node/edge count, language, snapshot type, and version – inserted into `graph_snapshots` |

---

### ⚙️ Language Support

| Language      | Analyzer                 |
|---------------|--------------------------|
| Python        | Tree-sitter via `code-graph-rag` |
| JavaScript    | Tree-sitter via `code-graph-rag` |
| TypeScript    | Planned (Tree-sitter grammar) |
| C++, Java     | Future roadmap (ComEx/Joern or compatible tools) |

---

### 🔄 Trigger Mechanisms

Graph Builder is intended to be **externally triggered** via an API (typically from Graph Service), or invoked manually during development/testing.

| Trigger Type           | Description |
|------------------------|-------------|
| **API-based Trigger**  | `POST /internal/build` accepts structured payload from Graph Service |
| **Manual CLI Trigger** | CLI command for local debugging and batch testing |
| **Future Queue-based Trigger** | Can support async events (e.g., RabbitMQ, Pub/Sub) if needed for scale |

Example input payload:
```json
{
  "repoId": "abc123",
  "repoPath": "/tmp/cloned-repo",
  "language": "python",
  "taskId": "build-xyz",
  "commitId": "d34db33f"  // optional
}
```

---

### 📦 Outputs

Each graph build produces the following:

- 🗂 **GraphML file** — uploaded to S3 or R2 for long-term retrieval
- 📄 **JSON graph** — stored for frontend rendering or export
- 🧾 **Snapshot metadata** — recorded in `graph_snapshots`, including snapshot type (timestamp/manual/commit), node/edge count, status
- 🔢 **Optional RAG output** — converted triples/text blocks for vector DB integration (future)

---

### 🗂 Schema Alignment

| Output Target | Database Table |
|---------------|----------------|
| Task metadata | `build_tasks` |
| Snapshot info | `graph_snapshots` |
| Graph content | `graph_nodes`, `graph_edges` |
| Graph file ref | `s3_url` in `graph_snapshots` |
| Optional vector | `graph_rag_embeddings` |

Supports **nullable `commit_id`** and includes `snapshot_type = 'timestamp' | 'commit' | 'manual'`.

---

### 🛠 Planned Enhancements

- [ ] Multi-language snapshot support per build (aggregate in `graph_snapshots`)
- [ ] SBOM and contributor tagging during metadata enrichment
- [ ] Graph summarization service for large snapshots (sampling, top contributors, entropy)
- [ ] Fault tolerance + retry logic in builder engine
- [ ] Integration with future static analyzers or language-specific pipelines