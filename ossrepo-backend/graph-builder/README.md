

# Graph Builder (Python Microservice)

## Overview

The Graph Builder is a Python microservice designed to parse code repositories, extract Abstract Syntax Trees (ASTs), and save code graph data (nodes and edges) into both a PostgreSQL backend (via REST API) and a local [Memgraph](https://memgraph.com/) graph database. It also exports GraphML files for visualization and provides a downloadable URL for each processed snapshot.

The builder is intended to be triggered by a backend service (such as a NestJS server) as part of a repository analysis pipeline.

---

## Features

- **Extracts AST nodes and edges** from source code using Tree-sitter parsers.
- **Saves code graph to PostgreSQL** via REST API endpoints (your backend).
- **Saves code graph to Memgraph** (open-source graph DB) for fast graph queries and visualization.
- **Exports GraphML** for visualization; downloadable via URL.
- **Tracks build task, snapshot, and subtask progress** via backend API.
- **Supports incremental and full builds** (checks for existing snapshots by `repo_id` and `commit_id`).

---

## Quickstart

### 1. Create and activate a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
````

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the FastAPI server

```bash
uvicorn builder.main:app --reload --host 0.0.0.0 --port 8000
```

---

## API Endpoint

### `POST /internal/build`

#### Payload Example

```json
{
  "repoId": "abc123",
  "repoPath": "/tmp/cloned-repo",
  "language": "python",
  "taskId": "build-xyz",
  "commitId": "d34db33f"
}
```

#### What happens on build

* The builder parses all source files using the appropriate Tree-sitter parser.
* AST nodes and edges are saved to both your backend (PostgreSQL) and Memgraph.
* A GraphML file is exported for visualization.
* The backend is updated with node/edge counts and a downloadable URL for the GraphML.

---

## Setting up Memgraph Locally

1. **Install Docker** (if not already installed).

2. **Start Memgraph database:**

   ```bash
   docker run -p 7687:7687 -p 7444:7444 memgraph/memgraph-mage
   ```

   * `7687` is the Bolt protocol port (used by the Python driver).
   * `7444` is for monitoring/UI access (optional).

3. **Configure the Python builder to connect to Memgraph:**

   By default, the builder connects to `localhost:7687`.

4. **(Optional) Set up Memgraph Lab UI:**

   ```bash
   docker run -p 3001:3000 --env REACT_APP_MG_HOST=host.docker.internal --env REACT_APP_MG_PORT=7687 memgraph/lab
   ```

   Then visit [http://localhost:3001](http://localhost:3001) in your browser.

---

## Notes

* **Memgraph must be running** for the builder to persist graph data for visualization.
* All node/edge data is mirrored to both PostgreSQL (via backend API) and Memgraph (via Bolt driver).
* Snapshots are deduplicated by `(repo_id, commit_id)` before processing to avoid duplicate builds.
* GraphML exports are saved locally and registered in the backend as a downloadable URL (shown in the snapshot record).
* Python 3.8+ is recommended.

---

## Troubleshooting

* **Could not connect to Memgraph:**
  Ensure Docker is running and the Memgraph container is started on the correct port (`7687`).

* **Module not found:**
  Make sure you’re running inside the virtual environment and all requirements are installed.

---
