import os
import subprocess
import logging
import json
from typing import Optional, Dict, List, Tuple
from datetime import datetime, timezone
import math

import requests

from .memgraph_db import get_memgraph_driver, close_memgraph_driver
from .language_config import LANGUAGE_CONFIGS, LanguageConfig, get_language_config
from .parser_loader import load_parsers

# ---------------- env / logging ----------------

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "5000"))
ANOMALY_TZ = os.getenv("ANOMALY_TZ", "UTC")

logging.basicConfig(level=logging.INFO)


# ---------------- REST helpers (unchanged interface) ----------------

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
        logging.info(f"✅ Task {task_id} -> {status}: {message}")
    except Exception as e:
        logging.error(f"❌ Failed to update task status: {e}")


# ---------------- git helpers ----------------

def _run_git(repo_path: str, args: List[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", repo_path] + args,
        check=check,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def _rev_parse(repo_path: str, ref: str) -> Optional[str]:
    try:
        return _run_git(repo_path, ["rev-parse", ref]).stdout.strip()
    except Exception:
        return None


def _git_rev_list_since(repo_path: str, branch: str, start_exclusive: Optional[str], max_commits: int) -> List[str]:
    """
    List commits (oldest->newest). If start_exclusive given, walk (start..branch].
    If max_commits==0, walk all.
    """
    base = []
    if start_exclusive:
        # commits AFTER start_exclusive
        base = [f"{start_exclusive}..{branch}"]
    else:
        base = [branch]

    args = ["rev-list", "--reverse"]
    if max_commits and max_commits > 0:
        args += [f"--max-count={max_commits}"]
    args += base

    out = _run_git(repo_path, args).stdout.splitlines()
    return [s.strip() for s in out if s.strip()]


def _git_commit_meta(repo_path: str, sha: str) -> Dict[str, str]:
    """
    %H sha
    %at authored_ts
    %an author_name
    %ae author_email
    %ct committed_ts
    %s subject
    """
    fmt = "%H%n%at%n%an%n%ae%n%ct%n%s"
    out = _run_git(repo_path, ["show", "-s", f"--format={fmt}", sha]).stdout.splitlines()
    (h, at, an, ae, ct, subj) = (out + ["", "", "", "", "", ""])[:6]
    return {
        "sha": h,
        "authored_at": int(at) if at.isdigit() else None,
        "author_name": an,
        "author_email": ae,
        "committed_at": int(ct) if ct.isdigit() else None,
        "subject": subj,
    }


def _git_numstat(repo_path: str, sha: str) -> Dict[str, Tuple[int, int]]:
    """
    Returns {path: (adds, dels)} using --numstat.
    """
    out = _run_git(repo_path, ["show", "--numstat", "--format=", sha]).stdout.splitlines()
    res: Dict[str, Tuple[int, int]] = {}
    for line in out:
        parts = line.split("\t")
        if len(parts) >= 3:
            a, d, p = parts[0], parts[1], parts[2]
            try:
                ai = int(a) if a.isdigit() else 0
                di = int(d) if d.isdigit() else 0
            except Exception:
                ai, di = 0, 0
            res[p.strip()] = (ai, di)
    return res


def _git_name_status(repo_path: str, sha: str) -> Dict[str, Dict]:
    """
    Returns {new_path: {status: 'A'|'M'|'D'|'R', old_path: (optional)}}
    """
    out = _run_git(repo_path, ["show", "--name-status", "-M", "-C", "--format=", sha]).stdout.splitlines()
    mapping: Dict[str, Dict] = {}
    for line in out:
        if not line.strip():
            continue
        parts = line.split("\t")
        code = parts[0]
        if code.startswith("R"):  # e.g., R100
            if len(parts) >= 3:
                old_p, new_p = parts[1].strip(), parts[2].strip()
                mapping[new_p] = {"status": "R", "old_path": old_p}
        else:
            if len(parts) >= 2:
                mapping[parts[1].strip()] = {"status": code}
    return mapping


# ---------------- time helpers ----------------

try:
    import zoneinfo  # py3.9+
except Exception:
    zoneinfo = None


def _to_local_hour(epoch_sec: Optional[int]) -> Optional[int]:
    if epoch_sec is None:
        return None
    dt = datetime.fromtimestamp(int(epoch_sec), tz=timezone.utc)
    if zoneinfo:
        try:
            dt = dt.astimezone(zoneinfo.ZoneInfo(ANOMALY_TZ))
        except Exception:
            pass
    return dt.hour


def _to_dow(epoch_sec: Optional[int]) -> Optional[int]:
    if epoch_sec is None:
        return None
    dt = datetime.fromtimestamp(int(epoch_sec), tz=timezone.utc)
    return dt.weekday()  # 0-6


# ---------------- Memgraph schema helpers ----------------

def ensure_indexes():
    driver = get_memgraph_driver()
    stmts = [
        "CREATE INDEX ON :Repo(id)",
        "CREATE INDEX ON :Branch(id)",
        "CREATE INDEX ON :Commit(sha)",
        "CREATE INDEX ON :Contributor(key)",
        "CREATE INDEX ON :File(path)",
        "CREATE INDEX ON :Symbol(key)",
    ]
    with driver.session() as s:
        for cy in stmts:
            try:
                s.run(cy)
            except Exception as e:
                logging.debug(f"[indexes] '{cy}' ignored: {e}")


def _branch_id(repo_id: str, branch: str) -> str:
    return f"{repo_id}#{branch}"


def mg_upsert_repo_branch(repo_id: str, branch: str):
    driver = get_memgraph_driver()
    with driver.session() as s:
        s.run("""
        MERGE (r:Repo {id:$rid})
        MERGE (b:Branch {id:$bid})
          ON CREATE SET b.repo_id = $rid, b.name = $bname
        MERGE (r)-[:HAS_BRANCH]->(b)
        """, rid=repo_id, bid=_branch_id(repo_id, branch), bname=branch)


def mg_get_branch_cursor(repo_id: str, branch: str) -> Optional[Tuple[str, int]]:
    driver = get_memgraph_driver()
    with driver.session() as s:
        row = s.run("MATCH (b:Branch {id:$bid}) RETURN b.last_sha AS sha, b.last_time AS t",
                    bid=_branch_id(repo_id, branch)).single()
        if not row:
            return None
        return (row["sha"], row["t"])


def mg_set_branch_cursor(repo_id: str, branch: str, last_sha: str, last_time: Optional[int]):
    driver = get_memgraph_driver()
    with driver.session() as s:
        s.run("""
        MATCH (b:Branch {id:$bid})
        SET b.last_sha = $sha, b.last_time = $t
        """, bid=_branch_id(repo_id, branch), sha=last_sha, t=(last_time or 0))


def mg_link_commit(repo_id: str, branch: str, meta: Dict, file_changes: List[Dict]):
    """
    Create/Update Commit node, link author, attach to Branch, store rollups.
    """
    files_changed = len(file_changes)
    adds_total = sum(int(fc.get("additions", 0) or 0) for fc in file_changes)
    dels_total = sum(int(fc.get("deletions", 0) or 0) for fc in file_changes)
    lines_total = adds_total + dels_total
    hour_local = _to_local_hour(meta.get("committed_at"))
    dow_local = _to_dow(meta.get("committed_at"))

    driver = get_memgraph_driver()
    with driver.session() as s:
        s.run("""
        MERGE (r:Repo {id:$rid})
        MERGE (b:Branch {id:$bid})
        MERGE (c:Commit {sha:$sha})
          ON CREATE SET c.authored_at=$at, c.committed_at=$ct, c.message=$msg
        SET c.files_changed=$files,
            c.lines_added=$adds,
            c.lines_deleted=$dels,
            c.lines_changed=$lines,
            c.hour=$hour,
            c.dow=$dow
        MERGE (b)-[:HAS_COMMIT]->(c)
        MERGE (u:Contributor {key:$ckey})
          ON CREATE SET u.name=$an, u.email=$ae
        MERGE (u)-[:AUTHORED]->(c)
        """, rid=repo_id,
             bid=_branch_id(repo_id, branch),
             sha=meta["sha"],
             at=meta.get("authored_at"),
             ct=meta.get("committed_at"),
             msg=meta.get("subject", ""),
             files=files_changed, adds=adds_total, dels=dels_total, lines=lines_total,
             hour=hour_local, dow=dow_local,
             ckey=(meta.get("author_email") or meta.get("author_name")),
             an=meta.get("author_name", ""), ae=meta.get("author_email", ""))

    return {
        "files_changed": files_changed,
        "lines_changed": lines_total,
        "hour": hour_local,
        "dow": dow_local,
    }


def mg_link_file_touch(repo_id: str, branch: str, sha: str, path: str, status: str,
                       additions: int, deletions: int, ext: str, is_code: bool, old_path: Optional[str]):
    driver = get_memgraph_driver()
    with driver.session() as s:
        s.run("""
        MERGE (f:File {path:$path})
          ON CREATE SET f.repo_id=$rid, f.branch=$branch, f.ext=$ext, f.is_code=$is_code
        SET f.ext=$ext, f.is_code=$is_code
        WITH f
        MATCH (c:Commit {sha:$sha})
        MERGE (c)-[t:TOUCHED]->(f)
        SET t.status=$status, t.additions=$adds, t.deletions=$dels, t.old_path=$old
        """, path=path, rid=repo_id, branch=branch, ext=ext, is_code=bool(is_code),
             sha=sha, status=status, adds=int(additions or 0), dels=int(deletions or 0),
             old=(old_path or None))


def mg_upsert_symbols(repo_id: str, branch: str, file_path: str, lang: str, sha: str,
                      symbols: List[Dict]):
    """
    Symbols are coarse (Function / Class). key = f"{file_path}::{name}::{kind}"
    """
    if not symbols:
        return
    driver = get_memgraph_driver()
    batch = []
    for s in symbols:
        key = f"{file_path}::{s['name']}::{s['kind']}"
        batch.append({
            "key": key,
            "name": s["name"],
            "kind": s["kind"],
            "file_path": file_path,
            "lang": lang,
            "start_line": int(s.get("start_line") or 0),
            "end_line": int(s.get("end_line") or 0),
        })
    with driver.session() as sess:
        sess.run("""
        UNWIND $batch AS sym
        MERGE (x:Symbol {key:sym.key})
          ON CREATE SET x.name=sym.name, x.kind=sym.kind, x.file_path=sym.file_path,
                        x.lang=sym.lang, x.start_line=sym.start_line, x.end_line=sym.end_line
        SET x.lang=sym.lang, x.start_line=sym.start_line, x.end_line=sym.end_line
        WITH x
        MATCH (f:File {path:x.file_path})
        MERGE (f)-[:DECLARES]->(x)
        WITH x
        MATCH (c:Commit {sha:$sha})
        MERGE (c)-[:SEES]->(x)  // coarse association (no line overlap calc for speed)
        """, batch=batch, sha=sha)


# ---------------- anomaly scoring ----------------

def _mean_std(vals: List[float]) -> Tuple[float, float]:
    n = len(vals)
    if n == 0:
        return 0.0, 0.0
    mu = sum(vals) / n
    var = sum((v - mu) ** 2 for v in vals) / max(1, n)
    return mu, math.sqrt(var)


def score_commit_anomaly(repo_id: str, branch: str, sha: str, k: int = 200):
    driver = get_memgraph_driver()
    with driver.session() as s:
        row = s.run("""
        MATCH (:Branch {id:$bid})-[:HAS_COMMIT]->(c:Commit {sha:$sha})<-[:AUTHORED]-(u:Contributor)
        RETURN u.key AS ckey, c.files_changed AS f, c.lines_changed AS l, c.hour AS h, c.committed_at AS t
        """, bid=_branch_id(repo_id, branch), sha=sha).single()
        if not row:
            return
        ckey, f_now, l_now, h_now, t_now = row["ckey"], int(row["f"] or 0), int(row["l"] or 0), row["h"], row["t"]

        rows = s.run("""
        MATCH (:Branch {id:$bid})-[:HAS_COMMIT]->(c:Commit)<-[:AUTHORED]-(:Contributor {key:$ckey})
        WHERE c.sha <> $sha AND c.committed_at < $t
        RETURN c.files_changed AS f, c.lines_changed AS l, c.hour AS h
        ORDER BY c.committed_at DESC LIMIT $k
        """, bid=_branch_id(repo_id, branch), ckey=ckey, sha=sha, t=t_now, k=k)

        prev_files, prev_lines, prev_hours = [], [], []
        for rr in rows:
            prev_files.append(int(rr["f"] or 0))
            prev_lines.append(int(rr["l"] or 0))
            if rr["h"] is not None:
                prev_hours.append(int(rr["h"]))

        mu_f, sd_f = _mean_std(prev_files)
        mu_l, sd_l = _mean_std(prev_lines)

        def z(x, mu, sd): return 0.0 if sd == 0 else (x - mu) / sd
        z_files = z(f_now, mu_f, sd_f)
        z_lines = z(l_now, mu_l, sd_l)

        def frac_off_hours(hour_hist, h):
            if not hour_hist or h is None:
                return 0.0
            n = len(hour_hist)
            neighbors = {(h - 1) % 24, h, (h + 1) % 24}
            good = sum(1 for x in hour_hist if x in neighbors)
            return 1.0 - (good / n)

        off_hours = frac_off_hours(prev_hours, h_now) > 0.95
        score = min(10.0, abs(z_files) + 0.5 * abs(z_lines) + (2.0 if off_hours else 0.0))
        flags = []
        if z_files >= 3.0:
            flags.append("files_spike")
        if z_lines >= 3.0:
            flags.append("lines_spike")
        if off_hours:
            flags.append("off_hours")

        s.run("""
        MATCH (c:Commit {sha:$sha})
        SET c.z_files = $zf,
            c.z_lines = $zl,
            c.off_hours = $off,
            c.anomaly_score = $score,
            c.anomaly_flags = $flags
        """, sha=sha, zf=float(z_files), zl=float(z_lines), off=bool(off_hours), score=float(score), flags=flags)


# ---------------- symbol extraction (coarse) ----------------

def _text_slice(code: bytes, node) -> str:
    try:
        return code[getattr(node, "start_byte", 0):getattr(node, "end_byte", 0)].decode("utf-8", "ignore")
    except Exception:
        return ""


def _to_point(p):
    if p is None:
        return None
    try:
        return [int(p.row), int(p.column)]
    except Exception:
        try:
            r, c = p
            return [int(r), int(c)]
        except Exception:
            return None


def _node_name(ast_node, code: bytes, cfg: LanguageConfig, kind: str) -> str:
    if kind in ("Function", "Class"):
        n = ast_node.child_by_field_name(cfg.name_field) or ast_node.child_by_field_name("identifier")
        return _text_slice(code, n) if n else ""
    return ""


def extract_symbols_coarse(code: bytes, lang: str, parser, query_pack) -> List[Dict]:
    """
    Only top-level Functions / Classes (no statements/CFG). Fast & small.
    """
    if not parser:
        return []
    try:
        tree = parser.parse(code)
    except Exception:
        return []
    root = tree.root_node
    cfg: LanguageConfig = LANGUAGE_CONFIGS[lang]
    out: List[Dict] = []

    qfunc = query_pack.get("functions") if query_pack else None
    qclass = query_pack.get("classes") if query_pack else None

    def collect(q, kind):
        if not q:
            return
        for m in q.captures(root):
            node = m[0]
            sp = _to_point(getattr(node, "start_point", None))
            ep = _to_point(getattr(node, "end_point", None))
            start_line = (sp[0] + 1) if (sp and len(sp) >= 1) else None
            end_line = (ep[0] + 1) if (ep and len(ep) >= 1) else None
            name = _node_name(node, code, cfg, kind)
            if name:
                out.append({
                    "kind": kind,
                    "name": name.strip(),
                    "start_line": start_line or 0,
                    "end_line": end_line or 0,
                })

    collect(qfunc, "Function")
    collect(qclass, "Class")
    return out


# ---------------- main branch ingest ----------------

IGNORE_DIRS = {
    ".git", ".hg", ".svn",
    "node_modules", "dist", "build", "out",
    ".venv", "venv", "__pycache__", ".pytest_cache",
    "target", "bin", "obj",
    ".idea", ".vscode",
    "third_party", "vendor",
    "test", "tests", "__tests__",
}

# Build ext -> language map once
EXT_TO_LANG: Dict[str, str] = {}
for lname, cfg in LANGUAGE_CONFIGS.items():
    for ext in cfg.file_extensions:
        EXT_TO_LANG[ext] = lname


def _file_ext(p: str) -> str:
    try:
        i = p.rfind(".")
        return p[i:] if i >= 0 else ""
    except Exception:
        return ""


def _is_code_file(p: str) -> bool:
    return _file_ext(p) in EXT_TO_LANG


def _git_show_file(repo_path: str, sha: str, path: str) -> Optional[bytes]:
    try:
        cp = _run_git(repo_path, ["show", f"{sha}:{path}"])
        return cp.stdout.encode("utf-8", "ignore") if isinstance(cp.stdout, str) else cp.stdout
    except Exception:
        return None


def run_branch_ingest(
    repo_path: str,
    repo_id: str,
    branch: str,
    task_id: str,
    start_exclusive_sha: Optional[str] = None,
    max_commits: int = 0,
    workers: int = 8,  # kept for future parallel bits
):
    """
    Walk the branch history once, append to existing graph if branch already exists.
    Stores coarse symbols (Functions/Classes), per-commit rollups and anomaly scores.
    """
    ensure_indexes()
    mg_upsert_repo_branch(repo_id, branch)

    # prepare parsers+queries once
    parsers, queries = load_parsers()

    # establish starting cursor
    cursor = start_exclusive_sha
    if cursor is None:
        c = mg_get_branch_cursor(repo_id, branch)
        if c:
            cursor = c[0]

    # compute commit list
    head_sha = _rev_parse(repo_path, branch) or "HEAD"
    todo = _git_rev_list_since(repo_path, branch, cursor, max_commits=max_commits)
    if not todo:
        update_task_status(task_id, "completed", f"No new commits for {repo_id}#{branch}")
        return

    update_task_status(task_id, "in_progress", f"Found {len(todo)} commits to ingest for {repo_id}#{branch}")

    ingested = 0
    for sha in todo:
        try:
            meta = _git_commit_meta(repo_path, sha)
            numstat = _git_numstat(repo_path, sha)
            nstat = _git_name_status(repo_path, sha)

            # merge the two sources per file
            file_changes: List[Dict] = []
            seen_paths = set()
            for p, status_info in nstat.items():
                adds, dels = numstat.get(p, (0, 0))
                file_changes.append({
                    "path": p,
                    "status": status_info.get("status", "M"),
                    "old_path": status_info.get("old_path"),
                    "additions": adds,
                    "deletions": dels,
                })
                seen_paths.add(p)
            # numstat may contain paths not appearing in name-status (edge cases)
            for p, (adds, dels) in numstat.items():
                if p in seen_paths:
                    continue
                file_changes.append({
                    "path": p,
                    "status": "M",
                    "old_path": None,
                    "additions": adds,
                    "deletions": dels,
                })

            rollups = mg_link_commit(repo_id, branch, meta, file_changes)

            # per-file nodes/edges + symbols (coarse)
            for fc in file_changes:
                path = fc["path"]
                status = fc["status"]
                adds = int(fc.get("additions", 0) or 0)
                dels = int(fc.get("deletions", 0) or 0)
                old_path = fc.get("old_path")
                ext = _file_ext(path)
                is_code = _is_code_file(path)

                mg_link_file_touch(repo_id, branch, sha, path, status, adds, dels, ext, is_code, old_path)

                # skip symbol parse on deletions / non-code / very large churn (speed)
                if status == "D" or not is_code:
                    continue
                if (adds + dels) > 200000:  # safety for giant vendored diffs
                    continue

                lang = EXT_TO_LANG.get(ext)
                parser = parsers.get(lang)
                qpack = queries.get(lang) if isinstance(queries, dict) else None

                blob = _git_show_file(repo_path, sha, path)
                if not blob:
                    continue

                symbols = extract_symbols_coarse(blob, lang, parser, qpack)
                if symbols:
                    mg_upsert_symbols(repo_id, branch, path, lang, sha, symbols)

            # anomaly score for this commit
            score_commit_anomaly(repo_id, branch, sha)

            # advance cursor
            mg_set_branch_cursor(repo_id, branch, sha, meta.get("committed_at"))
            ingested += 1

            if ingested % 20 == 0:
                update_task_status(task_id, "in_progress",
                                   f"Ingested {ingested}/{len(todo)} commits for {repo_id}#{branch}")

        except Exception as e:
            logging.exception(f"[ingest] commit {sha} failed: {e}")

    update_task_status(task_id, "completed",
                       f"Ingested {ingested} commits for {repo_id}#{branch} (head={head_sha})")
    close_memgraph_driver()
