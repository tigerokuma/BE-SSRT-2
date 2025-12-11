#!/bin/bash
set -e

# Load NVM (so npm is available)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if [ -z "$1" ]; then
  echo "Usage: ./scripts/gen_sbom.sh <package[@version]>"
  echo "Example: ./scripts/gen_sbom.sh express@4.18.0"
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

# Patch package.json to remove dev/build dependencies
if [ -f package.json ]; then
  echo "🛠️  Patching package.json to remove dev/build dependencies..."
  jq 'del(.devDependencies, .optionalDependencies, .peerDependencies, .resolutions, .overrides)' package.json > package.tmp.json
  mv package.tmp.json package.json

  # Remove a known broken package if present
  jq 'if .dependencies["@repo/builder"] then .dependencies |= del(.["@repo/builder"]) else . end' package.json > package.tmp.json
  mv package.tmp.json package.json
fi

# Install the main package first
echo "📦 Installing main package: $PACKAGE"
if ! npm install "$PACKAGE" --ignore-scripts --no-audit --no-fund --omit=dev; then
  echo "⚠️ Failed to install $PACKAGE, continuing..."
fi

# Install each runtime dependency individually
if [ -f package.json ]; then
  DEPENDENCIES=$(jq -r '.dependencies // {} | keys[]' package.json)
  for dep in $DEPENDENCIES; do
    echo "📦 Installing dependency: $dep ..."
    if ! npm install "$dep" --ignore-scripts --no-audit --no-fund --omit=dev; then
      echo "⚠️ Failed to install $dep, skipping..."
    fi
  done
fi

# Remove test folders
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