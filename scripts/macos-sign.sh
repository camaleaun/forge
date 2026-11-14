#!/usr/bin/env bash
# Signing, notarization and stapling steps for macOS releases.
#
# Without secrets nothing breaks: `sign` falls back to an ad-hoc signature and the other steps are skipped.
# Secrets (GitHub Actions secrets mapped to environment variables):
#   MACOS_CERTIFICATE_P12       base64 of the "Developer ID Application" certificate (.p12)
#   MACOS_CERTIFICATE_PASSWORD  password of the .p12
#   MACOS_SIGNING_IDENTITY      e.g. "Developer ID Application: Your Name (TEAMID)"
#   NOTARY_KEY_P8               base64 of the App Store Connect API key (AuthKey_XXXX.p8)
#   NOTARY_KEY_ID               the API key id
#   NOTARY_ISSUER_ID            the API issuer id
# FORGE_DRY_RUN=1 prints the commands (secrets masked as ***) instead of running them.
set -euo pipefail

KEYCHAIN_PASSWORD=""

usage() {
  echo "Usage: macos-sign.sh status | import-certificate | sign <path> | notarize <path> | staple <path>" >&2
  exit 2
}

dry_run() { [ "${FORGE_DRY_RUN:-}" = "1" ]; }

mask() {
  local text="$1" secret
  for secret in "${MACOS_CERTIFICATE_PASSWORD:-}" "${MACOS_CERTIFICATE_P12:-}" "${NOTARY_KEY_P8:-}" "$KEYCHAIN_PASSWORD"; do
    if [ -n "$secret" ]; then text="${text//"$secret"/***}"; fi
  done
  printf '%s' "$text"
}

run() {
  if dry_run; then
    local line="+" arg
    for arg in "$@"; do
      arg="$(mask "$arg")"
      if [[ "$arg" == '***' || "$arg" =~ ^[A-Za-z0-9_./:=@%+,-]+$ ]]; then line="$line $arg"; else line="$line $(printf '%q' "$arg")"; fi
    done
    printf '%s\n' "$line"
  else
    "$@"
  fi
}

have_identity() { [ -n "${MACOS_SIGNING_IDENTITY:-}" ]; }
have_notary() { [ -n "${NOTARY_KEY_P8:-}" ] && [ -n "${NOTARY_KEY_ID:-}" ] && [ -n "${NOTARY_ISSUER_ID:-}" ]; }
work_dir() { printf '%s' "${RUNNER_TEMP:-${TMPDIR:-/tmp}}"; }

cmd_status() {
  if have_identity; then echo "signing: Developer ID"; else echo "signing: disabled (ad-hoc)"; fi
  if have_notary; then echo "notarization: enabled"; else echo "notarization: disabled"; fi
}

cmd_import_certificate() {
  if [ -z "${MACOS_CERTIFICATE_P12:-}" ] || [ -z "${MACOS_CERTIFICATE_PASSWORD:-}" ]; then
    echo "certificate import skipped: MACOS_CERTIFICATE_P12 / MACOS_CERTIFICATE_PASSWORD are not set"
    return 0
  fi
  local dir keychain p12
  dir="$(work_dir)"
  keychain="$dir/forge-build.keychain-db"
  p12="$dir/certificate.p12"
  KEYCHAIN_PASSWORD="$(openssl rand -hex 16)"
  printf '%s' "$MACOS_CERTIFICATE_P12" | base64 --decode > "$p12"
  run security create-keychain -p "$KEYCHAIN_PASSWORD" "$keychain"
  run security set-keychain-settings -lut 21600 "$keychain"
  run security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$keychain"
  run security import "$p12" -P "$MACOS_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$keychain"
  run security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$keychain"
  run security list-keychains -d user -s "$keychain" login.keychain-db
  rm -f "$p12"
}

cmd_sign() {
  local path="${1:-}"
  [ -n "$path" ] || usage
  if ! have_identity; then
    run codesign --force --deep -s - "$path"
    return 0
  fi
  case "$path" in
    *.dmg|*.pkg) run codesign --force --timestamp -s "$MACOS_SIGNING_IDENTITY" "$path" ;;
    *) run codesign --force --deep --options runtime --timestamp -s "$MACOS_SIGNING_IDENTITY" "$path" ;;
  esac
}

cmd_notarize() {
  local path="${1:-}"
  [ -n "$path" ] || usage
  if ! have_notary; then
    echo "notarization skipped: no App Store Connect API credentials"
    return 0
  fi
  local dir key submit output
  dir="$(work_dir)/forge-notary"
  key="$dir/AuthKey.p8"
  mkdir -p "$dir"
  printf '%s' "$NOTARY_KEY_P8" | base64 --decode > "$key"
  chmod 600 "$key"
  submit="$path"
  case "$path" in
    *.app)
      submit="$dir/$(basename "$path").zip"
      run ditto -c -k --keepParent "$path" "$submit"
      ;;
  esac
  local command=(xcrun notarytool submit "$submit" --key "$key" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER_ID" --wait)
  if dry_run; then
    run "${command[@]}"
    rm -f "$key"
    return 0
  fi
  output="$("${command[@]}")" || { rm -f "$key"; echo "$output"; return 1; }
  rm -f "$key"
  echo "$output"
  if ! grep -q 'status: Accepted' <<<"$output"; then
    echo "error: notarization was not accepted" >&2
    return 1
  fi
}

cmd_staple() {
  local path="${1:-}"
  [ -n "$path" ] || usage
  if ! have_notary; then
    echo "stapling skipped: no App Store Connect API credentials"
    return 0
  fi
  run xcrun stapler staple "$path"
}

case "${1:-}" in
  status) cmd_status ;;
  import-certificate) cmd_import_certificate ;;
  sign) cmd_sign "${2:-}" ;;
  notarize) cmd_notarize "${2:-}" ;;
  staple) cmd_staple "${2:-}" ;;
  *) usage ;;
esac
