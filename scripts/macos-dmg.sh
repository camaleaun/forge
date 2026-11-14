#!/usr/bin/env bash
# Runs cpack for the DMG and retries when it fails.
# The styled DMG is laid out through the Finder; on busy machines (CI runners) the Finder sometimes keeps the
# volume mounted and cpack fails at "hdiutil detach". Detaching with -force and trying again fixes it.
# Usage: macos-dmg.sh <CPackConfig.cmake> <build-dir> <volume-name>
set -euo pipefail

config="${1:-}"
out="${2:-}"
volume="${3:-}"
if [ -z "$config" ] || [ -z "$out" ] || [ -z "$volume" ]; then
  echo "Usage: macos-dmg.sh <CPackConfig.cmake> <build-dir> <volume-name>" >&2
  exit 2
fi

attempts="${FORGE_DMG_ATTEMPTS:-3}"
for ((attempt = 1; attempt <= attempts; attempt++)); do
  rm -rf "$out"
  if cpack --config "$config" -G DragNDrop -B "$out"; then
    exit 0
  fi
  echo "cpack failed (attempt $attempt of $attempts); detaching /Volumes/$volume and retrying" >&2
  hdiutil detach "/Volumes/$volume" -force > /dev/null 2>&1 || true
  sleep "${FORGE_DMG_RETRY_DELAY:-5}"
done
echo "error: cpack failed $attempts times" >&2
exit 1
