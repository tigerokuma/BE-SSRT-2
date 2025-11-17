import logging
import sys
from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List
import subprocess
import os
import shutil
import stat
import time
import platform
import tempfile

from .build_engine import (
    run_branch_ingest,
    update_task_status,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    force=True,
    stream=sys.stderr,
)

app = FastAPI()


class BuildRequest(BaseModel):
    repoId: str                     # e.g. "owner/repo"
    taskId: str
    branch: Optional[str] = "main"  # which branch to walk
    repoPath: Optional[str] = None  # optional local path (otherwise we clone into a temp dir)
    startSha: Optional[str] = None  # OPTIONAL: start AFTER this sha (exclusive), otherwise continue from graph cursor


# ---------- Robust deletion utilities (Windows-friendly) ----------

def _win_long_path(p: str) -> str:
    """Prefix with \\?\\ to avoid MAX_PATH issues on Windows."""
    if platform.system() == "Windows":
        ap = os.path.abspath(p)
        if not ap.startswith("\\\\?\\"):
            return "\\\\?\\" + ap
        return ap
    return p


def _handle_remove_readonly(func, path, exc_info):
    """Clear read-only and retry the failed operation."""
    try:
        os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
    except Exception:
        pass
    try:
        func(path)
    except Exception:
        # let caller handle retries/backoff
        raise


def rmtree_robust(path: str, retries: int = 6, base_delay: float = 0.25) -> None:
    """
    Delete a directory tree, handling Windows file locks and read-only files.
    Retries with exponential backoff.
    """
    if not path:
        return
    path = _win_long_path(path)

    last_err = None
    for i in range(retries):
        try:
            shutil.rmtree(path, onerror=_handle_remove_readonly)
            return
        except FileNotFoundError:
            return
        except Exception as e:
            last_err = e
            time.sleep(base_delay * (2 ** i))
    # final attempt; let it raise so caller can log
    shutil.rmtree(path, onerror=_handle_remove_readonly)


# ------------------------------ subprocess helpers ------------------------------

def _run(cmd: List[str], cwd: Optional[str] = None, check: bool = True, timeout: int = 300):
    """Run a command without capturing stdout (used for most git ops)."""
    return subprocess.run(cmd, cwd=cwd, check=check, timeout=timeout)

def _run_out(cmd: List[str], cwd: Optional[str] = None, timeout: int = 300) -> str:
    """Run a command and return stdout as text (for commands like `git rev-parse`)."""
    cp = subprocess.run(cmd, cwd=cwd, check=True, timeout=timeout,
                        capture_output=True, text=True)
    return cp.stdout.strip()


# ------------------------------ Build task ------------------------------

def run_build_task(req: BuildRequest):
    logging.info(f"🚀 Starting branch ingest: task={req.taskId} repo={req.repoId} branch={req.branch}")
    update_task_status(req.taskId, "in_progress", f"Branch ingest started for {req.repoId}#{req.branch}")

    use_temp = True
    workdir = None

    # Clone depth control: default = full history; set SHALLOW_CLONE=1 to speed up
    SHALLOW = os.getenv("SHALLOW_CLONE", "0") not in ("0", "false", "False")

    try:
        workdir = tempfile.mkdtemp(prefix=f"build-{req.taskId}-")
        repo_dir = os.path.join(workdir, "repo")
        clone_cmd = ["gh", "repo", "clone", req.repoId, repo_dir]
        if SHALLOW:
            clone_cmd += ["--", "--depth=1"]
        _run(clone_cmd)
            # else reuse existing workspace without deleting user path

        # per-repo safe.directory only
        try:
            _run(["git", "config", "--add", "safe.directory", os.path.abspath(repo_dir)], check=False)
        except Exception:
            pass

        # fetch + checkout branch
        _run(["git", "fetch", "--all", "--tags", "--prune"], cwd=repo_dir)
        _run(["git", "checkout", req.branch], cwd=repo_dir)
        _run(["git", "pull", "--ff-only"], cwd=repo_dir)  # non-fatal if already up-to-date

        # Head sha (for logging only)
        try:
            head_sha = _run_out(["git", "rev-parse", "HEAD"], cwd=repo_dir)
        except Exception:
            head_sha = ""
        if head_sha:
            logging.info(f"[git] {req.repoId}#{req.branch} HEAD: {head_sha}")

        # Limits for safety (tunable via env)
        max_commits = int(os.getenv("WALK_MAX_COMMITS", "0"))  # 0 = walk all available
        workers = int(os.getenv("WALK_WORKERS", "8"))

        run_branch_ingest(
            repo_path=repo_dir,
            repo_id=req.repoId,
            branch=req.branch or "main",
            task_id=req.taskId,
            start_exclusive_sha=req.startSha,   # if None, we continue from graph cursor
            max_commits=max_commits,
            workers=workers,
        )

    except subprocess.CalledProcessError as e:
        logging.error(f"Git error: {e}")
        update_task_status(req.taskId, "failed", f"Git error: {e}")

    except Exception as e:
        logging.error(f"Unhandled error: {e}")
        update_task_status(req.taskId, "failed", f"Unhandled error: {e}")



    finally:

        time.sleep(0.2)

        try:

            if workdir and os.path.exists(workdir):
                rmtree_robust(workdir)

                logging.info(f"🧹 Deleted temp workdir {workdir}")

        except Exception as e:

            logging.error(f"Cleanup failed: {e}")


@app.post("/internal/build", status_code=202)
def trigger_build(req: BuildRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_build_task, req)
    return {
        "message": "Branch ingest started",
        "taskId": req.taskId,
        "status": "queued",
        "repo": req.repoId,
        "branch": req.branch or "main",
    }
