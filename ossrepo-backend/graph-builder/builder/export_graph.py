# export_graph.py

import os
import csv
import json
import tempfile
import logging
from typing import Tuple
from .memgraph_db import get_memgraph_driver

# -------------------- Config --------------------

# Backend toggles kept for later, but ignored for now (forced to 'local')
EXPORT_BACKEND = os.getenv("EXPORT_BACKEND", "local").lower()  # local | gcs | s3
EXPORT_DIR = os.getenv("EXPORT_DIR", "exports")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "/static/exports").rstrip("/")

# Relationship label used by your writer
EDGE_LABEL = "CODE_EDGE"

logger = logging.getLogger(__name__)

# -------------------- Storage backends --------------------

class Storage:
    def upload_file(self, src_path: str, key: str, content_type: str) -> str:
        """Upload src_path to storage under key. Return public URL."""
        raise NotImplementedError

    def local_prepare_path(self, key: str) -> str:
        """Return a local dest path to move/copy to (local backend)."""
        raise NotImplementedError

class LocalStorage(Storage):
    def __init__(self, export_dir: str, base_url: str):
        self.export_dir = export_dir
        self.base_url = base_url.rstrip("/")

    def upload_file(self, src_path: str, key: str, content_type: str) -> str:
        # For local, "upload" = move into EXPORT_DIR and return /static URL
        dest_path = self.local_prepare_path(key)
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        if os.path.exists(dest_path):
            os.remove(dest_path)
        os.replace(src_path, dest_path)
        return f"{self.base_url}/{key}"

    def local_prepare_path(self, key: str) -> str:
        return os.path.join(self.export_dir, key)

# ---- GCS/S3 backends commented out for now ----
"""
# GCS
class GCSStorage(Storage):
    def __init__(self, bucket: str, base_url: str | None):
        from google.cloud import storage
        self.client = storage.Client()
        self.bucket = self.client.bucket(bucket)
        self.base_url = (base_url or f"https://storage.googleapis.com/{bucket}").rstrip("/")

    def upload_file(self, src_path: str, key: str, content_type: str) -> str:
        blob = self.bucket.blob(key)
        blob.upload_from_filename(src_path, content_type=content_type)
        return f"{self.base_url}/{key}"

    def local_prepare_path(self, key: str) -> str:
        raise NotImplementedError("Not applicable for GCS backend")

# S3 / R2
class S3Storage(Storage):
    def __init__(self, bucket: str, endpoint_url: str | None, region: str,
                 access_key: str | None, secret_key: str | None, base_url: str | None):
        import boto3
        session = boto3.session.Session(
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
        )
        self.s3 = session.client("s3", endpoint_url=endpoint_url)
        self.bucket = bucket
        self.base_url = base_url.rstrip("/") if base_url else None
        self.endpoint_url = endpoint_url

    def upload_file(self, src_path: str, key: str, content_type: str) -> str:
        self.s3.upload_file(src_path, self.bucket, key, ExtraArgs={"ContentType": content_type})
        if self.base_url:
            return f"{self.base_url}/{key}"
        if self.endpoint_url:
            return f"{self.endpoint_url.rstrip('/')}/{self.bucket}/{key}"
        return f"https://{self.bucket}.s3.amazonaws.com/{key}"

    def local_prepare_path(self, key: str) -> str:
        raise NotImplementedError("Not applicable for S3 backend")
"""

def _get_storage() -> Storage:
    # Force local for now; warn if env suggests otherwise
    if EXPORT_BACKEND != "local":
        logger.warning("EXPORT_BACKEND=%s ignored; using local storage only.", EXPORT_BACKEND)
    os.makedirs(EXPORT_DIR, exist_ok=True)
    return LocalStorage(EXPORT_DIR, PUBLIC_BASE_URL)

# -------------------- Export helpers --------------------

def _tmp_file(suffix: str) -> str:
    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    return path

def export_graphml(snapshot_id: str) -> Tuple[str, str]:
    """
    Export to GraphML and return (local_or_temp_path, public_url).
    """
    storage = _get_storage()
    tmp_path = _tmp_file(".graphml")
    key = f"graph_snapshot_{snapshot_id}.graphml"

    driver = get_memgraph_driver()
    with driver.session() as session, open(tmp_path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<graphml xmlns="http://graphml.graphdrawing.org/xmlns">\n')
        f.write('<graph id="G" edgedefault="directed">\n')

        # Nodes
        nodes = session.run(
            "MATCH (n:ASTNode {snapshot_id: $snapshot_id}) RETURN n",
            snapshot_id=snapshot_id
        )
        for record in nodes:
            node = record["n"]
            node_id = node.get("local_id")
            label = node.get("type", "")
            f.write(f'  <node id="{_xml_escape(node_id)}"><data key="label">{_xml_escape(label)}</data></node>\n')

        # Edges
        edges = session.run(
            f"""
            MATCH (a:ASTNode {{snapshot_id: $snapshot_id}})-[r:{EDGE_LABEL}]->(b:ASTNode {{snapshot_id: $snapshot_id}})
            RETURN a.local_id AS src, b.local_id AS tgt, r.relation AS rel
            """,
            snapshot_id=snapshot_id
        )
        for record in edges:
            src = record["src"]
            tgt = record["tgt"]
            rel = record["rel"]
            f.write(f'  <edge source="{_xml_escape(src)}" target="{_xml_escape(tgt)}"><data key="relation">{_xml_escape(rel)}</data></edge>\n')

        f.write('</graph>\n</graphml>\n')

    url = storage.upload_file(tmp_path, key, "application/graphml+xml")
    return tmp_path, url

def export_csv(snapshot_id: str) -> Tuple[str, str, str, str]:
    """
    Export nodes and edges as CSVs.
    Returns: (nodes_tmp_path, nodes_url, edges_tmp_path, edges_url)
    """
    storage = _get_storage()
    nodes_tmp = _tmp_file("_nodes.csv")
    edges_tmp = _tmp_file("_edges.csv")
    nodes_key = f"graph_snapshot_{snapshot_id}_nodes.csv"
    edges_key = f"graph_snapshot_{snapshot_id}_edges.csv"

    driver = get_memgraph_driver()
    with driver.session() as session:
        # Nodes
        nodes = session.run(
            "MATCH (n:ASTNode {snapshot_id: $snapshot_id}) RETURN n",
            snapshot_id=snapshot_id
        )
        with open(nodes_tmp, "w", encoding="utf-8", newline="") as nfile:
            writer = csv.writer(nfile)
            writer.writerow(["local_id", "type", "name", "file_path", "commit_id", "metadata"])
            for record in nodes:
                node = record["n"]
                writer.writerow([
                    node.get("local_id"),
                    node.get("type", ""),
                    node.get("name", ""),
                    node.get("file_path", ""),
                    node.get("commit_id", ""),
                    json.dumps(node.get("metadata", {})),
                ])

        # Edges
        edges = session.run(
            f"""
            MATCH (a:ASTNode {{snapshot_id: $snapshot_id}})-[r:{EDGE_LABEL}]->(b:ASTNode {{snapshot_id: $snapshot_id}})
            RETURN a.local_id AS src, b.local_id AS tgt, r.relation AS rel, r.metadata AS metadata
            """,
            snapshot_id=snapshot_id
        )
        with open(edges_tmp, "w", encoding="utf-8", newline="") as efile:
            writer = csv.writer(efile)
            writer.writerow(["source", "target", "relation", "metadata"])
            for record in edges:
                writer.writerow([
                    record["src"],
                    record["tgt"],
                    record["rel"],
                    json.dumps(record.get("metadata", {})),
                ])

    url_nodes = storage.upload_file(nodes_tmp, nodes_key, "text/csv")
    url_edges = storage.upload_file(edges_tmp, edges_key, "text/csv")
    return nodes_tmp, url_nodes, edges_tmp, url_edges

def export_json(snapshot_id: str) -> Tuple[str, str]:
    """
    Export nodes+edges as a single JSON file.
    Returns: (json_tmp_path, json_url)
    """
    storage = _get_storage()
    json_tmp = _tmp_file(".json")
    json_key = f"graph_snapshot_{snapshot_id}.json"

    driver = get_memgraph_driver()
    with driver.session() as session:
        # Nodes
        nodes_result = session.run(
            "MATCH (n:ASTNode {snapshot_id: $snapshot_id}) RETURN n",
            snapshot_id=snapshot_id
        )
        nodes = []
        for record in nodes_result:
            node = record["n"]
            nodes.append({
                "local_id": node.get("local_id"),
                "type": node.get("type", ""),
                "name": node.get("name", ""),
                "file_path": node.get("file_path", ""),
                "commit_id": node.get("commit_id", ""),
                "metadata": node.get("metadata", {}),
            })

        # Edges
        edges_result = session.run(
            f"""
            MATCH (a:ASTNode {{snapshot_id: $snapshot_id}})-[r:{EDGE_LABEL}]->(b:ASTNode {{snapshot_id: $snapshot_id}})
            RETURN a.local_id AS src, b.local_id AS tgt, r.relation AS rel, r.metadata AS metadata
            """,
            snapshot_id=snapshot_id
        )
        edges = []
        for record in edges_result:
            edges.append({
                "source": record["src"],
                "target": record["tgt"],
                "relation": record["rel"],
                "metadata": record.get("metadata", {}),
            })

    with open(json_tmp, "w", encoding="utf-8") as jf:
        json.dump({"nodes": nodes, "edges": edges}, jf, indent=2)

    url = _get_storage().upload_file(json_tmp, json_key, "application/json")
    return json_tmp, url

# -------------------- small utils --------------------

def _xml_escape(s: str | None) -> str:
    if not s:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )
