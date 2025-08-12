import os
from pathlib import Path
import requests
import urllib.parse
import logging
import json
from datetime import datetime
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed  # parallel blame

from .parser_loader import load_parsers
from .language_config import LANGUAGE_CONFIGS, LanguageConfig
from .memgraph_db import get_memgraph_driver, close_memgraph_driver
from .export_graph import export_graphml, export_json, export_csv  # keep your existing helpers

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "10000"))

logging.basicConfig(level=logging.INFO)

IGNORE_DIRS = {
    ".git", ".hg", ".svn",
    "node_modules", "dist", "build", "out",
    ".venv", "venv", "__pycache__", ".pytest_cache",
    "target", "bin", "obj",
    ".idea", ".vscode",
    "third_party", "vendor",
    "test", "tests", "__tests__",
}


# ------------------------------ REST helpers ------------------------------

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
        logging.info(f"✅ Task {task_id} updated to {status}")
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
        logging.info(f"📊 Updated snapshot {snapshot_id} nodes={node_count} edges={edge_count}")
    except Exception as e:
        logging.error(f"❌ Failed to update snapshot {snapshot_id}: {e}")


def update_subtask_status(subtask_id, message="", status="completed"):
    payload = {"status": status, "message": message, "finished_at": datetime.utcnow().isoformat()}
    try:
        requests.patch(f"{BACKEND_URL}/graph/subtasks/{subtask_id}", json=payload)
    except Exception as e:
        logging.error(f"❌ Failed to update subtask {subtask_id}: {e}")


def create_graph_snapshot(data):
    data["created_at"] = datetime.utcnow().isoformat()
    resp = requests.post(f"{BACKEND_URL}/graph/snapshots", json=data)
    resp.raise_for_status()
    return resp.json()


def create_subtask(data):
    data["started_at"] = datetime.utcnow().isoformat()
    resp = requests.post(f"{BACKEND_URL}/graph/subtasks", json=data)
    resp.raise_for_status()
    return resp.json()


# ------------------------------ AST helpers ------------------------------

def extract_ast_for_file(file_path, parser):
    with open(file_path, "rb") as f:
        code = f.read()
    tree = parser.parse(code)
    return tree.root_node, code


def _local_id(file_path, n):
    return f"{file_path}:{getattr(n, 'start_byte', 0)}-{getattr(n, 'end_byte', 0)}"


def _text_slice(code: bytes, node):
    return code[getattr(node, "start_byte", 0):getattr(node, "end_byte", 0)].decode("utf-8", "ignore")


def _node_kind(ast_type: str, cfg: LanguageConfig) -> str:
    # Nice labels for Markdown (safe to keep)
    if getattr(cfg, "name", "").lower() == "markdown":
        if ast_type in ("atx_heading", "setext_heading"):
            return "Section"
        if ast_type in ("fenced_code_block", "indented_code_block"):
            return "CodeBlock"
        if ast_type in ("link", "image"):
            return ast_type.capitalize()
        # fall through

    if ast_type in cfg.function_node_types: return "Function"
    if ast_type in cfg.class_node_types:    return "Class"
    if ast_type in cfg.call_node_types:     return "Call"
    if ast_type in cfg.if_node_types:       return "If"
    if ast_type in cfg.loop_node_types:     return "Loop"
    if ast_type in cfg.switch_node_types:   return "Switch"
    if ast_type in cfg.try_node_types:      return "Try"
    if ast_type in cfg.catch_node_types:    return "Catch"
    return ast_type


def _extract_name(ast_node, code: bytes, cfg: LanguageConfig, kind: str) -> str:
    if kind in ("Function", "Class"):
        n = ast_node.child_by_field_name(cfg.name_field) or ast_node.child_by_field_name("identifier")
        return _text_slice(code, n) if n else ""
    if kind == "Call":
        callee = ast_node.child_by_field_name("function") or ast_node.child_by_field_name("callee")
        return _text_slice(code, callee) if callee else ""
    return ""


def _safe_unlink(p: str | None):
    if not p: return
    try:
        os.remove(p)
    except Exception:
        pass


def _to_point(p):
    if p is None: return None
    try:
        return [int(p.row), int(p.column)]
    except Exception:
        try:
            r, c = p; return [int(r), int(c)]
        except Exception:
            return None


def _should_materialize_node(ast_node, cfg: LanguageConfig) -> bool:
    t = getattr(ast_node, "type", "")
    is_named = bool(getattr(ast_node, "is_named", False))
    if is_named: return True
    return (
            t in cfg.function_node_types
            or t in cfg.class_node_types
            or t in cfg.call_node_types
            or t in cfg.module_node_types
            or t in cfg.if_node_types
            or t in cfg.loop_node_types
            or t in cfg.switch_node_types
            or t in cfg.try_node_types
            or t in cfg.catch_node_types
            or t in cfg.block_node_types
            or cfg.is_statement(ast_node)
    )


def _dedup_nodes(nodes):
    seen, out = set(), []
    for n in nodes:
        lid = n["metadata"]["local_id"]
        if lid in seen: continue
        seen.add(lid);
        out.append(n)
    return out


def _dedup_edges(edges):
    seen, out = set(), []
    for e in edges:
        k = (e["source_local_id"], e["target_local_id"], e["relation"])
        if k in seen: continue
        seen.add(k);
        out.append(e)
    return out


def ast_node_to_graph_node(ast_node, file_path, commit_id, parent_local_id, cfg, code):
    kind = _node_kind(ast_node.type, cfg)
    snippet = _text_slice(code, ast_node)
    if len(snippet) > 2000: snippet = snippet[:2000]
    sp = _to_point(getattr(ast_node, "start_point", None))
    ep = _to_point(getattr(ast_node, "end_point", None))
    start_line = (sp[0] + 1) if (sp and len(sp) >= 1) else None
    end_line = (ep[0] + 1) if (ep and len(ep) >= 1) else None
    return {
        "type": kind,
        "name": _extract_name(ast_node, code, cfg, kind),
        "file_path": file_path,
        "commit_id": commit_id or "",
        "metadata": {
            "local_id": _local_id(file_path, ast_node),
            "ast_type": ast_node.type,
            "start_point": sp,
            "end_point": ep,
            "start_line": start_line,
            "end_line": end_line,
            "snippet": snippet,
            "parent_local_id": parent_local_id or "",
        }
    }


def traverse_ast(ast_node, file_path, snapshot_id, commit_id, parent_local_id, nodes, edges, cfg, code, ast_map):
    nid = _local_id(file_path, ast_node)
    ast_map[nid] = ast_node
    if _should_materialize_node(ast_node, cfg):
        node = ast_node_to_graph_node(ast_node, file_path, commit_id, parent_local_id, cfg, code)
        nodes.append(node)
        cur_parent = node["metadata"]["local_id"]
        if parent_local_id:
            edges.append({
                "source_local_id": parent_local_id,
                "target_local_id": cur_parent,
                "relation": "ast_child",
                "metadata": {}
            })
    else:
        cur_parent = parent_local_id
    for child in getattr(ast_node, "children", []):
        traverse_ast(child, file_path, snapshot_id, commit_id, cur_parent, nodes, edges, cfg, code, ast_map)


def _block_statements(block, cfg):
    return [ch for ch in getattr(block, "children", []) if cfg.is_statement(ch)]


def _first_stmt(node, cfg):
    for fld in (*cfg.then_field_names, *cfg.else_field_names, cfg.body_field):
        child = node.child_by_field_name(fld)
        if child: return child
    for ch in getattr(node, "children", []):
        if getattr(ch, "is_named", False): return ch
    return None


def build_cfg_edges_for_function(func_node, file_path, cfg):
    edges = []
    body = func_node.child_by_field_name(cfg.body_field)
    if body:
        def walk(block):
            stmts = _block_statements(block, cfg)
            for i in range(len(stmts) - 1):
                a, b = stmts[i], stmts[i + 1]
                edges.append({"source_local_id": _local_id(file_path, a),
                              "target_local_id": _local_id(file_path, b),
                              "relation": "next", "metadata": {}})
            for s in stmts:
                for ch in getattr(s, "children", []):
                    if ch.type in cfg.block_node_types: walk(ch)

        walk(body)

    for n in getattr(func_node, "children", []):
        t = getattr(n, "type", "")
        if t in cfg.if_node_types:
            then_n = None
            for fld in cfg.then_field_names:
                then_n = then_n or n.child_by_field_name(fld)
            else_n = None
            for fld in cfg.else_field_names:
                else_n = else_n or n.child_by_field_name(fld)
            src = _local_id(file_path, n)
            if then_n:
                edges.append({"source_local_id": src, "target_local_id": _local_id(file_path, then_n),
                              "relation": "branch_true", "metadata": {}})
            if else_n:
                edges.append({"source_local_id": src, "target_local_id": _local_id(file_path, else_n),
                              "relation": "branch_false", "metadata": {}})
        if t in cfg.loop_node_types:
            body_n = n.child_by_field_name(cfg.body_field) or _first_stmt(n, cfg)
            src = _local_id(file_path, n)
            if body_n:
                first_id = _local_id(file_path, body_n)
                edges.append({"source_local_id": src, "target_local_id": first_id,
                              "relation": "loop_body", "metadata": {}})
                if body_n.type in cfg.block_node_types:
                    stmts = _block_statements(body_n, cfg)
                    if stmts:
                        last = stmts[-1]
                        edges.append({"source_local_id": _local_id(file_path, last),
                                      "target_local_id": src, "relation": "loop_back",
                                      "metadata": {}})
    return edges


# ------------------------------ Git helpers (limit blame to changed files) ------------------------------

def _is_git_repo(repo_path: str) -> bool:
    try:
        subprocess.run(["git", "-C", repo_path, "rev-parse", "--is-inside-work-tree"],
                       check=True, capture_output=True, text=True)
        return True
    except Exception:
        return False


def _ensure_repo_safe(repo_path: str):
    try:
        subprocess.run(["git", "config", "--global", "--add", "safe.directory", os.path.abspath(repo_path)],
                       check=False)
    except Exception:
        pass


def _git_rel_for_windows(repo_path: str, file_path: str) -> str:
    rel = os.path.relpath(file_path, repo_path)
    return rel.replace("\\", "/")


def _to_rel_posix(repo_path: str, file_path: str) -> str:
    return os.path.relpath(file_path, repo_path).replace("\\", "/")


def _rev_parse(repo_path: str, rev: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", repo_path, "rev-parse", rev],
            check=True, capture_output=True, text=True, encoding="utf-8", errors="replace"
        ).stdout.strip()
        return out or None
    except Exception:
        return None


def _list_changed_files_in_commit(repo_path: str, commit_id: str) -> set[str]:
    changed: set[str] = set()
    if not commit_id:
        return changed

    def add_from(cmd):
        try:
            out = subprocess.run(cmd, check=True, capture_output=True, text=True,
                                 encoding="utf-8", errors="replace").stdout.splitlines()
            for p in out:
                p = p.strip()
                if p:
                    changed.add(p.replace("\\", "/"))
        except subprocess.CalledProcessError:
            pass

    # Get parents to detect merges
    try:
        line = subprocess.run(
            ["git", "-C", repo_path, "rev-list", "--parents", "-n", "1", commit_id],
            check=True, capture_output=True, text=True, encoding="utf-8", errors="replace"
        ).stdout.strip()
        parts = line.split()
        parents = parts[1:] if len(parts) > 1 else []
    except Exception:
        parents = []

    if parents:
        # Union of diffs against each parent
        for parent in parents:
            add_from(["git", "-C", repo_path, "diff", "--name-only", "-M", "-C", parent, commit_id])
        # Symmetric diff vs first parent (captures the full PR range)
        add_from(["git", "-C", repo_path, "diff", "--name-only", "-M", "-C", f"{parents[0]}...{commit_id}"])

    # Fallback: show with -m (per-parent)
    if not changed:
        add_from(["git", "-C", repo_path, "show", "-m", "--pretty=", "--name-only", "-M", "-C", commit_id])

    # Last resort (single-commit combined diff)
    if not changed:
        add_from(["git", "-C", repo_path, "diff", "--name-only", "-m", "-M", "-C", f"{commit_id}^!"])

    return changed


# ------------------------------ Git blame (fast porcelain) ------------------------------

def _file_line_count(file_path: str) -> int:
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return sum(1 for _ in f)
    except Exception:
        return 0


def _file_last_commit_author(repo_path: str, file_path: str):
    rel = _git_rel_for_windows(repo_path, file_path)
    try:
        out = subprocess.run(
            ["git", "-C", repo_path, "log", "--follow", "-1", "--no-merges",
             "--pretty=%H\t%an\t%ae\t%at", "--", rel],
            check=True, capture_output=True, text=True, encoding="utf-8", errors="replace"
        ).stdout.strip()
        if out:
            sha, an, ae, at = (out.split("\t") + ["", "", "", ""])[:4]
            return {"sha": sha, "author": an, "email": ae, "at": int(at) if at.isdigit() else None}
    except Exception:
        pass
    return None


def _file_first_commit_author(repo_path: str, file_path: str):
    rel = _git_rel_for_windows(repo_path, file_path)
    try:
        out = subprocess.run(
            ["git", "-C", repo_path, "log", "--follow", "--reverse", "--no-merges",
             "--pretty=%H\t%an\t%ae\t%at", "--", rel],
            check=True, capture_output=True, text=True, encoding="utf-8", errors="replace"
        ).stdout.splitlines()
        if out:
            sha, an, ae, at = (out[0].split("\t") + ["", "", "", ""])[:4]
            return {"sha": sha, "author": an, "email": ae, "at": int(at) if at.isdigit() else None}
    except Exception:
        pass
    return None


def git_blame_file(repo_path: str, file_path: str):
    """
    Returns hunks with final line positions:
      [(start_final, count, author, email, at, sha), ...]
    Faster: use --porcelain (no -C, no --line-porcelain).
    """
    rel = _git_rel_for_windows(repo_path, file_path)

    def _run():
        return subprocess.run(
            ["git", "-C", repo_path, "blame", "-w", "--porcelain", "--", rel],
            check=True, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )

    try:
        completed = _run()
    except subprocess.CalledProcessError as e:
        msg = (e.stderr or e.stdout or "").lower()
        if "unsafe repository" in msg or "dubious ownership" in msg:
            subprocess.run(["git", "config", "--global", "--add", "safe.directory", os.path.abspath(repo_path)],
                           check=False)
            completed = _run()
        else:
            raise

    out = completed.stdout or ""
    if not out.strip():
        # fallback: use whole-file last/first commit
        last = _file_last_commit_author(repo_path, file_path)
        first = _file_first_commit_author(repo_path, file_path)
        lines = max(1, _file_line_count(file_path))
        hunks = []
        if first:
            hunks.append((1, lines, first["author"], first.get("email") or "", first.get("at"), first.get("sha")))
        if last and (not first or last["sha"] != first["sha"]):
            hunks.append((1, lines, last["author"], last.get("email") or "", last.get("at"), last.get("sha")))
        return hunks

    hunks = []
    cur_author = cur_mail = None
    cur_time = None
    cur_sha = None
    cur_start = None
    cur_count = 1

    for line in out.splitlines():
        if not line:
            continue
        # header: "<sha> <orig_lineno> <final_lineno> <num_lines>"
        if (" " in line) and (line[0].isalnum() or line[0] == "^"):
            parts = line.split()
            if len(parts) >= 3 and parts[1].isdigit() and parts[2].isdigit():
                # flush previous
                if cur_author and cur_start is not None:
                    hunks.append((cur_start, cur_count, cur_author, cur_mail or "", cur_time, cur_sha))
                cur_sha = parts[0]
                final_lineno = int(parts[2])  # final (current file) line numbers
                num_lines = int(parts[3]) if len(parts) >= 4 and parts[3].isdigit() else 1
                cur_start = final_lineno
                cur_count = num_lines
                cur_author = cur_mail = None
                cur_time = None
            continue

        if line.startswith("author "):
            cur_author = line[7:]
            continue
        if line.startswith("author-mail "):
            m = line[12:].strip()
            if m.startswith("<") and m.endswith(">"): m = m[1:-1]
            cur_mail = m
            continue
        if line.startswith("author-time "):
            t = line[12:].strip()
            try:
                cur_time = int(t)
            except Exception:
                cur_time = None
            continue

    if cur_author and cur_start is not None:
        hunks.append((cur_start, cur_count, cur_author, cur_mail or "", cur_time, cur_sha))

    return hunks


def attach_contributors_from_blame(nodes, file_path, blame_hunks, repo_path):
    """
    Build per-line mapping from blame once, then per-node compute:
      - last_touched_by: max(author-time) within node span
      - authored_by:     min(author-time) within node span
    """
    line_map = {}
    for start, count, author, mail, at, sha in blame_hunks:
        for ln in range(start, start + count):
            line_map[ln] = {"author": author, "email": mail, "at": at, "sha": sha}

    contrib_nodes_by_key = {}
    edges = []
    created_edges = 0

    for n in nodes:
        if n["file_path"] != file_path: continue
        sp = n["metadata"].get("start_line")
        ep = n["metadata"].get("end_line")
        if not sp or not ep: continue

        recs = [line_map.get(i) for i in range(sp, ep + 1)]
        recs = [r for r in recs if r and r.get("author")]

        if not recs:
            last = _file_last_commit_author(repo_path, file_path)
            first = _file_first_commit_author(repo_path, file_path)
            recs_fallback = []
            if first: recs_fallback.append(first)
            if last:  recs_fallback.append(last)
            recs = recs_fallback

        if not recs:
            continue

        def _key_old(r):
            return (r.get("at") if isinstance(r.get("at"), int) else -10 ** 18, r.get("author", ""))

        def _key_new(r):
            return (r.get("at") if isinstance(r.get("at"), int) else 10 ** 18, r.get("author", ""))

        first_rec = min(recs, key=_key_old)
        last_rec = max(recs, key=_key_new)

        for role, rec in (("authored_by", first_rec), ("last_touched_by", last_rec)):
            author = rec.get("author")
            mail = (rec.get("email") or "").strip()
            if not author: continue
            key = (mail or f"unknown:{author}".lower().replace(" ", "_"))

            if key not in contrib_nodes_by_key:
                contrib_nodes_by_key[key] = {
                    "type": "Contributor",
                    "name": author,
                    "file_path": None,
                    "commit_id": n.get("commit_id", ""),
                    "metadata": {"local_id": f"contrib:{key}", "email": mail}
                }

            meta = {}
            if rec.get("at") is not None: meta["author_time"] = rec["at"]
            if rec.get("sha"):           meta["sha"] = rec["sha"]
            meta["role"] = role

            edges.append({
                "source_local_id": n["metadata"]["local_id"],
                "target_local_id": f"contrib:{key}",
                "relation": role,
                "metadata": meta
            })
            created_edges += 1

        n["metadata"].setdefault("authors", [])
        if last_rec.get("author"):
            n["metadata"]["authors"].append({
                "name": last_rec["author"], "email": last_rec.get("email", ""),
                "role": "last_touched_by", "sha": last_rec.get("sha"), "time": last_rec.get("at")
            })
        if first_rec.get("author"):
            n["metadata"]["authors"].append({
                "name": first_rec["author"], "email": first_rec.get("email", ""),
                "role": "authored_by", "sha": first_rec.get("sha"), "time": first_rec.get("at")
            })

    logging.info(f"[contributors/blame] {file_path}: contrib_nodes={len(contrib_nodes_by_key)} edges={created_edges}")
    return list(contrib_nodes_by_key.values()), edges


# ------------------------------ Memgraph helpers ------------------------------

def ensure_indexes():
    driver = get_memgraph_driver()
    stmts = [
        "CREATE INDEX ON :ASTNode(local_id)",
        "CREATE INDEX ON :ASTNode(snapshot_id)",
        "CREATE INDEX ON :Contributor(local_id)",
        "CREATE INDEX ON :Contributor(snapshot_id)",
    ]
    with driver.session() as s:
        for cy in stmts:
            try:
                s.run(cy)
            except Exception as e:
                logging.debug(f"Index stmt '{cy}' ignored: {e}")


def _chunks(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def memgraph_upsert_nodes_bulk(nodes, snapshot_id, batch_size=BATCH_SIZE):
    if not nodes: return
    driver = get_memgraph_driver()
    with driver.session() as session:
        for chunk in _chunks(nodes, batch_size):
            session.run("""
                UNWIND $batch AS n
                MERGE (x:ASTNode {local_id: n.metadata.local_id, snapshot_id: $snapshot_id})
                SET x.type = n.type,
                    x.name = coalesce(n.name, ''),
                    x.file_path = n.file_path,
                    x.commit_id = n.commit_id,
                    x.metadata = n.metadata,
                    x.snippet  = n.metadata.snippet
            """, batch=chunk, snapshot_id=snapshot_id)


def memgraph_upsert_contributors_bulk(contrib_nodes, snapshot_id, batch_size=BATCH_SIZE):
    if not contrib_nodes: return
    driver = get_memgraph_driver()
    with driver.session() as session:
        for chunk in _chunks(contrib_nodes, batch_size):
            session.run("""
                UNWIND $batch AS n
                MERGE (c:Contributor {local_id: n.metadata.local_id, snapshot_id: $snapshot_id})
                SET c.name = coalesce(n.name, ''),
                    c.type = 'Contributor',
                    c.email = coalesce(n.metadata.email, ''),
                    c.commit_id = coalesce(n.commit_id, ''),
                    c.metadata = n.metadata
            """, batch=chunk, snapshot_id=snapshot_id)


def memgraph_upsert_edges_bulk(edges, snapshot_id, batch_size=BATCH_SIZE):
    if not edges: return
    driver = get_memgraph_driver()
    with driver.session() as session:
        for chunk in _chunks(edges, batch_size):
            lids = list({e["source_local_id"] for e in chunk} | {e["target_local_id"] for e in chunk})
            res = session.run("""
                UNWIND $ids AS lid
                MATCH (n {snapshot_id: $sid, local_id: lid})
                RETURN lid, id(n) AS nid
            """, ids=lids, sid=snapshot_id)
            id_map = {row["lid"]: row["nid"] for row in res}

            edges_by_id, dropped = [], 0
            for e in chunk:
                sid = id_map.get(e["source_local_id"])
                tid = id_map.get(e["target_local_id"])
                if sid is None or tid is None:
                    dropped += 1;
                    continue
                edges_by_id.append({
                    "sid": sid, "tid": tid, "rel": e["relation"],
                    "metadata": e.get("metadata", {}),
                    "source_local_id": e["source_local_id"],
                    "target_local_id": e["target_local_id"],
                })
            if not edges_by_id:
                if dropped: logging.debug(f"Dropped {dropped} edges (missing endpoints).")
                continue

            session.run("""
                UNWIND $batch AS e
                MATCH (s) WHERE id(s) = e.sid
                MATCH (t) WHERE id(t) = e.tid
                MERGE (s)-[r:CODE_EDGE {relation: e.rel}]->(t)
                SET r.metadata = e.metadata,
                    r.source_local_id = e.source_local_id,
                    r.target_local_id = e.target_local_id
            """, batch=edges_by_id)


# ------------------------------ Snapshot existence ------------------------------

def find_existing_snapshot(repo_id, commit_id):
    repo_id_encoded = urllib.parse.quote(repo_id, safe='')
    try:
        resp = requests.get(f"{BACKEND_URL}/graph/snapshots/by-repo/{repo_id_encoded}")
        resp.raise_for_status()
        snapshots = resp.json()
        commit_id_str = (commit_id or "")
        for snap in snapshots:
            if (snap.get("commit_id") or "") == commit_id_str:
                return snap
        return None
    except Exception as e:
        logging.error(f"Failed to check existing snapshot: {e}")
        return None


# ------------------------------ Main pipeline (blame only changed files) ------------------------------

def _count_snapshot(driver, snapshot_id: str) -> tuple[int, int]:
    with driver.session() as s:
        nodes = s.run(
            "MATCH (n {snapshot_id: $sid}) RETURN count(n) AS c",
            sid=snapshot_id
        ).single()["c"]
        edges = s.run(
            """
            MATCH (s {snapshot_id: $sid})-[r:CODE_EDGE]->(t {snapshot_id: $sid})
            RETURN count(r) AS c
            """,
            sid=snapshot_id
        ).single()["c"]
    return int(nodes), int(edges)


def run_ast_extraction(repo_path, repo_id, task_id, commit_id):
    existing_snapshot = find_existing_snapshot(repo_id, commit_id)
    if existing_snapshot:
        logging.info(f"Snapshot exists snapshot_id={existing_snapshot['snapshot_id']}, skipping.")
        update_task_status(task_id, "skipped", "Snapshot already exists, skipping extraction.")
        return

    task_start = datetime.utcnow().isoformat()
    update_task_status(task_id, "in_progress", "Starting build task", started_at=task_start, commit_id=commit_id)

    ensure_indexes()

    if not _is_git_repo(repo_path):
        logging.warning(f"⚠️ {repo_path} is not a Git repo. Skipping contributor extraction.")
        git_ready = False
    else:
        _ensure_repo_safe(repo_path)
        git_ready = True

    # Resolve commit (fallback to HEAD if not provided)
    resolved_commit = commit_id
    if git_ready and not resolved_commit:
        resolved_commit = _rev_parse(repo_path, "HEAD")

    # Compute changed files (POSIX-relative)
    changed_rel_set: set[str] | None = None
    if git_ready and resolved_commit:
        changed_rel_set = _list_changed_files_in_commit(repo_path, resolved_commit)
        logging.info(f"[blame-scope] changed files in {resolved_commit}: {len(changed_rel_set)}")
    elif git_ready:
        logging.info("[blame-scope] no commit provided; not limiting blame (set is None)")

    parsers, _ = load_parsers()
    max_workers = int(os.getenv("BLAME_WORKERS", str(min(8, (os.cpu_count() or 4)))))

    # ------------------ single subtask + single snapshot for ALL languages ------------------
    root_subtask = create_subtask({
        "task_id": task_id,
        "language": "all",
        "step": "ast",
        "status": "in_progress",
        "message": "Extracting AST across all languages"
    })
    root_subtask_id = root_subtask["subtask_id"]

    root_snapshot = create_graph_snapshot({
        "repo_id": repo_id,
        "subtask_id": root_subtask_id,
        "commit_id": commit_id,
        "language": "all",
        "graph_type": "AST",
        "version": 1
    })
    root_snapshot_id = root_snapshot["snapshot_id"]
    # ----------------------------------------------------------------------------------------

    # Process each language but always write into root_snapshot_id
    for lang, config in LANGUAGE_CONFIGS.items():
        parser = parsers.get(lang)
        if not parser:
            continue

        files = []
        for root, dirs, fnames in os.walk(repo_path):
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            for fname in fnames:
                ext = Path(fname).suffix
                if ext in config.file_extensions:
                    files.append(os.path.join(root, fname))
        if not files:
            continue

        logging.info(f"[{lang}] files={len(files)} -> writing into snapshot {root_snapshot_id}")

        all_nodes, all_edges = [], []
        per_file_nodes: dict[str, list] = {}

        # AST + CFG
        for file_path in files:
            nodes_for_file, edges_for_file = [], []
            ast_root, code = extract_ast_for_file(file_path, parser)
            ast_map = {}

            traverse_ast(
                ast_root, file_path, root_snapshot_id, commit_id,
                parent_local_id=None, nodes=nodes_for_file, edges=edges_for_file,
                cfg=config, code=code, ast_map=ast_map,
            )

            # per-function CFG
            for n in list(nodes_for_file):
                if n["file_path"] != file_path:
                    continue
                if n["type"] == "Function":
                    func_ast = ast_map.get(n["metadata"]["local_id"])
                    if func_ast:
                        edges_for_file.extend(build_cfg_edges_for_function(func_ast, file_path, config))

            per_file_nodes[file_path] = nodes_for_file
            all_nodes.extend(nodes_for_file)
            all_edges.extend(edges_for_file)

        # Blame only changed files (if any)
        if git_ready:
            if changed_rel_set is not None:
                blame_targets = [f for f in files if _to_rel_posix(repo_path, f) in changed_rel_set]
                logging.info(f"[blame-scope] {lang}: will blame {len(blame_targets)}/{len(files)} files (changed)")
            else:
                blame_targets = []
                logging.info(f"[blame-scope] {lang}: no changed set; skipping blame (0 files)")
        else:
            blame_targets = []

        if blame_targets:
            def process_blame_one(fpath: str):
                try:
                    hunks = git_blame_file(repo_path, fpath)
                    logging.info(f"[contributors] {fpath}: blame hunks={len(hunks)}")
                    contrib_nodes, contrib_edges = attach_contributors_from_blame(per_file_nodes[fpath], fpath, hunks, repo_path)
                    return contrib_nodes, contrib_edges, None
                except Exception as e:
                    return [], [], f"git blame failed for {fpath}: {e}"

            with ThreadPoolExecutor(max_workers=max_workers) as ex:
                futs = [ex.submit(process_blame_one, f) for f in blame_targets]
                for fut in as_completed(futs):
                    contrib_nodes, contrib_edges, err = fut.result()
                    if err:
                        logging.warning(err)
                    if contrib_nodes:
                        all_nodes.extend(contrib_nodes)
                    if contrib_edges:
                        all_edges.extend(contrib_edges)

        # Dedup and write into the ONE snapshot
        all_nodes = _dedup_nodes(all_nodes)
        all_edges = _dedup_edges(all_edges)

        contrib_nodes = [n for n in all_nodes if n["type"] == "Contributor"]
        ast_nodes = [n for n in all_nodes if n["type"] != "Contributor"]

        memgraph_upsert_nodes_bulk(ast_nodes, root_snapshot_id, batch_size=BATCH_SIZE)
        memgraph_upsert_contributors_bulk(contrib_nodes, root_snapshot_id, batch_size=BATCH_SIZE)
        memgraph_upsert_edges_bulk(all_edges, root_snapshot_id, batch_size=BATCH_SIZE)

        # No export/update here (we do it once at the end)

    # Final export/update ONCE for the unified snapshot
    driver = get_memgraph_driver()
    nodes_count, edges_count = _count_snapshot(driver, root_snapshot_id)

    graphml_tmp, graphml_url = export_graphml(root_snapshot_id)
    json_tmp, json_url = export_json(root_snapshot_id)
    nodes_tmp, nodes_url, edges_tmp, edges_url = export_csv(root_snapshot_id)

    _safe_unlink(graphml_tmp); _safe_unlink(json_tmp)
    _safe_unlink(nodes_tmp);   _safe_unlink(edges_tmp)

    download_urls = {
        "graphml": graphml_url,
        "json": json_url,
        "nodes_csv": nodes_url,
        "edges_csv": edges_url,
    }
    urls_str = json.dumps(download_urls)

    update_graph_snapshot(root_snapshot_id, nodes_count, edges_count, s3_url=urls_str)
    update_subtask_status(root_subtask_id, message="AST + CFG + Contributors (all languages) saved to Memgraph.")

    task_end = datetime.utcnow().isoformat()
    update_task_status(task_id, "completed", "Build task finished", finished_at=task_end, commit_id=commit_id)
    close_memgraph_driver()

