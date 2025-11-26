# memgraph_db.py
import os
from neo4j import GraphDatabase

try:
    # Optional: load .env if python-dotenv is installed
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # Safe to ignore if you don't use python-dotenv
    pass

# You can either set MEMGRAPH_URI directly (e.g. bolt://host:7687)
# OR set MEMGRAPH_HOST + MEMGRAPH_PORT and let us build it.
MEMGRAPH_HOST = os.getenv("MEMGRAPH_HOST", "localhost")
MEMGRAPH_PORT = os.getenv("MEMGRAPH_PORT", "7687")

MEMGRAPH_URI = os.getenv("MEMGRAPH_URI", f"bolt://{MEMGRAPH_HOST}:{MEMGRAPH_PORT}")

_driver = None


def get_memgraph_driver():
    global _driver
    if _driver is None:
        # Memgraph usually runs without auth by default
        _driver = GraphDatabase.driver(MEMGRAPH_URI, auth=None)
    return _driver


def close_memgraph_driver():
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None
