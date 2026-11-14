---
title: CLI reference
description: "Every forge command: build, start (with --local, --qr and the o, q and h keys), info and manifest."
order: 4
---

# CLI reference

```text
forge build [--project <dir>] [--target macos] --out <dir>
forge start [--project <dir>] [--port 5170] [--local] [--qr]
forge info  [--project <dir>] --field name|version
forge manifest --dir <dir> --tag <tag> --repo <owner/repo>
```

`--project` defaults to the current directory. A wrong usage prints the usage and exits with code 2.

## forge build

Generates C++/Objective-C++ sources and a `CMakeLists.txt` for the app into `--out`. `--target` is `macos` (the only target today). Errors in `App.tsx`, `App.css` or `package.json` are printed as `file:line:column: message` and the command exits non-zero. If the project has an `icon.svg`, `AppIcon.icns` is generated and bundled; if it has an `icon/` folder of glass layers, `AppIcon.icon/` is written too and compiled by CMake when Xcode 26 is available; the styled DMG assets are generated as well. Then build with CMake:

```sh
forge build --out build/src
cmake -S build/src -B build/out -DCMAKE_BUILD_TYPE=Release
cmake --build build/out
```

## forge start

Starts the live preview server (default port `5170`). The app is rendered as HTML, reloads when you edit the source, and has a panel for the CLI commands.

| Option | Effect |
|---|---|
| `--port <n>` | Port to listen on (0 to 65535). |
| `--local` | Listen on this machine only (127.0.0.1), without a token. |
| `--qr` | Print the QR code for the phone URL at startup. |

By default the preview is reachable on your local network, protected by a secret token in the URL. See [Preview on your phone](../preview-on-your-phone/).

Keys, in an interactive terminal:

| Key | Action |
|---|---|
| `o` | Open the preview in the browser |
| `q` | Show the QR code (and the URL) for your phone |
| `h` (or `?`) | Show help |
| `Ctrl+C` | Quit |

## forge info

Prints one field of `package.json`: `--field name` or `--field version`. Useful in scripts and CI, for example to check that a tag matches the version.

## forge manifest

Writes `latest.json` to stdout for the auto-updater. It reads the `<app>-<version>-<os>-<arch>.zip` files in `--dir` and records the version, and per platform the URL, the SHA-256 and the size. It fails if a zip name does not follow that pattern or its version differs from `--tag`.

```sh
forge manifest --dir dist --tag v0.1.0 --repo owner/repo > latest.json
```

## The built app

The binary you build has its own small CLI: `--version`, `--help` and the flags you declare in `commands` (see [Writing an app](../writing-an-app/)).
