#!/usr/bin/env bash
# Builds an AppImage from an installed tree (what `cmake --install` makes with DESTDIR).
# The AppImage is the type2 runtime followed by a squashfs of the AppDir. It does not bundle GTK 4:
# the system must provide it. The runtime is downloaded from a pinned release and checked against a pinned sha256.
# Offline or mirrored builds can set FORGE_APPIMAGE_RUNTIME_FILE (a local runtime) and FORGE_APPIMAGE_RUNTIME_SHA256.
# Usage: linux-appimage.sh <install-root> <app-name> <app-id> <x86_64|aarch64|arm64> <output.AppImage>
set -euo pipefail

root="${1:-}"
name="${2:-}"
app_id="${3:-}"
arch="${4:-}"
output="${5:-}"
if [ -z "$root" ] || [ -z "$name" ] || [ -z "$app_id" ] || [ -z "$arch" ] || [ -z "$output" ]; then
  echo "Usage: linux-appimage.sh <install-root> <app-name> <app-id> <x86_64|aarch64|arm64> <output.AppImage>" >&2
  exit 2
fi

# AppImage/type2-runtime release 20251108 (never "continuous": it would break the pin).
RUNTIME_RELEASE=20251108
RUNTIME_SHA256_X86_64=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d
RUNTIME_SHA256_AARCH64=00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444

case "$arch" in
  x86_64 | amd64) runtime_arch=x86_64 expected="$RUNTIME_SHA256_X86_64" ;;
  aarch64 | arm64) runtime_arch=aarch64 expected="$RUNTIME_SHA256_AARCH64" ;;
  *)
    echo "error: unknown architecture \"$arch\" (use x86_64 or aarch64/arm64)" >&2
    exit 2
    ;;
esac
expected="${FORGE_APPIMAGE_RUNTIME_SHA256:-$expected}"

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

runtime="$work/runtime"
if [ -n "${FORGE_APPIMAGE_RUNTIME_FILE:-}" ]; then
  cp "$FORGE_APPIMAGE_RUNTIME_FILE" "$runtime"
else
  url="https://github.com/AppImage/type2-runtime/releases/download/$RUNTIME_RELEASE/runtime-$runtime_arch"
  curl -fsSL -o "$runtime" "$url" || { echo "error: could not download $url" >&2; exit 1; }
fi
actual="$(sha256_of "$runtime")"
if [ "$actual" != "$expected" ]; then
  echo "error: the runtime sha256 is $actual, expected $expected" >&2
  exit 1
fi

appdir="$work/AppDir"
mkdir -p "$appdir"
cp -R "$root/usr" "$appdir/usr"
cat > "$appdir/AppRun" << APPRUN
#!/bin/sh
HERE="\$(dirname "\$(readlink -f "\$0")")"
exec "\$HERE/usr/bin/$name" "\$@"
APPRUN
chmod +x "$appdir/AppRun"
cp "$root/usr/share/applications/$app_id.desktop" "$appdir/$app_id.desktop"
for size in 512x512 256x256; do
  icon="$root/usr/share/icons/hicolor/$size/apps/$app_id.png"
  if [ -f "$icon" ]; then
    cp "$icon" "$appdir/$app_id.png"
    cp "$icon" "$appdir/.DirIcon"
    break
  fi
done

mksquashfs "$appdir" "$work/image.squashfs" -root-owned -noappend -comp zstd -no-progress > /dev/null
cat "$runtime" "$work/image.squashfs" > "$output"
chmod +x "$output"
