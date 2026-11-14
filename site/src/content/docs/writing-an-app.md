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
| `<text>` | A label. Its content is literal text **or** a single state, not a mix. |
| `<button>` | A button with the same content rule as `<text>`. The only element that accepts `onClick`. |

Any element can have `class` and `id`. Ids must match `^[a-z][A-Za-z0-9_]*$`, must be unique, must not be a C++ keyword, and must not start with `forge_`, `s` followed by a digit, or `handler_`.

## State and handlers

`state(initial)` creates a piece of text state. `<text>{message}</text>` binds the element to it, and `message.set('...')` changes it.

Handlers (`onClick` functions and command `run` functions) are **executed once at build time** and the effects they perform are recorded. The generated program replays those effects; it carries no JavaScript. That has consequences:

- Handlers can only do what forge can record: today, calling `set` on a state with a string value.
- Reading a state's value is an error, and so are async handlers, exceptions and non-string values.
- A handler cannot depend on runtime data, such as the current time or user input.

## Commands (the CLI in the binary)

Each key of the exported `commands` object is a flag of the built binary: `hello --greet` prints the resulting text. Flags must start with `--`. `--version` and `--help` are provided by forge and reserved, as is anything starting with `--forge-`.

## Errors

forge reports every problem with its location, in the form `file:line:column: message`, for example `App.tsx:7:5: unknown element <div> (expected window | view | text | button)`. `forge start` shows them in the page; `forge build` prints them and exits with a non-zero code.

Known limit: JSX inside a `${}` of a top-level template literal is not transformed.
