# forge

Generates tiny native apps from a single source: `app.json` (tokens, window, widgets, CLI commands) and `index.ts` (behavior).
v1 target: macOS + CLI, Label and Button only. Linux, Windows and Web come later.

Status: work in progress. The spec validator, the action tracer and the string escaping are done; the generator is next.

## Project rules
- No npm packages in the tooling or in the generated programs. `package.json` only sets `"type": "module"` and the test script.
- Node 24 runs the `.ts` files directly, with no build step and no type checking. Tests use the built-in runner: `npm test` (`node --test`).
- TDD/BDD: every behavior starts as a Given/When/Then test that is seen failing before any code is written.

## License
MIT
