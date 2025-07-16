import os
from pathlib import Path
import requests
import logging
import json
from .parser_loader import load_parsers
from .language_config import LANGUAGE_CONFIGS

BACKEND_URL = "http://localhost:3000"
BATCH_SIZE = 50

logging.basicConfig(level=logging.INFO)

def log_payload(title, data, sample_only=False, sample_count=1):
    logging.info(f"\n--- {title} ---")
    if sample_only and isinstance(data, list):
        logging.info(json.dumps(data[:sample_count], indent=2))
        logging.info(f"Total items: {len(data)}")
    else:
        logging.info(json.dumps(data, indent=2))

def create_graph_snapshot(data):
    log_payload("Creating Snapshot", data)
    resp = requests.post(f"{BACKEND_URL}/graph/snapshots", json=data)
    resp.raise_for_status()
    return resp.json()  # Should contain snapshotId

def batch_save_nodes(snapshot_id, nodes):
    # New: Send as {snapshot_id, nodes: [...]}
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
    log_payload("Creating Subtask", data)
    resp = requests.post(f"{BACKEND_URL}/graph/subtasks", json=data)
    resp.raise_for_status()
    return resp.json()  # Should contain subtaskId

def ast_node_to_graph_node(ast_node, file_path, snapshot_id, commit_id, parent_local_id=None):
    # local_id uniquely identifies a node in your session
    local_id = f"{file_path}:{getattr(ast_node, 'start_byte', 0)}-{getattr(ast_node, 'end_byte', 0)}"
    return {
        "type": str(ast_node.type) if ast_node.type else "",
        "name": "",
        "file_path": file_path or "",
        "commit_id": commit_id or "",
        "metadata": {
            "local_id": local_id,  # Local key for mapping after DB insert
            "start_point": getattr(ast_node, "start_point", (0, 0)),
            "end_point": getattr(ast_node, "end_point", (0, 0)),
            "parent_local_id": parent_local_id or "",
        }
        # DO NOT send node_id!
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

    # Save edge as (parent_local_id, local_id) for later mapping
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

def run_ast_extraction(repo_path, repo_id, task_id, commit_id):
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

        # 1. Create subtask
        subtask_req = {
            "taskId": task_id,
            "language": lang,
            "step": "ast",
            "status": "in_progress",
            "message": f"Extracting AST for {lang}"
        }
        subtask = create_subtask(subtask_req)
        subtask_id = subtask["subtaskId"]

        # 2. Create snapshot for this language/subtask
        snapshot_req = {
            "repoId": repo_id,
            "subtaskId": subtask_id,
            "commitId": commit_id,
            "language": lang,
            "graphType": "AST",
            "version": 1
        }
        snapshot = create_graph_snapshot(snapshot_req)
        snapshot_id = snapshot["snapshotId"]

        all_nodes = []
        all_edges = []
        for file_path in files:
            ast_root = extract_ast_for_file(file_path, parser)
            nodes, edges = traverse_ast(ast_root, file_path, snapshot_id, commit_id)
            all_nodes.extend(nodes)
            all_edges.extend(edges)

        if all_nodes:
            log_payload("Sample Node (pre-batch)", all_nodes, sample_only=True)

        # 3. Batch save nodes (send as {snapshot_id, nodes: [...]})
        for node_batch in batched(all_nodes, BATCH_SIZE):
            batch_save_nodes(snapshot_id, node_batch)
            logging.info(f"Saved batch of {len(node_batch)} nodes for {lang}, snapshot {snapshot_id}")

        # 4. Fetch all DB nodes for mapping
        resp = requests.get(f"{BACKEND_URL}/graph/nodes/{snapshot_id}")
        resp.raise_for_status()
        db_nodes = resp.json()
        # Map from local_id to DB node_id
        local_to_db_id = {
            n["metadata"]["local_id"]: n["node_id"]
            for n in db_nodes
            if "local_id" in n.get("metadata", {}) and n.get("node_id")
        }

        # 5. Build and batch save edges (using DB node_ids)
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
        if edges_to_upload:
            for edge_batch in batched(edges_to_upload, BATCH_SIZE):
                batch_save_edges(snapshot_id, edge_batch)
                logging.info(f"Saved batch of {len(edge_batch)} edges for {lang}, snapshot {snapshot_id}")

        logging.info(f"Finished saving AST nodes/edges for {lang}, snapshot {snapshot_id}")

        # Optionally update subtask to 'completed'
        requests.patch(
            f"{BACKEND_URL}/graph/subtasks/{subtask_id}",
            json={"status": "completed", "message": "AST extraction done"}
        )
