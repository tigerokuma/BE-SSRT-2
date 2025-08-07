# export_graph.py

import os
import csv
import json
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

def export_csv(snapshot_id):
    """
    Exports nodes and edges for a given snapshot_id to two CSV files.
    Returns: (nodes_csv_path, edges_csv_path)
    """
    ensure_export_dir()
    nodes_csv = os.path.join(EXPORT_DIR, f"graph_snapshot_{snapshot_id}_nodes.csv")
    edges_csv = os.path.join(EXPORT_DIR, f"graph_snapshot_{snapshot_id}_edges.csv")
    driver = get_memgraph_driver()
    with driver.session() as session:
        # Nodes
        nodes = session.run("MATCH (n:ASTNode {snapshot_id: $snapshot_id}) RETURN n", snapshot_id=snapshot_id)
        with open(nodes_csv, "w", encoding="utf-8", newline='') as nfile:
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
        edges = session.run("""
            MATCH (a:ASTNode {snapshot_id: $snapshot_id})-[r:AST_EDGE]->(b:ASTNode {snapshot_id: $snapshot_id})
            RETURN a.local_id AS src, b.local_id AS tgt, r.relation AS rel, r.metadata AS metadata
        """, snapshot_id=snapshot_id)
        with open(edges_csv, "w", encoding="utf-8", newline='') as efile:
            writer = csv.writer(efile)
            writer.writerow(["source", "target", "relation", "metadata"])
            for record in edges:
                writer.writerow([
                    record["src"],
                    record["tgt"],
                    record["rel"],
                    json.dumps(record.get("metadata", {})),
                ])

    return nodes_csv, edges_csv

def export_json(snapshot_id):
    """
    Exports nodes and edges for a given snapshot_id to a single JSON file.
    Returns: json_file_path
    """
    ensure_export_dir()
    json_path = os.path.join(EXPORT_DIR, f"graph_snapshot_{snapshot_id}.json")
    driver = get_memgraph_driver()
    with driver.session() as session:
        # Nodes
        nodes_result = session.run("MATCH (n:ASTNode {snapshot_id: $snapshot_id}) RETURN n", snapshot_id=snapshot_id)
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
        edges_result = session.run("""
            MATCH (a:ASTNode {snapshot_id: $snapshot_id})-[r:AST_EDGE]->(b:ASTNode {snapshot_id: $snapshot_id})
            RETURN a.local_id AS src, b.local_id AS tgt, r.relation AS rel, r.metadata AS metadata
        """, snapshot_id=snapshot_id)
        edges = []
        for record in edges_result:
            edges.append({
                "source": record["src"],
                "target": record["tgt"],
                "relation": record["rel"],
                "metadata": record.get("metadata", {}),
            })

    # Save JSON
    with open(json_path, "w", encoding="utf-8") as jf:
        json.dump({
            "nodes": nodes,
            "edges": edges,
        }, jf, indent=2)
    return json_path
