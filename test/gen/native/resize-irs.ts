// IRs for the native resize tests (macOS and Linux): the same layouts must come out of both.
import type { Ir } from '../../../src/ir/types.ts';
import { helloIr, node } from '../helpers.ts';

// A window that grows from a column (gap 8, padding 10) to a row (gap 20, padding 30) at 400 px wide,
// where the second text also gets wider.
export function resizeIr(): Ir {
  const ir = helloIr();
  ir.root.style = { width: 320, height: 200, gap: 8, padding: [10, 10, 10, 10], alignItems: 'start' };
  ir.root.variants = [{ query: { minWidth: 400 }, style: { gap: 20, padding: [30, 30, 30, 30], flexDirection: 'row' } }];
  ir.root.children = [
    node('text', 't0', { content: { kind: 'literal', value: 'AAAA' }, style: { width: 60, height: 20 } }),
    node('text', 't1', { content: { kind: 'literal', value: 'BBBB' }, style: { width: 60, height: 20 }, variants: [{ query: { minWidth: 400 }, style: { width: 120 } }] }),
  ];
  return ir;
}

// A stretched column that becomes a row at 400 px: the first child gets a fixed width, the second one grows.
export function stretchIr(): Ir {
  const ir = helloIr();
  ir.root.style = { width: 320, height: 200, gap: 8, padding: [10, 10, 10, 10], alignItems: 'stretch' };
  ir.root.variants = [{ query: { minWidth: 400 }, style: { flexDirection: 'row', padding: [20, 20, 20, 20] } }];
  ir.root.children = [
    node('text', 'a', { content: { kind: 'literal', value: 'A' }, style: { height: 20 }, variants: [{ query: { minWidth: 400 }, style: { width: 80 } }] }),
    node('text', 'b', { content: { kind: 'literal', value: 'B' }, style: { height: 20 }, variants: [{ query: { minWidth: 400 }, style: { flex: 1 } }] }),
  ];
  return ir;
}
