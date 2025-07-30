

# Graph API Documentation

## Overview

This API powers the full workflow for building, managing, and exporting semantic code graphs—covering build orchestration, subtask handling, graph snapshots, and CRUD for nodes/edges/exports.

---

## API Endpoints & Explanations

### 1. **Build (Python Trigger)**

#### `POST /graph/build/:repoId`

**Start a Build Task**

* **What:** Initiates a graph build for the specified repository (optionally, a specific commit).
* **When:** Use this to (re-)build the graph for a repo after a code update.
* **Why:** Kicks off the Python microservice that parses, analyzes, and stores code structure.

#### `GET /graph/status/:repoId`

**Get Current Build Status**

* **What:** Returns the most recent build task for a repo.
* **When:** Track build progress or check for errors before triggering another build.

#### `PATCH /graph/build/:taskId/status`

**Update Build Task Status**

* **What:** Update the state of a build (e.g., from "in\_progress" to "completed").
* **When:** The Python service (or admin) should call this as build steps complete or fail.
* **Why:** Keeps backend and frontend in sync on build progress.

---

### 2. **Subtasks**

#### `POST /graph/subtasks`

**Create Subtask**

* **What:** Creates a build subtask (e.g., “parse Python files”).
* **When:** Automatically called by the build engine for each build step.
* **Why:** Enables granular status tracking.

#### `GET /graph/subtasks/:subtaskId`

**Get Subtask by ID**

* **What:** Fetches the status/details of a specific subtask.
* **When:** For UI status, debugging, or automation.

#### `PATCH /graph/subtasks/:subtaskId`

**Update Subtask**

* **What:** Updates a subtask’s status or metadata.
* **When:** As each subtask step completes or fails.

#### `DELETE /graph/subtasks/:subtaskId`

**Delete Subtask**

* **What:** Removes a subtask by ID.
* **When:** For cleanup or rollback.

#### `GET /graph/subtasks/by-task/:taskId`

**List All Subtasks for a Build Task**

* **What:** Gets all subtasks under a parent build.
* **When:** For frontend dashboards or automation.

---

### 3. **Snapshots**

#### `POST /graph/snapshots`

**Create Snapshot**

* **What:** Creates a versioned snapshot of the code graph for a repo/commit.
* **When:** Every build creates a new snapshot.
* **Why:** Enables graph diffing, rollback, and time-travel.

#### `GET /graph/snapshots/:snapshotId`

**Get Snapshot by ID**

* **What:** Fetches a snapshot’s details by unique ID.

#### `PATCH /graph/snapshots/:snapshotId`

**Update Snapshot**

* **What:** Updates snapshot metadata (e.g., after graph export is generated).

#### `DELETE /graph/snapshots/:snapshotId`

**Delete Snapshot**

* **What:** Permanently removes a snapshot.

#### `GET /graph/snapshots/by-subtask/:subtaskId`

**List Snapshots for a Subtask**

* **What:** Gets all snapshots created during a subtask.

#### `GET /graph/snapshots/by-repo/:repoId`

**List Snapshots for a Repo**

* **What:** Lists all snapshots for a given repo (e.g., one per commit or build).

---

### 4. **Nodes**

#### `POST /graph/nodes/batch`

**Batch Create Nodes**

* **What:** Inserts a list of nodes for a snapshot.
* **When:** The build engine uses this to store all parsed AST/function nodes at once.

#### `POST /graph/nodes/:snapshotId`

**Create Single Node**

* **What:** Adds a single node to a snapshot.

#### `GET /graph/nodes/:snapshotId`

**List Nodes by Snapshot**

* **What:** Fetches all nodes for a snapshot.
* **When:** For visualization or analysis.

#### `PUT /graph/nodes/:nodeId`

**Update Node**

* **What:** Updates properties of a single node.

#### `DELETE /graph/nodes/:nodeId`

**Delete Node**

* **What:** Removes a specific node.

#### `DELETE /graph/nodes/by-snapshot/:snapshotId`

**Delete All Nodes for a Snapshot**

* **What:** Bulk-delete all nodes for a snapshot (e.g., during reset or cleanup).

---

### 5. **Edges**

#### `POST /graph/edges/batch`

**Batch Create Edges**

* **What:** Inserts a list of edges for a snapshot.
* **When:** Used by the build engine after nodes are saved.

#### `POST /graph/edges/:snapshotId`

**Create Single Edge**

* **What:** Adds a single edge to a snapshot.

#### `GET /graph/edges/:snapshotId`

**List Edges by Snapshot**

* **What:** Fetches all edges for a snapshot.

#### `PUT /graph/edges/:edgeId`

**Update Edge**

* **What:** Updates properties of a single edge.

#### `DELETE /graph/edges/:edgeId`

**Delete Edge**

* **What:** Removes a specific edge.

#### `DELETE /graph/edges/by-snapshot/:snapshotId`

**Delete All Edges for a Snapshot**

* **What:** Bulk-delete all edges for a snapshot.

---

### 6. **Exports**

#### `POST /graph/exports`

**Create Graph Export**

* **What:** Triggers generation of an export (e.g., GraphML, CSV).
* **Why:** Supports sharing, visualization, or ML use cases.

#### `GET /graph/exports/:exportId`

**Get Export by ID**

* **What:** Get details or download link for a specific export.

#### `PATCH /graph/exports/:exportId`

**Update Export**

* **What:** Updates metadata (e.g., export status, download url).

#### `DELETE /graph/exports/:exportId`

**Delete Export**

* **What:** Remove an export from the system.

#### `GET /graph/exports/by-repo/:repoId`

**List Exports by Repo**

* **What:** Show all exports generated for a repository.

---

## Error Handling

All endpoints return conventional HTTP status codes:

* `200 OK`/`201 Created` for success
* `202 Accepted` for async/trigger endpoints
* `404 Not Found` for missing resources
* `400 Bad Request` for invalid input

---

## Field/DTO Details

See the dto repository for detailed dto implementation

---

## What's Missing or Not Covered

* **Authentication**
* **Pagination & Filtering**
* **Bulk updates**
* **Webhooks/notifications**
* **Validation of complex graph invariants**
* **Docs for query APIs (e.g., custom queries for code intelligence)**

---
