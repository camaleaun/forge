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
        node('step', 'first', { step: { width: 420, height: 180 }, style: { gap: 8 }, children: [{ ...button('b1', 'Next', 'next'), primary: true }, { ...button('b2', 'Back', 'back'), cancel: true }] }),
        node('step', 'second', {
          step: { width: 600 },
          style: { gap: 8 },
          children: [{ ...button('b3', 'Back', 'back'), cancel: true }, button('b4', 'Again', 'again'), { ...button('b5', 'Next', 'next'), primary: true }, button('b6', 'Quit', 'quit')],
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

const view = (id: string, style: Node['style'], children: Node[] = []): Node => node('view', id, { style, children });

// One 600x440 screen laid out as "content, divider, footer" with plain views: the content grows, the divider is 1 px
// high with a neutral translucent gray, the footer is a right-aligned row of 85x24 buttons (gap 12, padding 14).
export function footerIr(): Ir {
  const ir = helloIr();
  ir.root.style = { width: 320, height: 200 };
  const sized = { width: 85, height: 24 };
  ir.root.children = [
    node('steps', 'steps_1', {
      children: [
        node('step', 'only', {
          step: { width: 600, height: 440 },
          children: [
            view('content', { flex: 1 }, [node('text', 'label', { content: { kind: 'literal', value: 'Hello' } })]),
            view('divider', { height: 1, background: '#80808066' }),
            view('footer', { flexDirection: 'row', justifyContent: 'end', gap: 12, padding: [14, 14, 14, 14] }, [
              node('button', 'b1', { content: { kind: 'literal', value: 'Back' }, style: sized, on: { click: 'back' } }),
              node('button', 'b2', { content: { kind: 'literal', value: 'Close' }, style: sized, on: { click: 'quit' } }),
            ]),
          ],
        }),
      ],
    }),
  ];
  ir.states = [];
  ir.handlers = [{ id: 'back', effects: [{ op: 'go', to: 'back' }] }, { id: 'quit', effects: [{ op: 'quit' }] }];
  ir.commands = [];
  return ir;
}
