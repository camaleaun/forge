// The module an app imports as 'forge'.
export { state } from '../ir/state.ts';
export { next, back, quit, goTo } from '../ir/state.ts';
export type { State } from '../ir/state.ts';
// gettext-style translation functions: the text is the English source, the language comes at runtime.
export { __, _x, _n, _nx, sprintf } from '../i18n/message.ts';
export type { Message } from '../i18n/message.ts';
