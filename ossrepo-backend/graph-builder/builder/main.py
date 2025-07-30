import logging
import sys
from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import subprocess
import os
import shutil

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

def run_build_task(req: BuildRequest):
    logging.info(f"🚀 Starting build task: {req.taskId} for repo {req.repoId}")
    update_task_status(req.taskId, "in_progress", "Task started by builder")

    if os.path.exists(req.repoPath):
        try:
            shutil.rmtree(req.repoPath)
        except Exception as e:
            logging.error(f"Failed to delete directory: {e}")
            update_task_status(req.taskId, "failed", f"Failed to clean repo path: {e}")
            return

    try:
        subprocess.run(["gh", "repo", "clone", req.repoId, req.repoPath], check=True)
        if req.commitId:
            subprocess.run(["git", "checkout", req.commitId], cwd=req.repoPath, check=True)

        run_ast_extraction(
            req.repoPath,
            req.repoId,
            req.taskId,
            req.commitId,
        )

    except subprocess.CalledProcessError as e:
        logging.error(f"Git error: {e}")
        update_task_status(req.taskId, "failed", f"Git error: {e}")

    except Exception as e:
        logging.error(f"Unhandled error: {e}")
        update_task_status(req.taskId, "failed", f"Unhandled error: {e}")

    finally:
        # CLEANUP: always try to delete the repo dir, no matter what
        if os.path.exists(req.repoPath):
            try:
                shutil.rmtree(req.repoPath)
                logging.info(f"🧹 Deleted cloned repo at {req.repoPath}")
            except Exception as e:
                logging.error(f"Failed to delete repo after build: {e}")


@app.post("/internal/build", status_code=202)
def trigger_build(req: BuildRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_build_task, req)
    return {
        "message": "Build started in background",
        "taskId": req.taskId,
        "status": "queued"
    }
