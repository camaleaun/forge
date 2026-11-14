---
title: Preview on your phone
description: "forge start serves the live preview on this machine only. Add --token to share it on your local network behind a secret token and scan the QR code with q."
order: 5
---

# Preview on your phone

`forge start` is a web server, so your phone can open your app like a web page: no install, with live reload.

## How

1. Put the computer and the phone on the same Wi-Fi network.
2. Run `forge start --token` in the project.
3. In the terminal press `q`. forge prints a QR code and the URL for the phone. Scan it with the camera, or type the URL.

The QR code is not printed on its own, to keep the terminal quiet. Use `--qr` to print it at startup (`--qr` includes `--token`).

## The token

Without `--token`, `forge start` listens on this machine only (`127.0.0.1`) and needs no token: open the printed URL, or press `o`.

With `--token` the preview is also reachable from your local network, and every URL ends with `?t=<token>`. The token is random and **changes every time `forge start --token` runs**. The first visit with the token sets a cookie so the page can reload and fetch updates. Requests without the token or cookie get a `403 Forbidden` that says to open the URL printed by `forge start`. forge also checks the `Host` header of each request. If a phone shows 403, open the URL from the current run (scan the QR code again) because an old cookie belongs to an old token.

## Be aware

`--token` makes the development server reachable by anyone on your network who has the URL with the token. Use it only on networks you trust. The default (no flags) never leaves your machine.

## Not yet

A native "Forge Preview" app for phones (similar to Expo Go) is only an idea; see the [Roadmap](../roadmap/).
