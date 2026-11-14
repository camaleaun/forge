export type MessageText = {
  kind: 'message';
  text: string;
  context?: string;
  plural?: string;
  count?: number;
  args?: (string | number)[];
};
export type TextValue = { kind: 'literal'; value: string } | MessageText;
// Navigation between the <step>s of a window: next, back or a named step; quit closes the app.
export type GoTarget = 'next' | 'back' | { step: string };
export type Effect = { op: 'set'; state: string; value: TextValue } | { op: 'go'; to: GoTarget } | { op: 'quit' };

export type Loc = [line: number, column: number];
export type Style = Record<string, string | number | number[]>;
// A window-size query of @media: every field that is set must hold (px).
export type MediaQuery = { minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number };
// The style a node gets while its @media query matches (only what changes), in cascade order: a later one wins.
export type Variant = { query: MediaQuery; style: Style };
export type Binding = TextValue | { kind: 'state'; state: string };

export type Node = {
  kind: 'window' | 'view' | 'steps' | 'step' | 'text' | 'button' | 'select' | 'progress';
  id: string;
  classes: string[];
  title?: TextValue;
  content?: Binding;
  on?: { click?: string };
  // A <select language> dropdown: its options are English plus the available language packs (known at build/runtime).
  select?: { language: true };
  // A <progress> bar: value 0..max (max defaults to 1), or indeterminate, or bound to a source.
  // `source: 'language-download'` shows the language pack download and is hidden when none is running.
  progress?: { value?: number; max?: number; indeterminate?: true; source?: 'language-download' };
  // A <step>: the window size of that screen on native targets (px); a missing side keeps the root CSS size.
  step?: { width?: number; height?: number };
  // A <button waitsForDownload>: disabled while a language pack download is in flight.
  disabledDuringDownload?: true;
  style: Style;
  // Set only when @media rules match this node: the base style stays in `style`.
  variants?: Variant[];
  children: Node[];
  loc: Loc;
};

export type Ir = {
  irVersion: 2;
  app: { name: string; version: string; icon?: string };
  root: Node;
  states: { id: string; initial: TextValue }[];
  // Every distinct translatable text of the app (sorted by context, then text); the IR carries no translations.
  messages: { context?: string; text: string; plural?: string }[];
  handlers: { id: string; effects: Effect[] }[];
  commands: { flag: string; description: TextValue; handler: string }[];
};
