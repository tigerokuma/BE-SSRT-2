import os
from pathlib import Path
import requests
import urllib.parse
import logging
import json
from datetime import datetime
from .parser_loader import load_parsers
from .language_config import LANGUAGE_CONFIGS
from .memgraph_db import get_memgraph_driver, close_memgraph_driver
from .export_graph import export_graphml, export_json, export_csv

BACKEND_URL = "http://localhost:3000"
BATCH_SIZE = 50

logging.basicConfig(level=logging.INFO)

def update_task_status(task_id, status, message="", started_at=None, finished_at=None, commit_id=None):
    payload = {"status": status, "message": message}
    if started_at:
        payload["started_at"] = started_at
    if finished_at:
        payload["finished_at"] = finished_at
    if commit_id:
        payload["commit_id"] = commit_id

    try:
        resp = requests.patch(f"{BACKEND_URL}/graph/build/{task_id}/status", json=payload)
        resp.raise_for_status()
        logging.info(f"✅ Task {task_id} updated to {status} with timing {started_at=} {finished_at=}")
    except Exception as e:
        logging.error(f"❌ Failed to update task status: {e}")

def update_graph_snapshot(snapshot_id, node_count, edge_count, s3_url=None):
    payload = {
        "node_count": node_count,
        "edge_count": edge_count,
        "finished_at": datetime.utcnow().isoformat(),
        "status": "completed"
    }
    if s3_url:
        payload["s3_url"] = s3_url
    try:
        requests.patch(f"{BACKEND_URL}/graph/snapshots/{snapshot_id}", json=payload)
        logging.info(
            f"📊 Updated snapshot {snapshot_id} with node_count={node_count}, edge_count={edge_count}, s3_url={s3_url}"
        )
    except Exception as e:
        logging.error(f"❌ Failed to update snapshot {snapshot_id} with counts: {e}")

def update_subtask_status(subtask_id, message="", status="completed"):
    payload = {
        "status": status,
        "message": message,
        "finished_at": datetime.utcnow().isoformat()
    }
    try:
        requests.patch(f"{BACKEND_URL}/graph/subtasks/{subtask_id}", json=payload)
        logging.info(f"🕒 Subtask {subtask_id} finished at {payload['finished_at']}")
    except Exception as e:
        logging.error(f"❌ Failed to update subtask {subtask_id}: {e}")

def log_payload(title, data, sample_only=False, sample_count=1):
    logging.info(f"\n--- {title} ---")
    if sample_only and isinstance(data, list):
        logging.info(json.dumps(data[:sample_count], indent=2))
        logging.info(f"Total items: {len(data)}")
    else:
        logging.info(json.dumps(data, indent=2))

def create_graph_snapshot(data):
    data["created_at"] = datetime.utcnow().isoformat()
    log_payload("Creating Snapshot", data)
    resp = requests.post(f"{BACKEND_URL}/graph/snapshots", json=data)
    resp.raise_for_status()
    logging.info(f"🕒 Snapshot created at {data['created_at']}")
    return resp.json()

def batch_save_nodes(snapshot_id, nodes):
    log_payload("Batch Saving Nodes", nodes, sample_only=True)
    resp = requests.post(f"{BACKEND_URL}/graph/nodes/batch", json={"snapshot_id": snapshot_id, "nodes": nodes})
    resp.raise_for_status()
    return resp.json()

def batch_save_edges(snapshot_id, edges):
    log_payload("Batch Saving Edges", edges, sample_only=True)
    resp = requests.post(f"{BACKEND_URL}/graph/edges/batch", json={"snapshot_id": snapshot_id, "edges": edges})
    resp.raise_for_status()
    return resp.json()

def extract_ast_for_file(file_path, parser):
    with open(file_path, "rb") as f:
        code = f.read()
    tree = parser.parse(code)
    root_node = tree.root_node
    return root_node

def create_subtask(data):
    data["started_at"] = datetime.utcnow().isoformat()
    log_payload("Creating Subtask", data)
    resp = requests.post(f"{BACKEND_URL}/graph/subtasks", json=data)
    resp.raise_for_status()
    logging.info(f"🕒 Subtask started at {data['started_at']}")
    return resp.json()

def ast_node_to_graph_node(ast_node, file_path, snapshot_id, commit_id, parent_local_id=None):
    local_id = f"{file_path}:{getattr(ast_node, 'start_byte', 0)}-{getattr(ast_node, 'end_byte', 0)}"
    return {
        "type": str(ast_node.type) if ast_node.type else "",
        "name": "",
        "file_path": file_path or "",
        "commit_id": commit_id or "",
        "metadata": {
            "local_id": local_id,
            "start_point": getattr(ast_node, "start_point", (0, 0)),
            "end_point": getattr(ast_node, "end_point", (0, 0)),
            "parent_local_id": parent_local_id or "",
        }
    }

def batched(items, batch_size):
    for i in range(0, len(items), batch_size):
        yield items[i:i + batch_size]

def traverse_ast(ast_node, file_path, snapshot_id, commit_id, parent_local_id=None, nodes=None, edges=None):
    if nodes is None: nodes = []
    if edges is None: edges = []

    local_id = f"{file_path}:{getattr(ast_node, 'start_byte', 0)}-{getattr(ast_node, 'end_byte', 0)}"
    node = ast_node_to_graph_node(ast_node, file_path, snapshot_id, commit_id, parent_local_id)
    nodes.append(node)

    if parent_local_id is not None:
        edges.append({
            "source_local_id": parent_local_id,
            "target_local_id": local_id,
            "relation": "ast_child",
            "metadata": {},
        })
    for child in getattr(ast_node, "children", []):
        traverse_ast(child, file_path, snapshot_id, commit_id, parent_local_id=local_id, nodes=nodes, edges=edges)
    return nodes, edges

def memgraph_save_nodes(nodes, snapshot_id):
    driver = get_memgraph_driver()
    with driver.session() as session:
        for node in nodes:
            session.run(
                """
                MERGE (n:ASTNode {local_id: $local_id, snapshot_id: $snapshot_id})
                SET n += $props
                """,
                local_id=node["metadata"]["local_id"],
                snapshot_id=snapshot_id,
                props={
                    "type": node["type"],
                    "name": node.get("name", ""),
                    "file_path": node.get("file_path", ""),
                    "commit_id": node.get("commit_id", ""),
                    "metadata": json.dumps(node.get("metadata", {})),
                }
            )

def memgraph_save_edges(edges, snapshot_id):
    driver = get_memgraph_driver()
    with driver.session() as session:
        for edge in edges:
            session.run(
                """
                MATCH (src:ASTNode {local_id: $source_local_id, snapshot_id: $snapshot_id})
                MATCH (tgt:ASTNode {local_id: $target_local_id, snapshot_id: $snapshot_id})
                MERGE (src)-[r:AST_EDGE {relation: $relation}]->(tgt)
                SET r.metadata = $metadata
                """,
                source_local_id=edge["source_local_id"],
                target_local_id=edge["target_local_id"],
                relation=edge["relation"],
                metadata=json.dumps(edge.get("metadata", {})),
                snapshot_id=snapshot_id
            )
def find_existing_snapshot(repo_id, commit_id):
    """
    Returns the snapshot dict if one exists with the same repo_id and commit_id.
    Returns None if not found.
    """
    # Encode repo_id for URL safety (handles slashes etc.)
    repo_id_encoded = urllib.parse.quote(repo_id, safe='')

    try:
        resp = requests.get(f"{BACKEND_URL}/graph/snapshots/by-repo/{repo_id_encoded}")
        resp.raise_for_status()
        snapshots = resp.json()
        # Normalize commit_id for comparison
        commit_id_str = (commit_id or "")
        for snap in snapshots:
            snap_commit_id = (snap.get("commit_id") or "") == (commit_id or "")
            if snap_commit_id == commit_id_str:
                return snap
        return None
    except Exception as e:
        logging.error(f"Failed to check existing snapshot: {e}")
        return None

def run_ast_extraction(repo_path, repo_id, task_id, commit_id):
    existing_snapshot = find_existing_snapshot(repo_id, commit_id)
    if existing_snapshot:
        logging.info(
            f"Snapshot for repo_id={repo_id}, commit_id={commit_id!r} already exists (snapshot_id={existing_snapshot['snapshot_id']}). Skipping extraction."
        )
        update_task_status(task_id, "skipped", "Snapshot already exists, skipping extraction.")
        return
    task_start = datetime.utcnow().isoformat()
    update_task_status(task_id, "in_progress", "Starting build task", started_at=task_start, commit_id=commit_id)

    parsers, _ = load_parsers()
    for lang, config in LANGUAGE_CONFIGS.items():
        parser = parsers.get(lang)
        if not parser:
            continue

        files = []
        for root, dirs, fnames in os.walk(repo_path):
            for fname in fnames:
                ext = Path(fname).suffix
                if ext in config.file_extensions:
                    files.append(os.path.join(root, fname))
        if not files:
            continue

        subtask_req = {
            "task_id": task_id,
            "language": lang,
            "step": "ast",
            "status": "in_progress",
            "message": f"Extracting AST for {lang}"
        }
        subtask = create_subtask(subtask_req)
        subtask_id = subtask["subtask_id"]

        snapshot_req = {
            "repo_id": repo_id,
            "subtask_id": subtask_id,
            "commit_id": commit_id,
            "language": lang,
            "graph_type": "AST",
            "version": 1
        }
        snapshot = create_graph_snapshot(snapshot_req)
        snapshot_id = snapshot["snapshot_id"]

        all_nodes = []
        all_edges = []
        for file_path in files:
            ast_root = extract_ast_for_file(file_path, parser)
            nodes, edges = traverse_ast(ast_root, file_path, snapshot_id, commit_id)
            all_nodes.extend(nodes)
            all_edges.extend(edges)

        if all_nodes:
            log_payload("Sample Node (pre-batch)", all_nodes, sample_only=True)

        # --- SAVE TO POSTGRESQL (API) ---
        for node_batch in batched(all_nodes, BATCH_SIZE):
            batch_save_nodes(snapshot_id, node_batch)
            logging.info(f"Saved batch of {len(node_batch)} nodes for {lang}, snapshot {snapshot_id}")

        # --- (Build edge mapping for REST API) ---
        resp = requests.get(f"{BACKEND_URL}/graph/nodes/{snapshot_id}")
        resp.raise_for_status()
        db_nodes = resp.json()
        local_to_db_id = {
            n["metadata"]["local_id"]: n["node_id"]
            for n in db_nodes
            if "local_id" in n.get("metadata", {}) and n.get("node_id")
        }
        edges_to_upload = []
        for edge in all_edges:
            source_id = local_to_db_id.get(edge["source_local_id"])
            target_id = local_to_db_id.get(edge["target_local_id"])
            if source_id and target_id:
                edges_to_upload.append({
                    "source_id": source_id,
                    "target_id": target_id,
                    "relation": edge["relation"],
                    "metadata": edge["metadata"],
                })

        for edge_batch in batched(edges_to_upload, BATCH_SIZE):
            batch_save_edges(snapshot_id, edge_batch)
            logging.info(f"Saved batch of {len(edge_batch)} edges for {lang}, snapshot {snapshot_id}")

        # --- ALSO SAVE TO MEMGRAPH (same AST local_id graph) ---
        memgraph_save_nodes(all_nodes, snapshot_id)
        memgraph_save_edges(all_edges, snapshot_id)

        # --- EXPORT GRAPHML ---
        graphml_path = export_graphml(snapshot_id)
        json_path = export_json(snapshot_id)
        nodes_csv_path, edges_csv_path = export_csv(snapshot_id)
        base_url = f"/static/exports/graph_snapshot_{snapshot_id}"
        download_urls = {
            "graphml": f"{base_url}.graphml",
            "json": f"{base_url}.json",
            "nodes_csv": f"{base_url}_nodes.csv",
            "edges_csv": f"{base_url}_edges.csv"
        }
        # Option 1: Store as JSON string
        urls_str = json.dumps(download_urls)

        # --- UPDATE SNAPSHOT w/ URL ---
        update_graph_snapshot(snapshot_id, len(all_nodes), len(edges_to_upload), s3_url=urls_str)
        update_subtask_status(subtask_id, message="AST extraction done. GraphML ready.")

    task_end = datetime.utcnow().isoformat()
    update_task_status(task_id, "completed", "Build task finished", finished_at=task_end, commit_id=commit_id)
    close_memgraph_driver()
