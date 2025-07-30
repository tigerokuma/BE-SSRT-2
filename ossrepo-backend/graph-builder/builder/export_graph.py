# export_graph.py

import os
from neo4j import GraphDatabase
from .memgraph_db import get_memgraph_driver

EXPORT_DIR = "exports"

def ensure_export_dir():
    if not os.path.exists(EXPORT_DIR):
        os.makedirs(EXPORT_DIR)

def export_graphml(snapshot_id):
    """
    Exports all nodes/edges for a given snapshot_id to GraphML.
    Returns: local filepath (can be used as a download URL endpoint in your app)
    """
    ensure_export_dir()
    filepath = os.path.join(EXPORT_DIR, f"graph_snapshot_{snapshot_id}.graphml")
    driver = get_memgraph_driver()
    with driver.session() as session, open(filepath, "w", encoding="utf-8") as f:
        # GraphML header
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<graphml xmlns="http://graphml.graphdrawing.org/xmlns">\n<graph id="G" edgedefault="directed">\n')

        # Nodes
        nodes = session.run("MATCH (n:ASTNode {snapshot_id: $snapshot_id}) RETURN n", snapshot_id=snapshot_id)
        for record in nodes:
            node = record["n"]
            node_id = node.get("local_id")
            label = node.get("type", "")
            f.write(f'  <node id="{node_id}"><data key="label">{label}</data></node>\n')

        # Edges
        edges = session.run("""
            MATCH (a:ASTNode {snapshot_id: $snapshot_id})-[r:AST_EDGE]->(b:ASTNode {snapshot_id: $snapshot_id})
            RETURN a.local_id AS src, b.local_id AS tgt, r.relation AS rel
        """, snapshot_id=snapshot_id)
        for record in edges:
            src = record["src"]
            tgt = record["tgt"]
            rel = record["rel"]
            f.write(f'  <edge source="{src}" target="{tgt}"><data key="relation">{rel}</data></edge>\n')

        # GraphML footer
        f.write('</graph>\n</graphml>\n')
    return filepath
