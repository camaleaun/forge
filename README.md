<p align="center"><img src="assets/forge-icon.svg" alt="forge icon" width="128"></p>

# forge

Tiny native apps from a web-like source: TSX for the markup, CSS for the look, TypeScript for the behavior.

```tsx
// App.tsx
import { state } from 'forge';
import './App.css';

const message = state('Press the button');
function greet() { message.set('Hello, world!'); }

export const commands = { '--greet': { description: 'Print the greeting', run: greet } };

export default function App() {
  return (
    <window title="Hello, forge">
      <text class="message">{message}</text>
      <button onClick={greet}>Greet</button>
    </window>
  );
}
```

An app is `package.json` (name, version) + `App.tsx` + `App.css`. v1 targets macOS (plus a CLI in the same binary); Linux (GTK 4, release candidate) is available with `--target linux`;
Windows, web and mobile come later. Elements: `window`, `view`, `text`, `button`, `select language`, `progress` (preview only for now). Per-target code: `<only macos linux>...</only>` and `<except web>...</except>` in TSX, `@only macos { ... }` and `@except web { ... }` in CSS (resolved at build time; `forge start` is the `web` target).

## Commands
```sh
forge build [--project <dir>] [--target macos|linux] --out <dir>   # generate C++/Objective-C++ + CMake
forge start [--project <dir>] [--port 5170] [--local] [--qr] # live preview; reachable from your phone (token; q shows a QR), --local keeps it on this machine
forge info  [--project <dir>] --field name|version
forge manifest --dir <dir> --tag <tag> --repo <owner/repo>  # latest.json for the auto-updater
```
Link `bin/forge` into a directory on your PATH to use `forge` anywhere.

`forge start` serves the preview on your local network (a secret token in the URL is required) and prints the URLs and a QR code,
so you can open it on a phone on the same Wi-Fi. The preview is a normal full-page HTML document (the app root fills the page, the native window size is ignored; the CLI panel is below). In a terminal: `o` opens it in the browser, `q` shows the QR code (it is not printed on its own; `--qr` prints it at startup), `h` shows help, Ctrl+C quits.

## App icon

- `icon.svg` next to `App.tsx`: a classic `AppIcon.icns`, rendered by forge's own SVG rasterizer.
- `icon/` folder (`background.svg` and `foreground-1.svg`, `foreground-2.svg`, ... as flat square layers): a macOS 26 Liquid Glass icon (ignored on Linux, which uses `icon.svg`). `forge build` writes `AppIcon.icon/`; the generated CMake compiles it with Xcode 26's `actool` when it finds one at configure time and otherwise falls back to the classic icon (or none). Details in the Packaging docs. A proposal for the hello world app is in `assets/hello-world-icon/`.

## How it works
`App.tsx` is transformed by a small dependency-free JSX transformer (loaded with Node module hooks), `App.css` by a CSS-subset parser.
Both become one IR (`forge start` renders it as HTML, `forge build` turns it into native code). Handlers run once at build time and
are recorded as effects, so the generated binary carries no JavaScript (hello is about 73 KB).

## Project rules
- No npm packages in the tooling or in the generated programs (only the docs site may use Astro later).
- Node 24 runs the `.ts` files directly, with no build step and no type checking. Tests use the built-in runner: `npm test`.
- TDD/BDD: every behavior starts as a Given/When/Then test that is seen failing before any code is written.

## License
MIT
