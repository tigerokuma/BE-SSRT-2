import logging
import sys
from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import subprocess
import os
import shutil

from .build_engine import run_ast_extraction

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
    logging.info(f"Starting build task: {req.taskId} for repo {req.repoId}")
    if os.path.exists(req.repoPath):
        try:
            shutil.rmtree(req.repoPath)
        except Exception as e:
            logging.error(f"Failed to delete existing directory: {e}")
            return
    clone_cmd = ["gh", "repo", "clone", req.repoId, req.repoPath]
    try:
        subprocess.run(clone_cmd, check=True)
        if req.commitId:
            subprocess.run(["git", "checkout", req.commitId], cwd=req.repoPath, check=True)
        # Pass repoId and taskId (as subtaskId for now)
        run_ast_extraction(
            req.repoPath,
            req.repoId,
            req.taskId,  # this is your task_id, NOT subtask_id
            req.commitId,
        )
    except subprocess.CalledProcessError as e:
        logging.error(f"Failed to clone or checkout: {e}")

@app.post("/internal/build", status_code=202)
def trigger_build(req: BuildRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_build_task, req)
    return {
        "message": "Build started in background",
        "taskId": req.taskId,
        "status": "queued"
    }
