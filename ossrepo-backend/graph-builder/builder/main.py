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

from .build_engine import run_ast_extraction, update_task_status

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    force=True,
    stream=sys.stderr
)

app = FastAPI()


class BuildRequest(BaseModel):
    repoId: str
    repoPath: str
    taskId: str
    commitId: Optional[str] = None


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
    logging.info(f"🚀 Starting build task: {req.taskId} for repo {req.repoId}")
    update_task_status(req.taskId, "in_progress", "Task started by builder")

    use_temp = not req.repoPath or not req.repoPath.strip()
    workdir = None

    if use_temp:
        # use an isolated temporary workspace
        workdir = tempfile.mkdtemp(prefix=f"build-{req.taskId}-")
        repo_dir = os.path.join(workdir, "repo")
    else:
        # honor provided repoPath; pre-clean robustly
        repo_dir = req.repoPath
        if os.path.exists(repo_dir):
            try:
                rmtree_robust(repo_dir)
            except Exception as e:
                logging.error(f"Failed to delete directory before clone: {e}")
                update_task_status(req.taskId, "failed", f"Failed to clean repo path: {e}")
                return

    try:
        # Clone the repo
        subprocess.run(["gh", "repo", "clone", req.repoId, repo_dir], check=True)

        # Mark repo safe (fix “unsafe repository / dubious ownership”)
        subprocess.run(
            ["git", "config", "--global", "--add", "safe.directory", os.path.abspath(repo_dir)],
            check=False
        )

        # If commitId is provided, checkout that commit
        if req.commitId:
            subprocess.run(["git", "checkout", req.commitId], cwd=repo_dir, check=True)
            commit_id = req.commitId
        else:
            # Otherwise, get current HEAD commit hash
            completed = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=repo_dir,
                capture_output=True, text=True, check=True
            )
            commit_id = completed.stdout.strip()
            logging.info(f"No commitId provided. Using current HEAD: {commit_id}")

        # Ensure we have enough history for `git blame`
        # (works for shallow clones; harmless if already full)
        subprocess.run(["git", "fetch", "--unshallow"], cwd=repo_dir, check=False)
        subprocess.run(["git", "fetch", "--depth=1000"], cwd=repo_dir, check=False)

        # Sanity logs to confirm a real git repo
        subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=repo_dir, check=True)
        head_line = subprocess.run(
            ["git", "log", "-1", "--pretty=%h %an %ad -- %s"],
            cwd=repo_dir, capture_output=True, text=True, check=False
        ).stdout.strip()
        logging.info(f"[git] HEAD: {head_line or commit_id}")

        # Run your pipeline (now blame should work)
        run_ast_extraction(
            repo_dir,
            req.repoId,
            req.taskId,
            commit_id,
        )

    except subprocess.CalledProcessError as e:
        logging.error(f"Git error: {e}")
        update_task_status(req.taskId, "failed", f"Git error: {e}")

    except Exception as e:
        logging.error(f"Unhandled error: {e}")
        update_task_status(req.taskId, "failed", f"Unhandled error: {e}")

    finally:
        # CLEANUP: small delay to let any lingering processes release handles
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
        "message": "Build started in background",
        "taskId": req.taskId,
        "status": "queued"
    }
