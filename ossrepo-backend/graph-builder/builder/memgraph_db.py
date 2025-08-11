# memgraph_db.py
import os

from neo4j import GraphDatabase

MEMGRAPH_URI = os.getenv("MEMGRAPH_URI", "bolt://localhost:7687")

_driver = None

def get_memgraph_driver():
    global _driver
    if _driver is None:
        _driver = GraphDatabase.driver(MEMGRAPH_URI, auth=None)
    return _driver

def close_memgraph_driver():
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None
