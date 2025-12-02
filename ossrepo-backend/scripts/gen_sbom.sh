#!/bin/bash
set -e

# Load NVM (so npm is available)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if [ -z "$1" ]; then
  echo "Usage: ./gen_sbom_remote.sh <package[@version]>"
  echo "Example: ./gen_sbom_remote.sh express@4.18.0"
  exit 1
fi

PACKAGE="$1"
WORK_DIR="/tmp/sbom-run-$(date +%s)"
OUTPUT_FILE="sbom-output.json"

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

echo "📦 Downloading npm package: $PACKAGE"
# Use npm from PATH (works both locally and remotely)
# If NVM is available, it will be loaded at the top of the script
npm pack "$PACKAGE" || {
  echo "❌ Failed to download npm package: $PACKAGE"
  echo '{"bomFormat":"CycloneDX","specVersion":"1.5","version":1,"components":[]}' > "$OUTPUT_FILE"
  exit 0
}

TARBALL=$(ls *.tgz)

echo "📂 Extracting package..."
mkdir repo
tar -xzf "$TARBALL" -C repo

if [ -d "repo/package" ]; then
  mv repo/package/* repo/ 2>/dev/null || true
  # Remove the package directory (use rm -rf in case there are hidden files)
  rm -rf repo/package
fi

echo "📦 Installing dependencies inside repo/"
cd repo

# Use npm from PATH (works both locally and remotely)
npm install --ignore-scripts --no-audit --no-fund || {
  echo "⚠️ npm install failed; continuing anyway"
}

# Remove tests
for dir in test tests __tests__; do
  if [ -d "$dir" ]; then
    echo "🧹 Removing $dir"
    rm -rf "$dir"
  fi
done

echo "🚀 Running cdxgen..."
if ! docker run --rm -v "$(pwd)":/app ghcr.io/cyclonedx/cdxgen:latest \
  -o "/app/$OUTPUT_FILE"; then
  echo "⚠️ cdxgen failed, retrying with --no-recurse"
  docker run --rm -v "$(pwd)":/app ghcr.io/cyclonedx/cdxgen:latest \
    --no-recurse -o "/app/$OUTPUT_FILE"
fi

FINAL_PATH="$(pwd)/$OUTPUT_FILE"

echo "📦 SBOM saved to: $FINAL_PATH"
echo "----- SBOM OUTPUT START -----"
cat "$OUTPUT_FILE"
echo "----- SBOM OUTPUT END -----"

# Cleanup old runs
find /tmp -maxdepth 1 -type d -name "sbom-run-*" -mmin +30 -exec rm -rf {} +

# Remove this run's working directory
rm -rf "$WORK_DIR"

echo "$FINAL_PATH"