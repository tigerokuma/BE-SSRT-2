import os
import subprocess
import logging
import json
from typing import Optional, Dict, List, Tuple
from datetime import datetime, timezone
import math
import re
import requests
from pathlib import Path

from .memgraph_db import get_memgraph_driver, close_memgraph_driver
from .language_config import LANGUAGE_CONFIGS, LanguageConfig, get_language_config
from .parser_loader import load_parsers

# --- OFFLINE MODE SWITCH (Option A) ---
import pathlib, uuid


BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")
BACKEND_MODE = os.getenv("BACKEND_MODE", "offline").lower()
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")
OFFLINE_OUT_DIR = os.getenv("OFFLINE_OUT_DIR", ".offline_out")

pathlib.Path(OFFLINE_OUT_DIR).mkdir(parents=True, exist_ok=True)


def _offline() -> bool:
    # treat blank / "noop" BACKEND_URL as offline as well
    return BACKEND_MODE != "online" or not BACKEND_URL or BACKEND_URL.lower() == "noop"


def _offline_write(kind: str, obj_id: str, payload: dict):
    d = pathlib.Path(OFFLINE_OUT_DIR) / kind
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{obj_id}.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _auth_headers() -> dict:
    headers = {
        "Content-Type": "application/json",
    }
    if INTERNAL_API_TOKEN:
        headers["x-internal-token"] = INTERNAL_API_TOKEN
    return headers


# ---------------- env / logging ----------------

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "5000"))
ANOMALY_TZ = os.getenv("ANOMALY_TZ", "UTC")

logging.basicConfig(level=logging.INFO)

SPECIAL_CODE_FILES = {
    "requirements.txt", "Pipfile", "Pipfile.lock", "poetry.lock",
    "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
    "requirements-dev.txt", "pyproject.toml", "setup.cfg", "setup.py"
    # extend later:
    # "go.mod", "go.sum",
    # "Cargo.toml", "Cargo.lock",
    # "pom.xml", "build.gradle", "build.gradle.kts",
}


def _is_code_file(p: str) -> bool:
    fname = os.path.basename(p)
    return fname in SPECIAL_CODE_FILES or (_file_ext(p) in EXT_TO_LANG)


# ---------------- REST helpers (unchanged interface) ----------------

def update_task_status(task_id, status, message="", started_at=None, finished_at=None, commit_id=None):
    payload = {"status": status, "message": message}
    if started_at:  payload["started_at"] = started_at
    if finished_at: payload["finished_at"] = finished_at
    if commit_id:   payload["commit_id"] = commit_id

    if _offline():
        logging.info(f"[OFFLINE] PATCH /graph/build/{task_id}/status -> {payload}")
        _offline_write("task_status", task_id, payload)
        return

    try:
        resp = requests.patch(f"{BACKEND_URL}/graph/build/{task_id}/status",
                              json=payload, headers=_auth_headers())
        resp.raise_for_status()
        logging.info(f"✅ Task {task_id} -> {status}: {message}")
    except Exception as e:
        logging.error(f"❌ Failed to update task status: {e}")


# ---------------- util helpers ----------------
def _strip_quotes(s: str) -> str:
    s = (s or "").strip()
    if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
        return s[1:-1]
    return s


def _is_relative_spec(mod: str) -> bool:
    return mod.startswith("./") or mod.startswith("../") or mod.startswith(".\\")


def _is_local_import(lang: str, module_spec: str) -> bool:
    if lang == "python":
        return (module_spec or "").startswith(".")  # dotted relative: ., .., ...
    return module_spec.startswith("./") or module_spec.startswith("../") or module_spec.startswith(".\\")


def _resolve_local_module_path(repo_root: str, base_rel_file: str, module_spec: str, lang: str, sha: str | None) ->Optional[str]:
    # JS/TS relative or Python dotted-relative

    if not _is_local_import(lang, module_spec):
        return None

    base_dir = Path(base_rel_file).parent

    candidates: list[Path] = []

    if lang in ("javascript", "typescript"):
        spec = base_dir / module_spec
        endings = [".js", ".jsx", ".ts", ".tsx"]

        for ext in endings:
            candidates.append(spec.with_suffix(ext))

        for ext in endings:
            candidates.append(spec / f"index{ext}")
    elif lang == "python":
        # dotted relative: '.' current package, '..' parent, etc.

        if module_spec.startswith("."):
            dots = len(module_spec) - len(module_spec.lstrip("."))
            tail = module_spec[dots:]  # 'compat.utils' or ''
            anchor = base_dir


            # Go up (dots-1) times: '.' -> stay, '..' -> up 1, etc.

            for _ in range(max(0, dots - 1)):
                anchor = anchor.parent

            if tail:
                spec = anchor / tail.replace(".", "/")
            else:
                spec = anchor
        else:
            # fallback to path-like relative (rare)
            spec = base_dir / module_spec
        candidates.append(spec.with_suffix(".py"))
        candidates.append(spec / "__init__.py")
    else:

        return None

    for cand in candidates:

        try:
            rel_posix = cand.as_posix()
            _run_git(repo_root, ["cat-file", "-e", f"{sha}:{rel_posix}"], check=True)

            return rel_posix
        except Exception:

            continue
    return None


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
    out = _run_git(repo_path, ["show", "--name-status", "-M50%", "-C50%", "--format=", sha]).stdout.splitlines()
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
        "CREATE INDEX ON :Commit(committed_at)",
        "CREATE INDEX ON :Commit(dow)",
        "CREATE INDEX ON :Commit(hour)",
        "CREATE INDEX ON :Contributor(key)",
        "CREATE INDEX ON :File(path)",
        "CREATE INDEX ON :File(repo_id)",
        "CREATE INDEX ON :Symbol(key)",
        "CREATE INDEX ON :Symbol(file_path)",
        # NEW: supply-chain / symbols / calls
        "CREATE INDEX ON :Dependency(name)",
        "CREATE INDEX ON :Dependency(ecosystem)",
        # optional (comment out if you prefer)
        # "CREATE INDEX ON :Symbol(name)",
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

def mg_link_repo_package(repo_id: str, ecosystem: str, package_name: str):
    """
    Link a logical package (Dependency node) to the Repo that implements it.

    Example:
      ecosystem='npm', package_name='@hookform/resolvers',
      repo_id='react-hook-form/resolvers'
    """
    driver = get_memgraph_driver()
    with driver.session() as s:
        s.run("""
        MERGE (dep:Dependency {ecosystem:$eco, name:$name})
          ON CREATE SET dep.created_at = timestamp()
        MERGE (r:Repo {id:$rid})
        MERGE (dep)-[:HAS_REPO]->(r)
        """, eco=ecosystem, name=package_name, rid=repo_id)


def mg_upsert_symbols(repo_id: str, branch: str, file_path: str, lang: str, sha: str,
                      symbols: List[Dict]):
    if not symbols:
        return
    driver = get_memgraph_driver()
    batch = []
    for s in symbols:
        if s["kind"] not in ("Function", "Class"):
            continue
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
    if not batch:
        return

    with driver.session() as sess:
        sess.run("""
        UNWIND $batch AS sym
        MERGE (x:Symbol {key:sym.key})
          ON CREATE SET x.name=sym.name, x.kind=sym.kind, x.file_path=sym.file_path,
                        x.lang=sym.lang, x.start_line=sym.start_line, x.end_line=sym.end_line
        SET x.lang=sym.lang, x.start_line=sym.start_line, x.end_line=sym.end_line
        WITH x, sym
        MATCH (f:File {path: sym.file_path})
        MERGE (f)-[:DECLARES]->(x)
        WITH x
        MATCH (c:Commit {sha:$sha})
        MERGE (c)-[:SEES]->(x)
        """, batch=batch, sha=sha)


def mg_upsert_calls(file_path: str, lang: str, sha: str, calls: List[Dict]):
    calls = [c for c in calls if c.get("name")]
    if not calls:
        return
    driver = get_memgraph_driver()
    with driver.session() as s:
        s.run("""
        UNWIND $calls AS c
        MATCH (callerFile:File {path:$fp})-[:DECLARES]->(callerSym:Symbol)
        WITH c, callerSym, $fp AS fp
        MATCH (targetFile:File {path:fp})-[:DECLARES]->(target:Symbol {name:c.name})
        // crude: connect all declared symbols in file to target by name
        MERGE (callerSym)-[r:CALLS]->(target)
        SET r.at_line = c.start_line
        WITH target
        MATCH (cm:Commit {sha:$sha})
        MERGE (cm)-[:SEES]->(target)
        """, calls=calls, fp=file_path, sha=sha)


_HUNK_RE = re.compile(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def _git_hunks_added_new_file_ranges(repo_path: str, sha: str, path: str) -> List[Tuple[int, int]]:
    """
    Returns list of (start,end) line ranges (1-based, inclusive) for added/changed lines in the NEW file.
    We parse --unified=0 patch and use the +hunk spans as approximation.
    """
    try:
        cp = _run_git(repo_path, ["show", "--unified=0", "--format=", sha, "--", path])
        lines = cp.stdout.splitlines()
    except Exception:
        return []
    ranges = []
    for ln in lines:
        if ln.startswith("@@"):
            m = _HUNK_RE.match(ln)
            if not m:
                continue
            new_start = int(m.group(3))
            new_count = int(m.group(4) or "1")
            if new_count <= 0:
                continue
            start = new_start
            end = new_start + new_count - 1
            ranges.append((start, end))
    return ranges


def _ranges_overlap(a: Tuple[int, int], b: Tuple[int, int]) -> int:
    """Return overlap length (>=0)."""
    s1, e1 = a
    s2, e2 = b
    s = max(s1, s2)
    e = min(e1, e2)
    return max(0, e - s + 1)


def mg_touch_symbol(sha: str, file_path: str, touches: Dict[str, int]):
    """
    touches: {symbol_name -> lines_changed_in_symbol}
    """
    if not touches:
        return
    rows = [{"name": k, "delta": int(v)} for (k, v) in touches.items() if v > 0]
    if not rows:
        return
    driver = get_memgraph_driver()
    with driver.session() as s:
        s.run("""
        UNWIND $rows AS r
        MATCH (sym:Symbol {file_path:$fp, name:r.name})
        MATCH (c:Commit {sha:$sha})
        MERGE (c)-[t:TOUCHED_SYMBOL]->(sym)
        ON CREATE SET t.lines_changed = 0
        SET t.lines_changed = t.lines_changed + r.delta
        """, rows=rows, fp=file_path, sha=sha)


# 6) NEW: simple manifest parsers (Python + Node)
_dep_line_re = re.compile(r"^\s*([A-Za-z0-9_.\-]+)\s*([=~!<>]{1,2})\s*([A-Za-z0-9_.\-+]+)")


def parse_requirements_txt(blob: bytes) -> List[Dict]:
    out = []
    for raw in blob.decode("utf-8", "ignore").splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#"):
            continue
        m = _dep_line_re.match(raw)
        if m:
            name, _op, ver = m.groups()
            out.append({"ecosystem": "pypi", "name": name.lower(), "version": ver})
        else:
            # bare names (no pin) -> capture name with empty version
            if re.match(r"^[A-Za-z0-9_.\-]+$", raw):
                out.append({"ecosystem": "pypi", "name": raw.lower(), "version": ""})
    return out


def parse_package_json(blob: bytes) -> List[Dict]:
    out = []
    try:
        pkg = json.loads(blob.decode("utf-8", "ignore") or "{}")
    except Exception:
        return out
    for sec in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        d = pkg.get(sec) or {}
        if isinstance(d, dict):
            for name, ver in d.items():
                out.append({"ecosystem": "npm", "name": name.lower(), "version": str(ver)})
    return out


def parse_manifest(file_name: str, blob: bytes) -> List[Dict]:
    fn = os.path.basename(file_name)
    if fn == "requirements.txt" or fn == "requirements-dev.txt":
        return parse_requirements_txt(blob)
    if fn == "package.json":
        return parse_package_json(blob)
    if fn == "pyproject.toml":
        return parse_pyproject_toml(blob)
    # extend later: setup.cfg (setuptools), go.mod, Cargo.toml, etc.
    return []


def parse_pyproject_toml(blob: bytes) -> List[Dict]:
    """
    Minimal Poetry deps reader. Returns [{ecosystem:'pypi', name, version}]
    """
    out = []
    try:
        # py311 has tomllib; for py310-, user can install 'tomli' and alias import
        try:
            import tomllib  # type: ignore[attr-defined]
        except Exception:
            import tomli as tomllib  # type: ignore[no-redef]
        data = tomllib.loads(blob.decode("utf-8", "ignore"))
    except Exception:
        return out

    # Poetry layout: tool.poetry.dependencies / dev-dependencies
    tool = data.get("tool") or {}
    poetry = tool.get("poetry") or {}
    for sec in ("dependencies", "dev-dependencies"):
        d = poetry.get(sec) or {}
        if isinstance(d, dict):
            for name, ver in d.items():
                # versions can be tables/dicts (markers). Keep string-ish best-effort
                if isinstance(ver, dict):
                    ver = ver.get("version", "")
                out.append({"ecosystem": "pypi", "name": str(name).lower(), "version": str(ver)})
    return out


# 7) NEW: dependency upserts + bump detection
def _semver_major_bump(prev: str, new: str) -> Optional[bool]:
    """
    Return True if new major > prev major, False if not, None if undecidable.
    Accepts versions like "^2.3.4", "~1.5.0", "v3.1.0", "2", "2.4", "2.4.1", etc.
    """
    def norm(v: str) -> Optional[Tuple[int, int, int]]:
        if not v:
            return None
        v = v.strip()
        # strip common leading operators/prefixes
        v = re.sub(r'^[\^~<>=\s]*v?', '', v)
        m = re.search(r'(\d+)(?:\.(\d+))?(?:\.(\d+))?', v)
        if not m:
            return None
        major = int(m.group(1))
        minor = int(m.group(2) or 0)
        patch = int(m.group(3) or 0)
        return (major, minor, patch)

    p = norm(prev or "")
    n = norm(new or "")
    if not p or not n:
        return None
    return n[0] > p[0]



def mg_inc_contributor_file_touch(sha: str, path: str, committed_at: Optional[int]):
    driver = get_memgraph_driver()
    with driver.session() as s:
        s.run("""
        MATCH (c:Commit {sha:$sha})<-[:AUTHORED]-(u:Contributor),
              (f:File {path:$path})
        MERGE (u)-[r:TOUCHED]->(f)
        ON CREATE SET r.count = 0
        SET r.count = r.count + 1,
            r.last_touched_at = $t
        """, sha=sha, path=path, t=(committed_at or 0))


def mg_upsert_dependencies(repo_id: str, branch: str, commit_meta: Dict, deps: List[Dict]):
    """
    Create Dependency nodes and UPDATES_DEP edges with flags (is_major_bump when detectable).
    deps: [{ecosystem, name, version}]
    """
    if not deps:
        return
    sha = commit_meta.get("sha")
    t_now = int(commit_meta.get("committed_at") or 0)
    driver = get_memgraph_driver()
    with driver.session() as s:
        for d in deps:
            eco = d["ecosystem"];
            name = d["name"];
            ver = d.get("version", "")
            prev = s.run("""
                MATCH (prc:Commit)-[pu:UPDATES_DEP]->(dep:Dependency {ecosystem:$eco, name:$name})
                WHERE prc.committed_at < $t
                RETURN pu.version AS v
                ORDER BY prc.committed_at DESC LIMIT 1
            """, eco=eco, name=name, t=t_now).single()
            prev_ver = (prev["v"] if prev else None) or ""
            major = _semver_major_bump(prev_ver, ver)

            s.run("""
                MERGE (dep:Dependency {ecosystem:$eco, name:$name})
                ON CREATE SET dep.created_at = timestamp()
                WITH dep
                MATCH (c:Commit {sha:$sha})
                MERGE (c)-[u:UPDATES_DEP]->(dep)
                SET u.version = $ver,
                    u.prev_version = $prev,
                    u.is_major_bump = $major
            """, eco=eco, name=name, sha=sha, ver=ver, prev=prev_ver, major=(True if major else False))


def mg_upsert_imports(repo_id: str, branch: str, file_path: str, lang: str, imports: List[Dict],
                      local_resolutions: List[str]):
    """
    Creates (File)-[:IMPORTS {module, member, alias, resolved_path?}]->(File or Module)
    - For local_resolutions[i] != None, we point to (File {path: resolved_path})
    - Else we point to (Module {spec, lang}) to represent package/module
    """
    if not imports:
        return
    driver = get_memgraph_driver()
    rows = []
    for it in imports:
        rows.append({
            "module": it.get("module", ""),
            "member": it.get("member") or "",
            "alias": it.get("alias") or "",
        })
    # compute resolved per row (same order)
    resolveds = local_resolutions or [None] * len(rows)

    with driver.session() as s:
        for it, resolved in zip(rows, resolveds):
            if resolved:
                s.run("""
                    MATCH (src:File {path:$src})
                    MERGE (dst:File {path:$dst})
                    MERGE (src)-[r:IMPORTS {module:$mod}]->(dst)
                    SET r.member = $mem, r.alias = $alias, r.resolved = true
                """, src=file_path, dst=resolved, mod=it["module"], mem=it["member"], alias=it["alias"])
            else:
                s.run("""
                    MATCH (src:File {path:$src})
                    MERGE (m:Module {spec:$mod, lang:$lang})
                    MERGE (src)-[r:IMPORTS]->(m)
                    SET r.member = $mem, r.alias = $alias, r.resolved = false
                """, src=file_path, mod=it["module"], lang=lang, mem=it["member"], alias=it["alias"])


def mg_resolve_crossfile_calls(caller_file: str, lang: str, calls: List[Dict]):
    """
    For each call {name, start_line}, try to connect (callerSym)-[:CALLS]->(targetSym) across files
    imported via resolved IMPORTS.
    Strategy:
      1) Find Files that caller imports with r.resolved = true
      2) Among those files, if any declare Symbol with same name, create CALLS
    NOTE: We still keep intra-file CALLS earlier; this augments with cross-file edges.
    """
    calls = [c for c in calls if c.get("name")]
    if not calls:
        return
    driver = get_memgraph_driver()
    with driver.session() as s:
        for c in calls:
            s.run("""
                MATCH (callerFile:File {path:$fp})-[:DECLARES]->(callerSym:Symbol)
                WITH callerFile, callerSym
                MATCH (callerFile)-[:IMPORTS {resolved:true}]->(depFile:File)
                MATCH (depFile)-[:DECLARES]->(target:Symbol {name:$name})
                MERGE (callerSym)-[r:CALLS]->(target)
                ON CREATE SET r.at_line = $line
            """, fp=caller_file, name=c["name"], line=int(c.get("start_line") or 0))


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

        def z(x, mu, sd):
            return 0.0 if sd == 0 else (x - mu) / sd

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


def _callee_name(lang: str, node, code: bytes) -> str:
    """
    Best-effort: extract the callee identifier for Python `call` and JS/TS `call_expression`.
    - python:  (call (identifier) ...) | (call (attribute object: (_) attribute: (identifier)) ...)
    - js/ts:   (call_expression function: (identifier|member_expression ... property: (property_identifier|identifier)))
    """
    if not hasattr(node, "child_by_field_name"):
        return ""

    try:
        if lang == "python" and getattr(node, "type", "") == "call":
            fn = node.child_by_field_name("function")
            if not fn:
                return ""
            # identifier
            if getattr(fn, "type", "") == "identifier":
                return _text_slice(code, fn)
            # attribute: grab the rightmost identifier
            if getattr(fn, "type", "") == "attribute":
                attr = fn.child_by_field_name("attribute")
                if attr and getattr(attr, "type", "") == "identifier":
                    return _text_slice(code, attr)
                return _text_slice(code, fn)  # fallback

        if lang in ("javascript", "typescript") and getattr(node, "type", "") == "call_expression":
            fn = node.child_by_field_name("function")
            if not fn:
                return ""
            t = getattr(fn, "type", "")
            # direct identifier call: foo()
            if t in ("identifier", "property_identifier"):
                return _text_slice(code, fn)
            # member_expression: obj.foo() → take property
            if t == "member_expression":
                prop = fn.child_by_field_name("property")
                if prop and getattr(prop, "type", "") in ("property_identifier", "identifier"):
                    return _text_slice(code, prop)
                return _text_slice(code, fn)  # fallback
    except Exception:
        pass

    return ""


def _node_name(ast_node, code: bytes, cfg: LanguageConfig, kind: str, lang: str = "") -> str:
    if not hasattr(ast_node, "child_by_field_name"):
        return ""
    if kind in ("Function", "Class"):
        field_name = getattr(cfg, "name_field", None)
        n = ast_node.child_by_field_name(field_name) if field_name else None
        if not n:
            n = ast_node.child_by_field_name("identifier")
        return _text_slice(code, n) if n else ""
    if kind == "Call":
        return _callee_name(lang, ast_node, code)
    return ""


# ---------------- Python stdlib-AST fallback ----------------

# add near other fallbacks
def _py_fallback_imports(code: bytes) -> list[dict]:
    import ast
    out = []
    try:
        tree = ast.parse(code.decode("utf-8", "ignore"))
    except Exception:
        return out
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                out.append({"module": a.name, "member": None, "alias": a.asname})
        elif isinstance(n, ast.ImportFrom):
            mod = (n.module or "").strip()
            for a in n.names:
                out.append({"module": mod if mod else ".", "member": a.name, "alias": a.asname})
    return out


def _py_fallback_symbols_and_calls(code: bytes) -> Tuple[List[Dict], List[Dict]]:
    """
    Use Python stdlib 'ast' to recover Function/Class defs and Call names as a fallback.
    Returns (symbols, calls) where:
      symbols: [{kind:'Function'|'Class', name, start_line, end_line}]
      calls:   [{kind:'Call', name, start_line, end_line}]
    """
    import ast
    try:
        src = code.decode("utf-8", "ignore")
        tree = ast.parse(src)
    except Exception:
        return [], []

    symbols: List[Dict] = []
    calls: List[Dict] = []

    class _Visitor(ast.NodeVisitor):
        def visit_FunctionDef(self, node: ast.FunctionDef):
            try:
                el = getattr(node, "end_lineno", node.lineno)
            except Exception:
                el = node.lineno
            symbols.append({
                "kind": "Function",
                "name": node.name or "",
                "start_line": int(node.lineno or 0),
                "end_line": int(el or 0),
            })
            self.generic_visit(node)

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
            try:
                el = getattr(node, "end_lineno", node.lineno)
            except Exception:
                el = node.lineno
            symbols.append({
                "kind": "Function",
                "name": node.name or "",
                "start_line": int(node.lineno or 0),
                "end_line": int(el or 0),
            })
            self.generic_visit(node)

        def visit_ClassDef(self, node: ast.ClassDef):
            try:
                el = getattr(node, "end_lineno", node.lineno)
            except Exception:
                el = node.lineno
            symbols.append({
                "kind": "Class",
                "name": node.name or "",
                "start_line": int(node.lineno or 0),
                "end_line": int(el or 0),
            })
            self.generic_visit(node)

        def visit_Call(self, node: ast.Call):
            # Try to extract callee name: foo(), obj.foo()
            def _name(expr) -> str:
                try:
                    if isinstance(expr, ast.Name):
                        return expr.id
                    if isinstance(expr, ast.Attribute):
                        return expr.attr or ""
                except Exception:
                    pass
                return ""

            nm = _name(node.func)
            try:
                el = getattr(node, "end_lineno", node.lineno)
            except Exception:
                el = node.lineno
            if nm:
                calls.append({
                    "kind": "Call",
                    "name": nm,
                    "start_line": int(getattr(node, "lineno", 0) or 0),
                    "end_line": int(el or 0),
                })
            self.generic_visit(node)

    _Visitor().visit(tree)

    # keep only named defs
    symbols = [s for s in symbols if (s.get("name") or "").strip()]
    calls = [c for c in calls if (c.get("name") or "").strip()]
    return symbols, calls


def extract_symbols_coarse(code: bytes, lang: str, parser, query_pack) -> List[Dict]:
    """
    Try tree-sitter first; if it yields zero *named* results for Python, fall back to stdlib AST.
    """
    out: List[Dict] = []
    if not parser:
        # parser missing → pure fallback for Python
        if lang == "python":
            logging.info("[symbols:fallback] python: tree-sitter parser not available, using stdlib AST")
            fb_syms, fb_calls = _py_fallback_symbols_and_calls(code)
            return fb_syms + fb_calls
        return out

    # --- tree-sitter phase ---
    try:
        tree = parser.parse(code)
    except Exception:
        # parser failed → fallback for Python
        if lang == "python":
            fb_syms, fb_calls = _py_fallback_symbols_and_calls(code)
            return fb_syms + fb_calls
        return out

    root = tree.root_node
    cfg: LanguageConfig = LANGUAGE_CONFIGS.get(lang)  # may be None for unknowns
    qfunc = query_pack.get("functions") if query_pack else None
    qclass = query_pack.get("classes") if query_pack else None
    qcall = query_pack.get("calls") if query_pack else None

    def run_query(q, kind):
        if not q or not hasattr(q, "captures"):
            return []
        try:
            caps = q.captures(root)
        except Exception:
            return []

        logging.info(f"[symbols:capture] lang={lang} kind={kind} caps={len(caps)}")
        results = []

        for cap in caps:
            # cap is usually (node, capture_name)
            node = None
            cap_name = None

            # normalize tuple vs object
            if isinstance(cap, (tuple, list)):
                node = cap[0] if len(cap) > 0 else None
                cap_name = cap[1] if len(cap) > 1 else None
            else:
                # tree-sitter Python bindings: cap has .node and .name in many versions
                node = getattr(cap, "node", None)
                cap_name = getattr(cap, "name", None)

            if node is None:
                continue

            node_type = getattr(node, "type", "")

            # If the query returned only an identifier (e.g., @fn.name), promote to its parent
            # so our name extractor can still work with a full node.
            promoted = False
            if node_type == "identifier" and kind in ("Function", "Class"):
                parent = getattr(node, "parent", None)
                if parent is not None:
                    node = parent
                    node_type = getattr(node, "type", "")
                    promoted = True

            # Compute line range (prefer full node; if promoted, we got one)
            sp = _to_point(getattr(node, "start_point", None))
            ep = _to_point(getattr(node, "end_point", None))
            start_line = (sp[0] + 1) if (sp and len(sp) >= 1) else 0
            end_line = (ep[0] + 1) if (ep and len(ep) >= 1) else 0

            # Derive the name
            name = ""
            if promoted and kind in ("Function", "Class"):
                # We promoted from an identifier capture; use the child 'name' or stick to slice
                # Try exact child field first
                field_name = getattr(cfg, "name_field", None) if cfg else None
                child = node.child_by_field_name(field_name) if (
                        field_name and hasattr(node, "child_by_field_name")) else None
                if child and getattr(child, "type", "") == "identifier":
                    name = _text_slice(code, child)
                else:
                    # fallback: scan immediate children for identifier
                    try:
                        for i in range(node.named_child_count):
                            ch = node.named_child(i)
                            if getattr(ch, "type", "") == "identifier":
                                name = _text_slice(code, ch);
                                break
                    except Exception:
                        pass
            else:
                # Normal path: use _node_name (uses cfg.name_field)
                name = _node_name(node, code, cfg, kind, lang)

            results.append({
                "kind": kind,
                "name": (name or "").strip(),
                "start_line": start_line,
                "end_line": end_line,
            })

        return results

    funcs_all = run_query(qfunc, "Function")
    clss_all = run_query(qclass, "Class")
    calls_all = run_query(qcall, "Call")

    # keep only named for defs/calls
    funcs = [x for x in funcs_all if x["name"]]
    clss = [x for x in clss_all if x["name"]]
    calls = [x for x in calls_all if x["name"]]

    out.extend(funcs);
    out.extend(clss);
    out.extend(calls)

    # --- Python fallback if tree-sitter produced zero named items ---
    if lang == "python" and len(funcs) + len(clss) + len(calls) == 0:
        fb_syms, fb_calls = _py_fallback_symbols_and_calls(code)
        if fb_syms or fb_calls:
            logging.info(
                f"[symbols:fallback] python produced {len(fb_syms)} defs, {len(fb_calls)} calls via stdlib AST")
            out.extend(fb_syms);
            out.extend(fb_calls)

    return out


def extract_imports(code: bytes, lang: str, parser, query_pack) -> List[Dict]:
    """
    Returns [{module:str, member:str|None, alias:str|None}]
    For JS/TS 'require', member is None; for 'import {a as b}', member='a', alias='b'.
    Module string still quoted upstream; we strip later.
    """
    if lang == "python" and (not parser or not query_pack or not query_pack.get("imports")):
        return _py_fallback_imports(code)
    if not parser or not query_pack:
        return []
    qimp = query_pack.get("imports")
    if not qimp or not hasattr(qimp, "captures"):
        return []

    try:
        tree = parser.parse(code)
    except Exception:
        return []
    root = tree.root_node
    items = []
    try:
        caps = qimp.captures(root)
    except Exception:
        return []

    # We walk consecutive captures and assemble triples per import stmt naturally.
    # Simpler approach: push any (module/member/alias) we see as independent entries.
    current_module = None
    for cap in caps:
        node = None
        if hasattr(cap, "node"):
            node = cap.node
        elif isinstance(cap, (tuple, list)):
            a = cap[0] if len(cap) > 0 else None
            b = cap[1] if len(cap) > 1 else None
            node = a if hasattr(a, "text") or hasattr(a, "child_by_field_name") else (
                b if hasattr(b, "child_by_field_name") else None)
        elif hasattr(cap, "child_by_field_name"):
            node = cap
        if node is None:
            continue

        name = getattr(cap, "name", None)
        try:
            text = _text_slice(code, node).strip()
        except Exception:
            text = ""

        if name == "module":
            current_module = text
            # push a base record so we keep each module occurrence
            items.append({"module": current_module, "member": None, "alias": None})
        elif name == "member":
            items.append({"module": current_module, "member": text, "alias": None})
        elif name == "alias" or name == "req":
            # req is the identifier "require" itself; we don't use it here
            if name == "alias":
                items.append({"module": current_module, "member": None, "alias": text})

    # normalize quotes on module, and return
    out = []
    for it in items:
        mod = _strip_quotes(it["module"] or "")
        if not mod:
            continue
        out.append({"module": mod, "member": it.get("member"), "alias": it.get("alias")})
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

            # per-file nodes/edges + symbols (coarse) + calls + manifest deps + imports
            for fc in file_changes:
                path = fc["path"]
                status = fc["status"]
                adds = int(fc.get("additions", 0) or 0)
                dels = int(fc.get("deletions", 0) or 0)
                old_path = fc.get("old_path")
                ext = _file_ext(path)
                is_code = _is_code_file(path)

                mg_link_file_touch(repo_id, branch, sha, path, status, adds, dels, ext, is_code, old_path)

                # Always try to load blob (needed for manifests and imports)
                blob = _git_show_file(repo_path, sha, path)
                if not blob:
                    continue

                fname = os.path.basename(path)

                # Manifests: extract and upsert dependencies
                if fname in SPECIAL_CODE_FILES:
                    deps = parse_manifest(fname, blob)
                    if deps:
                        mg_upsert_dependencies(repo_id, branch, meta, deps)
                    if fname == "package.json":
                        try:
                            pkg_meta = json.loads(blob.decode("utf-8", "ignore") or "{}")
                            pkg_name = pkg_meta.get("name")
                            if pkg_name:
                                # npm ecosystem; normalize name the same way as parse_package_json
                                mg_link_repo_package(repo_id, "npm", pkg_name.lower())
                        except Exception:
                            logging.exception("[ingest] failed to link repo package from package.json")

                # Import graph (before symbol resolution)
                lang = EXT_TO_LANG.get(ext)
                parser = parsers.get(lang)
                qpack = queries.get(lang) if isinstance(queries, dict) else None

                imports = extract_imports(blob, (lang or ""), parser, qpack)
                if imports:
                    local_paths = []
                    for it in imports:
                        mod = it.get("module") or ""
                        resolved = _resolve_local_module_path(repo_path, path, mod, (lang or ""), sha) if _is_local_import((lang or ""), mod) else None
                        local_paths.append(resolved)
                    mg_upsert_imports(repo_id, branch, path, lang or "", imports, local_paths)

                # Skip symbol/calls parse on deletions / non-code / very large churn (speed)
                if status == "D" or not is_code:
                    continue
                if (adds + dels) > 200000:
                    continue

                # Symbols + calls
                symbols = extract_symbols_coarse(blob, lang, parser, qpack)
                if symbols:
                    defs_ct = sum(1 for x in symbols if x["kind"] in ("Function", "Class"))
                    calls_ct = sum(1 for x in symbols if x["kind"] == "Call")
                    logging.info(f"[symbols] {path} -> {defs_ct} defs, {calls_ct} calls")

                    syms = [x for x in symbols if x["kind"] in ("Function", "Class")]
                    calls = [x for x in symbols if x["kind"] == "Call"]

                    if syms:
                        mg_upsert_symbols(repo_id, branch, path, lang, sha, syms)

                    if calls:
                        # keep intra-file calls
                        mg_upsert_calls(path, lang, sha, calls)
                        # add cross-file edges into locally-resolved imports
                        mg_resolve_crossfile_calls(path, lang, calls)
                    try:
                        # Only compute if we actually found symbol definitions
                        if syms:
                            # Get the added/changed line ranges for the NEW file version in this commit
                            hunk_ranges = _git_hunks_added_new_file_ranges(repo_path, sha, path)
                            if hunk_ranges:
                                touches = {}
                                for sdef in syms:
                                    # symbol span inclusive (1-based lines)
                                    start = int(sdef.get("start_line") or 0)
                                    end = int(sdef.get("end_line") or 0)
                                    if start <= 0 or end <= 0 or end < start:
                                        continue
                                    rng = (start, end)

                                    # Sum overlap with each hunk in this commit for this file
                                    delta = 0
                                    for hr in hunk_ranges:
                                        delta += _ranges_overlap(rng, hr)

                                    if delta > 0:
                                        # keyed by symbol *name* within this file (our schema matches on file_path + name)
                                        touches[sdef["name"]] = touches.get(sdef["name"], 0) + int(delta)

                                # Write TOUCHED_SYMBOL edges with lines_changed
                                if touches:
                                    mg_touch_symbol(sha, path, touches)
                    except Exception:
                        logging.exception(f"[symbols] failed computing TOUCHED_SYMBOL for {path}")
                else:
                    logging.info(f"[symbols] {path} -> 0 (no defs/calls)")

                # Update author → file familiarity
                mg_inc_contributor_file_touch(sha, path, meta.get("committed_at"))

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
