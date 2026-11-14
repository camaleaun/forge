#!/usr/bin/env bash
# Shows the language download progress bar filling up, on macOS.
#
# Usage: demo-download-progress.sh <app-project-dir> [language-tag=pt-BR] [pack-kb=400] [seconds=20]
#
# The real language pack is a few hundred bytes: it downloads in a blink and the macOS networking layer hands such a
# small body over in one piece, so the bar can never be seen filling. This script makes a COPY of the app whose
# translation file is padded with dummy phrases (the pack becomes about <pack-kb> KB), builds it with forge, serves
# its pack slowly from a local server and opens the app so that it downloads the pack from there. Your real
# language cache and preferences are not touched: the demo uses its own cache folder.
set -euo pipefail
if [ "$#" -lt 1 ]; then
  echo "Usage: demo-download-progress.sh <app-project-dir> [language-tag=pt-BR] [pack-kb=400] [seconds=20]" >&2
  exit 2
fi
project="$1"; tag="${2:-pt-BR}"; kb="${3:-400}"; seconds="${4:-20}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
forge="$here/../bin/forge"
if [ ! -f "$project/App.tsx" ] || [ ! -d "$project/languages" ]; then
  echo "error: $project is not an app folder with App.tsx and a languages/ folder (not found)" >&2
  exit 1
fi

work="$(mktemp -d)"
server_pid=""
cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

echo "Copying the app and padding its $tag translations to about $kb KB (dummy phrases)..."
mkdir -p "$work/app"
( cd "$project" && tar --exclude=node_modules --exclude=.git --exclude=build --exclude=dist -cf - . ) | ( cd "$work/app" && tar -xf - )
lang_file="$(find "$work/app/languages" -iname "${tag//-/_}.lang" -o -iname "$tag.lang" | head -n 1)"
if [ -z "$lang_file" ]; then echo "error: languages/$tag.lang not found in $project" >&2; exit 1; fi
python3 - "$lang_file" "$kb" <<'PY'
import sys
path, kb = sys.argv[1], int(sys.argv[2])
rows, size, i = [], 0, 0
while size < kb * 1024:
    line = f"demo padding phrase number {i}\tfrase de enchimento numero {i} para o teste da barra\n"
    rows.append(line)
    size += len(line.encode())
    i += 1
with open(path, 'a', encoding='utf-8') as f:
    f.write('\n' + ''.join(rows))
PY

name="$("$forge" info --project "$work/app" --field name)"
echo "Building $name..."
"$forge" build --project "$work/app" --out "$work/src" >/dev/null 2>"$work/build.log" || { cat "$work/build.log" >&2; exit 1; }
cmake -S "$work/src" -B "$work/build" >/dev/null && cmake --build "$work/build" >/dev/null
pack="$(find "$work/src/lang" -name '*.lang' | head -n 1)"
echo "Pack: $(wc -c < "$pack" | tr -d ' ') bytes"

python3 "$here/slow-pack-server.py" "$pack" "$work/port" "$seconds" 40 &
server_pid=$!
for _ in $(seq 1 50); do [ -s "$work/port" ] && break; sleep 0.1; done

echo "Opening $name. Choose the language in the dropdown: the bar should fill over about $seconds s. Close the window to finish."
FORGE_I18N_CACHE_DIR="$work/cache" \
FORGE_I18N_BASE_URL="http://127.0.0.1:$(cat "$work/port")/" \
FORGE_I18N_TIMEOUT_MS=120000 \
  "$work/build/$name.app/Contents/MacOS/$name" || true
