// IRs for the native steps tests (macOS and Linux): two screens of different sizes with the navigation effects.
import type { Ir, Node } from '../../../src/ir/types.ts';
import { helloIr, node } from '../helpers.ts';

const button = (id: string, title: string, handler: string): Node => node('button', id, { content: { kind: 'literal', value: title }, on: { click: handler } });

// The second screen gives only a width: its height falls back to the root CSS size (200).
export function stepsIr(): Ir {
  const ir = helloIr();
  ir.root.style = { width: 320, height: 200, padding: [10, 10, 10, 10], gap: 8 };
  ir.root.children = [
    node('steps', 'steps_1', {
      children: [
        node('step', 'first', { step: { width: 420, height: 180 }, style: { gap: 8 }, children: [button('b1', 'Next', 'next'), button('b2', 'Back', 'back')] }),
        node('step', 'second', {
          step: { width: 600 },
          style: { gap: 8 },
          children: [button('b3', 'Back', 'back'), button('b4', 'Again', 'again'), button('b5', 'Next', 'next'), button('b6', 'Quit', 'quit')],
        }),
      ],
    }),
  ];
  ir.states = [];
  ir.handlers = [
    { id: 'next', effects: [{ op: 'go', to: 'next' }] },
    { id: 'back', effects: [{ op: 'go', to: 'back' }] },
    { id: 'again', effects: [{ op: 'go', to: { step: 'first' } }] },
    { id: 'quit', effects: [{ op: 'quit' }] },
  ];
  ir.commands = [];
  return ir;
}
