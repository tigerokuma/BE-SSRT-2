import logging
import sys
from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
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


# ------------------------------ Build task ------------------------------

def run_build_task(req: BuildRequest):
    logging.info(f"🚀 Starting branch ingest: task={req.taskId} repo={req.repoId} branch={req.branch}")
    update_task_status(req.taskId, "in_progress", f"Branch ingest started for {req.repoId}#{req.branch}")

    use_temp = not req.repoPath or not req.repoPath.strip()
    workdir = None

    if use_temp:
        workdir = tempfile.mkdtemp(prefix=f"build-{req.taskId}-")
        repo_dir = os.path.join(workdir, "repo")
    else:
        repo_dir = req.repoPath
        if os.path.exists(repo_dir):
            try:
                rmtree_robust(repo_dir)
            except Exception as e:
                logging.error(f"Failed to delete directory before clone: {e}")
                update_task_status(req.taskId, "failed", f"Failed to clean repo path: {e}")
                return

    try:
        # Clone and checkout branch
        subprocess.run(["gh", "repo", "clone", req.repoId, repo_dir], check=True)
        subprocess.run(["git", "config", "--global", "--add", "safe.directory", os.path.abspath(repo_dir)], check=False)
        subprocess.run(["git", "fetch", "--all", "--tags", "--prune"], cwd=repo_dir, check=True)
        subprocess.run(["git", "checkout", req.branch], cwd=repo_dir, check=True)
        subprocess.run(["git", "pull", "--ff-only"], cwd=repo_dir, check=False)

        # Head sha (for logging only)
        head_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=repo_dir,
            capture_output=True, text=True, check=True
        ).stdout.strip()
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
            if use_temp and workdir and os.path.exists(workdir):
                rmtree_robust(workdir)
                logging.info(f"🧹 Deleted temp workdir {workdir}")
            elif not use_temp and os.path.exists(repo_dir):
                rmtree_robust(repo_dir)
                logging.info(f"🧹 Deleted cloned repo at {repo_dir}")
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
