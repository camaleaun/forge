export type MessageText = {
  kind: 'message';
  text: string;
  context?: string;
  plural?: string;
  count?: number;
  args?: (string | number)[];
};
export type TextValue = { kind: 'literal'; value: string } | MessageText;
export type Effect = { op: 'set'; state: string; value: TextValue };

export type Loc = [line: number, column: number];
export type Style = Record<string, string | number | number[]>;
export type Binding = TextValue | { kind: 'state'; state: string };

export type Node = {
  kind: 'window' | 'view' | 'text' | 'button' | 'select' | 'progress';
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
  style: Style;
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
