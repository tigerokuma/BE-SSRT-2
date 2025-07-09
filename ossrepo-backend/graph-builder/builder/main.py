from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional
import subprocess
import os

app = FastAPI()

class BuildRequest(BaseModel):
    repoId: str     # e.g., "org/repo"
    repoPath: str   # e.g., "/tmp/cloned-repo"
    taskId: str
    commitId: Optional[str] = None

@app.post("/internal/build")
def trigger_build(req: BuildRequest):
    # Step 1: Ensure the target directory does not exist yet (or is empty)
    if os.path.exists(req.repoPath):
        return {
            "message": f"Target path {req.repoPath} already exists!",
            "taskId": req.taskId,
            "status": "error"
        }
    # Step 2: Clone the repo with GitHub CLI
    clone_cmd = ["gh", "repo", "clone", req.repoId, req.repoPath]
    try:
        subprocess.run(clone_cmd, check=True)
        # Step 3: If a specific commit is requested, check it out
        if req.commitId:
            subprocess.run(
                ["git", "checkout", req.commitId],
                cwd=req.repoPath,
                check=True
            )
        message = f"Cloned {req.repoId} to {req.repoPath}"
        status = "in_progress"
    except subprocess.CalledProcessError as e:
        message = f"Failed to clone or checkout: {e}"
        status = "error"
    return {
        "message": message,
        "taskId": req.taskId,
        "status": status
    }
