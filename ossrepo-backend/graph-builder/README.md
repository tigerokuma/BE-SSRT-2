# Graph Builder (Python microservice)

## Quickstart

1. Create a virtual environment:
    python3 -m venv .venv
    source .venv/bin/activate

2. Install dependencies:
    pip install -r requirements.txt

3. Run the FastAPI server:
    uvicorn builder.main:app --reload --host 0.0.0.0 --port 8000

## Endpoint

POST /internal/build

Payload:
{
  "repoId": "abc123",
  "repoPath": "/tmp/cloned-repo",
  "language": "python",
  "taskId": "build-xyz",
  "commitId": "d34db33f"
}
