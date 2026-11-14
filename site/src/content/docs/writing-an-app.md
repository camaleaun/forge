---
title: Writing an app
description: "The four files of a forge app, the window, view, text and button elements, and how state() and handlers work (they run once at build time)."
order: 2
---

# Writing an app

An app is a folder with four files:

| File | Purpose |
|---|---|
| `package.json` | `name` and `version` only. |
| `App.tsx` | The markup and the behavior. |
| `App.css` | The look (a small CSS subset). |
| `icon.svg` | Optional. The app icon; `forge build` turns it into `AppIcon.icns`. |
| `icon/` | Optional. Liquid Glass icon layers (`background.svg`, `foreground-1.svg`, ...); see [Packaging and releases](../packaging-and-releases/). |

```json
{ "name": "hello", "version": "0.1.0" }
```

- `name` must match `^[a-z][a-z0-9-]*$` (it becomes the app and CMake target name).
- `version` must be semver (`x.y.z`, optionally with a pre-release such as `0.1.0-rc.1`).

## App.tsx

`App.tsx` imports `state` from `forge`, imports its stylesheet, and default-exports a component that returns a single `<window>`:

```tsx
import { state } from 'forge';
import './App.css';

const message = state('Press the button');

function greet() {
  message.set('Hello, world!');
}

export const commands = {
  '--greet': { description: 'Print the greeting', run: greet },
};

export default function App() {
  return (
    <window title="Hello, forge">
      <text class="message">{message}</text>
      <button onClick={greet}>Greet</button>
    </window>
  );
}
```

The TSX is transformed by a small dependency-free JSX transformer, so there is no React and no bundler. Plain function components and fragments are expanded at build time.

## Elements

| Element | What it is |
|---|---|
| `<window>` | The root. `App()` must return exactly one, and it can only be the root. Takes `title`. |
| `<view>` | A container (flex layout) for other elements. |
| `<steps>` / `<step>` | Several screens in one window, see [Screens (steps)](#screens-steps). `<steps>` is the only content of the `<window>`; each `<step id="...">` holds one screen. |
| `<text>` | A label. Its content is literal text **or** a single state, not a mix. |
| `<button>` | A button with the same content rule as `<text>`. The only element that accepts `onClick`. The bare attribute `waitsForDownload` disables the button while a language pack download is in flight (like `<progress source="language-download">`, it needs a `languages/` folder). |
| `<progress>` | A progress bar (leaf, no children). `value` (0 to `max`, a number such as `value={0.4}`) with `max` (default `1`), or the bare attribute `indeterminate`, or `source="language-download"`: a bar tied to the language pack download that is only visible while a download runs. `source` needs a `languages/` folder, like `<select language>`. `value` with `indeterminate` is an error. macOS draws an `NSProgressIndicator` and Linux a `GtkProgressBar` (indeterminate bars are animated, or pulsed by a timer on Linux); the preview draws `<progress>`. A `source="language-download"` bar takes no space until a language pack download is in flight, then shows its real progress (bytes received over the pack size) and hides again when the download ends or fails. |
| `<only>` / `<except>` | Target conditionals, resolved at build time: `<only macos linux>...</only>` keeps its children for those targets, `<except web>...</except>` for every other target. Targets are bare attributes: `macos`, `linux`, `windows`, `web`, `android`, `ios` (the last three are accepted names; nothing is generated for them yet). They work anywhere in the tree, including around `<select language />` and as the child list of `<window>`, but cannot wrap the root `<window>`. Only elements can be inside (no text or state). No targets, an unknown target, or mixing `only` and `except` is an error with `App.tsx:line:column`. `forge start` is the `web` target; a build that names no target is treated as `web`. |

Any element can have `class` and `id`. Ids must match `^[a-z][A-Za-z0-9_]*$`, must be unique, must not be a C++ keyword, and must not start with `forge_`, `s` followed by a digit, or `handler_`.

Translatable phrases (`__('...')`) inside `<only>`/`<except>` count for the language catalog of **every** target: `forge build --target X`, `forge i18n extract`, `forge i18n check` and the `forge start` pack all use the union over all targets. The language pack of one project is therefore byte-identical (same sha256, size and file name) whichever target built it, and a translation is an orphan only when no target uses its phrase. The generated binary keeps the message table of its own target.

## State and handlers

`state(initial)` creates a piece of text state. `<text>{message}</text>` binds the element to it, and `message.set('...')` changes it.

Handlers (`onClick` functions and command `run` functions) are **executed once at build time** and the effects they perform are recorded. The generated program replays those effects; it carries no JavaScript. That has consequences:

- Handlers can only do what forge can record: today, calling `set` on a state with a string value, and the navigation of [steps](#screens-steps) (`next`, `back`, `goTo`, `quit`).
- Reading a state's value is an error, and so are async handlers, exceptions and non-string values.
- A handler cannot depend on runtime data, such as the current time or user input.

## Screens (steps)

A window can hold several screens, like an installer or a dialog flow. Put one `<steps>` directly inside the root `<window>` (it is the only content of the window) and one `<step>` per screen. Buttons move between the screens with `next`, `back`, `goTo('id')` and `quit`, imported from `forge`:

```tsx
import { next, back, quit, goTo } from 'forge';

<window title="Hello, forge">
  <steps>
    <step id="language" width={420} height={180}>
      <select language />
      <progress source="language-download" />
      <button waitsForDownload onClick={next}>OK</button>
      <button onClick={quit}>Cancel</button>
    </step>
    <step id="hello" width={600} height={440}>
      <text>Hello!</text>
      <button onClick={back}>Back</button>
      <button onClick={goTo('language')}>Language</button>
      <button onClick={quit}>Close</button>
    </step>
  </steps>
</window>
```

- The first `<step>` is shown first. Every `<step>` needs a unique `id` and at least one child element; `width` and `height` are optional numbers in px: the window size of that screen on native targets. A step without them keeps the window size from `App.css`.
- Style a screen with the `step` selector in CSS (same layout properties as `view`, except `width` and `height`, which come from the attributes).
- `next` and `back` stop at the last and first screen. `goTo('id')` names a step: an unknown id is a build error at the button. `quit` closes the app (in the preview it returns to the first step and shows a notice).
- A handler can combine them with state: `function confirm() { message.set('Done'); next(); }` runs the effects in order.
- `next`, `back` and `goTo` need a `<steps>` in the window; `quit` does not. They cannot be used in a CLI command.
- The preview shows only the current step and ignores the step sizes (it fills the page). The macOS and Linux generators do not support `<steps>` yet and stop with a clear error.

Errors (with `App.tsx:line:column`): `<steps>` outside the window, a child of `<steps>` that is not a `<step>`, a step without `id`, duplicate ids, a size that is not a positive number, an empty step, and a `<step>` outside `<steps>`.

## Commands (the CLI in the binary)

Each key of the exported `commands` object is a flag of the built binary: `hello --greet` prints the resulting text. Flags must start with `--`. `--version` and `--help` are provided by forge and reserved, as is anything starting with `--forge-`.

## Errors

forge reports every problem with its location, in the form `file:line:column: message`, for example `App.tsx:7:5: unknown element <div> (expected window | view | text | button)`. `forge start` shows them in the page; `forge build` prints them and exits with a non-zero code.

Known limit: JSX inside a `${}` of a top-level template literal is not transformed.
