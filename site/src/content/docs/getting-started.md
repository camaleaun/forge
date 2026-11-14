---
title: Getting started
description: "Install forge, preview an app in the browser with forge start, and build the macOS app with forge build and cmake."
order: 1
---

# Getting started

forge turns a small web-like project (TSX, CSS, TypeScript) into a native app. v1 targets **macOS** and a command-line interface in the same binary. **Linux** (GTK 4) is available as a release candidate; see [Packaging and releases](../packaging-and-releases/#linux).

## Requirements

- **Node 24, only to run forge.** forge runs its own `.ts` files directly with Node; there is no build step and no npm package to install. The apps you build are native binaries: they do not contain Node and the people who install them do not need it.
- **To build the native app:** macOS, `cmake` and a C++/Objective-C++ toolchain (the Xcode Command Line Tools). On Linux: `cmake`, a C++ compiler, `pkg-config` and `libgtk-4-dev`, and `forge build --target linux`. Node 24 is only needed to run forge itself; the apps you ship need no Node. Previewing with `forge start` works anywhere Node 24 runs.

## Install

Clone the repository and link `bin/forge` into a directory on your `PATH`:

```sh
git clone https://github.com/camaleaun/forge.git
ln -s "$PWD/forge/bin/forge" ~/.local/bin/forge
forge info --help   # prints the usage
```

## Get an app

The smallest app is [forge-hello-world](https://github.com/camaleaun/forge-hello-world):

```sh
git clone https://github.com/camaleaun/forge-hello-world.git
cd forge-hello-world
```

## Preview it

```sh
forge start
```

forge prints a local URL and a network URL. Open it in a browser (press `o`), or on your phone (press `q` for a QR code). See [Preview on your phone](../preview-on-your-phone/). Edit `App.tsx` or `App.css` and reload to see the change.

## Build the native app

```sh
forge build --out build/src                        # generate C++/Objective-C++ + CMake
cmake -S build/src -B build/out && cmake --build build/out
build/out/hello.app/Contents/MacOS/hello --greet   # Hello, world!
open build/out/hello.app                           # the window
```

The hello binary is about 73 KB. Add `-DFORGE_UNIVERSAL=ON` to the configure step for an arm64 + x86_64 build.

## Next

- [Writing an app](../writing-an-app/): the files, the elements, `state()` and handlers.
- [CSS reference](../css-reference/): exactly what the CSS subset supports.
- [Packaging and releases](../packaging-and-releases/): `.dmg`, signing and the release workflow.
