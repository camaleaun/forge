import { readFileSync } from 'node:fs';
import type { Ir, Node } from '../../src/ir/types.ts';

export const GOLDEN_DIR = new URL('../golden/ir-hello/', import.meta.url).pathname;
export const golden = (name: string): string => GOLDEN_DIR + name;
export const ROOT = new URL('../../', import.meta.url).pathname;
export const serializers = [(value: unknown) => value as string];

// A fresh copy on every call: tests mutate it.
export function helloIr(): Ir {
  return JSON.parse(readFileSync(new URL('../fixtures/hello.ir.json', import.meta.url), 'utf8')) as Ir;
}

export function node(kind: Node['kind'], id: string, extra: Partial<Node> = {}): Node {
  return { kind, id, classes: [], style: {}, children: [], loc: [1, 1], ...extra };
}
