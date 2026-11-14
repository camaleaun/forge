export type Widget =
  | { type: 'label'; id: string; text: string; x: number; y: number; width: number; height: number }
  | { type: 'button'; id: string; text: string; x: number; y: number; width: number; height: number; action: string };

export type Command = { flag: string; action: string; description: string };

export type Spec = {
  app: { name: string; version: string };
  window: { title: string; width: number; height: number };
  tokens: Record<string, unknown>;
  widgets: Widget[];
  commands: Command[];
};
