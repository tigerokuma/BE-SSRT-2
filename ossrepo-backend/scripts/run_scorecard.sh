#!/bin/bash

# Script to run OpenSSF Scorecard on a repository (local or remote)
# Usage: ./run_scorecard.sh <repo_path> [commit_sha] [owner] [repo]

set -e

cleanup() {
  exit_code=$?
  exit $exit_code
}
trap cleanup EXIT INT TERM

REPO_PATH="$1"
COMMIT_SHA="$2"
OWNER="$3"
REPO="$4"

if [ -z "$REPO_PATH" ]; then
  echo "Error: Repository path is required" >&2
  echo "Usage: $0 <repo_path> [commit_sha] [owner] [repo]" >&2
  exit 1
fi

# If local path doesn't exist, try GitHub mode
if [ ! -d "$REPO_PATH" ]; then
  if [ -n "$OWNER" ] && [ -n "$REPO" ]; then
    echo "Local repo not found, using GitHub remote instead..."

    if [ -n "$COMMIT_SHA" ]; then
      scorecard \
        --repo="github.com/${OWNER}/${REPO}" \
        --commit="$COMMIT_SHA" \
        --format=json \
        --show-details
    else
      scorecard \
        --repo="github.com/${OWNER}/${REPO}" \
        --format=json \
        --show-details
    fi

    exit 0
  else
    echo "Error: Local path does not exist and no GitHub repo provided." >&2
    exit 1
  fi
fi

# Local repository mode
if [ -n "$COMMIT_SHA" ]; then
  scorecard \
    --local="$REPO_PATH" \
    --commit="$COMMIT_SHA" \
    --format=json \
    --show-details
else
  scorecard \
    --local="$REPO_PATH" \
    --format=json \
    --show-details
fi
