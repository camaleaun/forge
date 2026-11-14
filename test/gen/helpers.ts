import { readFileSync } from 'node:fs';
import type { Ir, Node } from '../../src/ir/types.ts';
import type { I18nGenOptions } from '../../src/gen/i18n-options.ts';

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

export const GOLDEN_I18N_DIR = new URL('../golden/ir-hello-i18n/', import.meta.url).pathname;
export const goldenI18n = (name: string): string => GOLDEN_I18N_DIR + name;

const message = (text: string, extra: Record<string, unknown> = {}) => ({ kind: 'message' as const, text, ...extra });

// The hello IR with translatable texts: window title, state, button, handler effects, a command, and a language dropdown.
export function helloI18nIr(): Ir {
  const ir = helloIr();
  ir.root.title = message('Hello, forge');
  ir.root.children[1].content = message('Greet');
  ir.root.children.push(node('select', 'select_3', { select: { language: true }, style: { width: 160 }, loc: [10, 7] }));
  ir.root.children.push(node('progress', 'progress_4', { progress: { source: 'language-download' }, style: { width: 160 }, loc: [11, 7] }));
  ir.states[0].initial = message('Press the button');
  ir.handlers[0].effects[0].value = message('Hello, world!');
  ir.handlers.push({ id: 'files', effects: [{ op: 'set', state: 's0', value: message('%d file', { plural: '%d files', count: 3, args: ['3'] }) }] });
  ir.commands[0].description = message('Print the greeting');
  ir.commands.push({ flag: '--files', description: { kind: 'literal', value: 'Show a count' }, handler: 'files' });
  ir.messages = [
    { text: '%d file', plural: '%d files' },
    { text: 'Greet' },
    { text: 'Hello, forge' },
    { text: 'Hello, world!' },
    { text: 'Press the button' },
    { text: 'Print the greeting' },
  ];
  return ir;
}

export function helloI18nOptions(extra: Partial<I18nGenOptions> = {}): I18nGenOptions {
  return {
    appId: 'dev.forge.hello',
    packs: [{ tag: 'pt-BR', file: 'hello-0.1.0-pt-BR.lang', sha256: '0123456789abcdef'.repeat(4), size: 321 }],
    baseUrl: 'https://github.com/camaleaun/forge-hello-world/releases/download/v0.1.0/',
    download: true,
    menu: true,
    ...extra,
  };
}

// Every kind of node with @media variants on every property a variant may set (for syntax and text checks).
export function variantsIr(base: Ir = helloIr()): Ir {
  const ir = base;
  ir.root.style = { ...ir.root.style, alignItems: 'stretch' };
  ir.root.variants = [
    { query: { maxWidth: 500 }, style: { gap: 4, padding: [1, 2, 3, 4], background: '#102030ff', borderRadius: 6, flexDirection: 'row' } },
    { query: { minWidth: 400, maxHeight: 300 }, style: { gap: 2 } },
  ];
  const [text, button] = ir.root.children;
  text.variants = [{ query: { maxWidth: 500 }, style: { color: '#ff0000ff', fontSize: 11, fontWeight: 700, textAlign: 'center', width: 90, height: 18, flex: 1 } }];
  button.variants = [{ query: { minWidth: 450 }, style: { fontSize: 18, width: 'auto', flex: 1 } }];
  ir.root.children.push(
    node('view', 'inner', {
      style: { flexDirection: 'row', justifyContent: 'space-between', gap: 3, background: '#ffffff80' },
      variants: [{ query: { maxWidth: 480 }, style: { padding: [2, 2, 2, 2], gap: 1, borderRadius: 2, flexDirection: 'column' } }],
      children: [
        node('text', 'x', { content: { kind: 'literal', value: 'X' }, variants: [{ query: { minHeight: 100 }, style: { fontWeight: 400, color: '#00ff00ff' } }] }),
        node('progress', 'bar', { progress: { value: 0.5 }, style: { width: 50 }, variants: [{ query: { maxWidth: 480 }, style: { width: 80, height: 6, color: '#00aa00ff' } }] }),
      ],
    }),
    node('view', 'centered', {
      style: { justifyContent: 'center', alignItems: 'center' },
      variants: [{ query: { maxWidth: 480 }, style: { flexDirection: 'row', gap: 9 } }],
      children: [node('text', 'y', { content: { kind: 'literal', value: 'Y' } })],
    }),
  );
  return ir;
}

export function variantsI18nIr(): Ir {
  return variantsIr(helloI18nIr());
}
