import type { Spec } from '../../src/spec/types.ts';

export function hello(): Spec {
  return {
    app: { name: 'hello', version: '0.1.0' },
    window: { title: 'Hello', width: 320, height: 120 },
    tokens: {},
    widgets: [
      { type: 'label', id: 'message', text: 'Hello', x: 20, y: 20, width: 280, height: 24 },
      { type: 'button', id: 'greet', text: 'Greet', x: 20, y: 60, width: 100, height: 28, action: 'greet' },
    ],
    commands: [{ flag: '--greet', action: 'greet', description: 'Print the greeting' }],
  };
}
