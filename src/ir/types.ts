export type TextValue = { kind: 'literal'; value: string };
export type Effect = { op: 'set'; state: string; value: TextValue };

export type Loc = [line: number, column: number];
export type Style = Record<string, string | number | number[]>;
export type Binding = TextValue | { kind: 'state'; state: string };

export type Node = {
  kind: 'window' | 'view' | 'text' | 'button';
  id: string;
  classes: string[];
  title?: string;
  content?: Binding;
  on?: { click?: string };
  style: Style;
  children: Node[];
  loc: Loc;
};

export type Ir = {
  irVersion: 1;
  app: { name: string; version: string; icon?: string };
  root: Node;
  states: { id: string; initial: string }[];
  handlers: { id: string; effects: Effect[] }[];
  commands: { flag: string; description: string; handler: string }[];
};
