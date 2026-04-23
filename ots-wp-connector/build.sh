#!/usr/bin/env bash
# Builds a versioned ZIP of the OTS Connector WordPress plugin.
# Output: ../ots-wp-connector-v<version>.zip (e.g. ots-wp-connector-v0.2.0.zip)
# The version is read from the `Version:` header in ots-connector.php.

set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PARENT_DIR="$( dirname "$SCRIPT_DIR" )"

VERSION=$(grep -E '^\s*\*\s*Version:' "$SCRIPT_DIR/ots-connector.php" | awk -F':' '{print $2}' | xargs)

if [[ -z "$VERSION" ]]; then
  echo "ERROR: could not read Version header from ots-connector.php" >&2
  exit 1
fi

OUT="$PARENT_DIR/ots-wp-connector-v${VERSION}.zip"

# Clean older builds of this same version so we always ship a fresh zip.
rm -f "$OUT"

cd "$PARENT_DIR"
zip -rq "$OUT" ots-wp-connector \
  --exclude "ots-wp-connector/.git*" \
  --exclude "ots-wp-connector/build.sh" \
  --exclude "ots-wp-connector/.DS_Store" \
  --exclude "ots-wp-connector/*/.DS_Store"

SIZE=$(ls -lh "$OUT" | awk '{print $5}')
echo "Built: $OUT  ($SIZE)"
