---
title: Roadmap
description: "What is planned for forge and not built yet: Windows packages, web and mobile, internationalization, Liquid Glass icons and more widgets."
order: 7
---

# Roadmap

> Everything on this page is **planned** (or still being validated), except Linux, which is marked available. forge v1 is macOS plus a CLI in the same binary, and Linux is available as a release candidate (see below).

## Targets

- **Linux:** a GTK 4 app with `.deb`, `.rpm`, `.tar.gz`, snap and AppImage packages, for x86_64 and arm64. <span class="badge">available (release candidate)</span> It builds and tests on real Linux runners; see [Packaging and releases](../packaging-and-releases/#linux). Not on Linux yet: the optional Language menu bar item (the in-window language dropdown works) and the Liquid Glass icon.
- **Windows:** MSI and EXE installers. <span class="badge">planned</span>
- **Web:** a classic web output, with an installable PWA as an option. <span class="badge">planned</span>
- **Mobile:** Android and iOS builds. <span class="badge">planned</span> A native "Forge Preview" shell app that loads a project from your network, in the spirit of Expo Go, is an idea and not designed yet.

## Internationalization

Apps will ship only the default language (English). At launch they detect the operating system language and **download that language pack on demand** from the release, cache it, and fall back (for example `pt-BR`, then `pt`, then `en`). The first packs are English and Português (Brasil). Source code will use gettext-style functions (`__`, `_x`, `_n`, `_nx` and `sprintf`), and apps can include a **language dropdown**. <span class="badge">planned</span>

## Look and widgets

- **More widgets** beyond `window`, `view`, `text` and `button`: list or table, progress bar and input, plus a larger example app. <span class="badge">planned</span>
- **Notarized releases by default**: the steps exist and are optional today; see [Packaging and releases](../packaging-and-releases/).

Priorities can change. The source of truth is the [repository](https://github.com/camaleaun/forge).
