---
title: Packaging and releases
description: "Package a forge app as a macOS .app and styled .dmg, add an icon from icon.svg, sign and notarize with secrets, and publish releases with latest.json and forge-action."
order: 6
---

# Packaging and releases

## macOS app

`forge build` plus CMake produce `<name>.app`, a native bundle with the CLI in the same binary. The hello app is about 73 KB. Add `-DFORGE_UNIVERSAL=ON` for a universal (arm64 + x86_64) build.

## Styled DMG

CMake's CPack creates a `.dmg` that opens as a small fixed window: a background picture, the app on the left and an **Applications** shortcut on the right. The layout is set through the Finder with a generated AppleScript, so it needs a Mac session (on macOS CI runners it works, with a rare Finder hiccup). `scripts/macos-dmg.sh` retries `cpack` up to three times, detaching the volume with `-force` between attempts. Do not keep a volume named like your app mounted while building.

```sh
forge/scripts/macos-dmg.sh build/out/CPackConfig.cmake build/cpack hello
```

## Icons

Put an `icon.svg` next to `App.tsx`. `forge build` renders it with its own SVG rasterizer (a simple subset of SVG) into `AppIcon.icns` and bundles it in the app. The icon is a classic `.icns` with the rounded square drawn in.

### Liquid Glass icon (macOS 26)

For the system's Liquid Glass look, add an `icon/` folder next to `App.tsx` with flat, square SVG layers (no rounded square: the system applies the shape and the glass):

| File | Purpose |
|---|---|
| `icon/background.svg` | Required. The background layer. |
| `icon/foreground-1.svg`, `icon/foreground-2.svg`, ... | At least one, numbered from 1 without gaps, back to front. |

`forge build` checks the layers (SVG problems are reported as `icon/<file>:line:column`, layers must be square, symbolic links are refused) and writes an `AppIcon.icon/` folder next to the generated sources. The generated `CMakeLists.txt` looks for Xcode 26's `actool` when it is configured. If it finds version 26 or newer, it compiles `AppIcon.icon` into `Assets.car` plus a fallback `AppIcon.icns`, copies both to the bundle's Resources and adds `CFBundleIconName` to `Info.plist`. Without it, the app falls back to the classic icon made from `icon.svg`, and has no icon if there is none. Keep an `icon.svg` too if you build on machines without Xcode 26.

## Signing and notarization

Without any secret, the app is signed **ad-hoc** and not notarized, and macOS may ask the user to confirm the first launch (System Settings, Privacy and Security, Open Anyway). To ship signed and notarized builds you need a paid Apple Developer account and these secrets, which `scripts/macos-sign.sh` reads from environment variables:

| Secret | What it is |
|---|---|
| `MACOS_CERTIFICATE_P12` | base64 of the Developer ID Application certificate (`.p12`) |
| `MACOS_CERTIFICATE_PASSWORD` | the password of the `.p12` |
| `MACOS_SIGNING_IDENTITY` | for example `Developer ID Application: Your Name (TEAMID)` |
| `NOTARY_KEY_P8` | base64 of the App Store Connect API key |
| `NOTARY_KEY_ID` | the API key id |
| `NOTARY_ISSUER_ID` | the API issuer id |

The script has these steps:

```sh
macos-sign.sh status              # which steps are enabled
macos-sign.sh import-certificate  # temporary keychain with the certificate
macos-sign.sh sign <path>         # Developer ID (hardened runtime), or ad-hoc
macos-sign.sh notarize <path>     # notarytool submit --wait
macos-sign.sh staple <path>       # stapler staple
```

Without the secrets the steps fall back to ad-hoc signing or are skipped, so the same workflow works for everyone. `FORGE_DRY_RUN=1` prints the commands with secrets masked.

## Releases

A release has, for the tag `v<version>` (the tag must equal `v` plus the version in `package.json`):

- `<app>-<version>-darwin-arm64.dmg`, the installer;
- `<app>-<version>-darwin-arm64.zip`, the portable app that the auto-updater swaps;
- `latest.json`, written by `forge manifest`, with the version and the URL, SHA-256 and size per platform.

Tags with a hyphen (such as `v0.1.0-rc.1`) are published as pre-releases. The hello world repository has a complete example in its `.github/workflows/release.yml`.

## forge-action

[forge-action](https://github.com/camaleaun/forge-action) packages those steps as GitHub Actions (macOS runners only for now):

```yaml
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: camaleaun/forge-action@v1
        with:
          project-dir: .
          forge-ref: trunk

  publish:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: camaleaun/forge-action/publish@v1
```

Pass the signing secrets as the optional inputs (`macos-certificate-p12`, `macos-certificate-password`, `macos-signing-identity`, `notary-key-p8`, `notary-key-id`, `notary-issuer-id`) to sign and notarize. Check the forge-action README for the current tags and inputs.
