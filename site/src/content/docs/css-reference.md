---
title: CSS reference
description: "The exact CSS subset forge supports: selectors, properties, values and units, and the file:line:column errors for everything else."
order: 3
---

# CSS reference

`App.css` is parsed by a small CSS-subset parser. Anything outside the subset is an error, never silently ignored.

## Selectors

- Element selectors: `window`, `view`, `text`, `button`, `select`, `progress`.
- Class selectors: `.message`.
- Id selectors: `#title`.
- Comma-separated lists: `text, button`.

Specificity is `#id` over `.class` over element; for equal specificity the later rule wins. Not supported: combinators (descendant, child, sibling), pseudo-classes, attribute selectors, at-rules other than `@only` and `@except` below (`@media` comes next; `@import`... are errors), `!important`, and CSS variables.

## Units and values

- Lengths are **`px` only** (a bare `0` is allowed). No `em`, `rem`, `%`, `calc()`.
- Colors: `#rgb`, `#rrggbb`, `#rrggbbaa` or `transparent`. No named colors, `rgb()` or `hsl()`.

## Properties

| Property | Values | Applies to |
|---|---|---|
| `flex-direction` | `row`, `column` | window, view |
| `gap` | px | window, view |
| `padding` | 1 to 4 px values (CSS order: top right bottom left) | window, view |
| `align-items` | `start`, `center`, `end`, `stretch` | window, view |
| `justify-content` | `start`, `center`, `end`, `space-between` | window, view |
| `width` | px or `auto` | window, view, text, button, select, progress |
| `height` | px or `auto` | window, view, text, button, select, progress |
| `flex` | a number (grow factor) | window, view, text, button, select, progress |
| `background` | color | window, view |
| `border-radius` | px | window, view |
| `color` | color | text, progress |
| `font-size` | px | text, button |
| `font-weight` | `normal`, `bold`, `400`, `700` | text, button |
| `text-align` | `left`, `center`, `right` | text |

A property used on an element that does not support it is an error too. On the Mac, the window's `width` and `height` are its initial size; the window is resizable, and its minimum size is the size you set in CSS. Text color is not forced by default, so text follows the system appearance (light and dark).

## Targets: `@only` and `@except`

Rules can be limited to targets with `@only <targets> { ... }` and `@except <targets> { ... }`. They are resolved at build time, so a rule for another target is not in the app at all. Target names are the same as in TSX (`macos`, `linux`, `windows`, `web`, `android`, `ios`); `forge start` is `web`.

```css
button { width: 100px; }
@only macos linux { window { padding: 20px; } }
@except web { text { font-size: 15px; } }
```

Blocks cannot be nested inside each other. No targets or an unknown target is an error with `App.css:line:column`.

## Example

```css
window   { width: 320px; height: 120px; padding: 20px; gap: 12px; align-items: start; }
.message { font-size: 15px; }
button   { width: 100px; }
```

## Errors

Every error is `file:line:column: message`:

```text
App.css:3:12: invalid value "12em" for "gap": expected px
App.css:5:1: unsupported selector "window button": combinators are not supported in v1
App.css:7:3: unknown property "margin" (supported: flex-direction, gap, padding, ...)
App.css:9:3: "color" is not supported on <view> in v1
```
