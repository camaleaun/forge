import { formatPrintf } from '../i18n/format.ts';
import type { Message } from '../i18n/message.ts';
import type { Binding, Ir, MessageText, Node, TextValue } from './types.ts';

export function toTextValue(value: string | Message): TextValue {
  if (typeof value === 'string') return { kind: 'literal', value };
  const text: MessageText = { kind: 'message', text: value.text };
  if (value.context !== undefined) text.context = value.context;
  if (value.plural !== undefined) text.plural = value.plural;
  if (value.count !== undefined) text.count = value.count;
  if (value.args.length > 0) text.args = [...value.args];
  return text;
}

// The English text: what an app without a language pack shows (and what the generators emit today).
export function textOf(value: TextValue): string {
  if (value.kind === 'literal') return value.value;
  const pattern = value.plural !== undefined && value.count !== 1 ? value.plural : value.text;
  return formatPrintf(pattern, value.args ?? []);
}

function textValuesOf(ir: Ir): TextValue[] {
  const values: TextValue[] = [];
  const visit = (node: Node) => {
    if (node.title) values.push(node.title);
    const content: Binding | undefined = node.content;
    if (content && content.kind !== 'state') values.push(content);
    node.children.forEach(visit);
  };
  visit(ir.root);
  for (const state of ir.states) values.push(state.initial);
  for (const handler of ir.handlers) for (const effect of handler.effects) values.push(effect.value);
  for (const command of ir.commands) values.push(command.description);
  return values;
}

// The same text (and context) must always have the same plural: otherwise one translation cannot serve both.
export function messageConflicts(ir: Ir): string[] {
  const plurals = new Map<string, string | undefined>();
  const errors: string[] = [];
  for (const value of textValuesOf(ir)) {
    if (value.kind !== 'message') continue;
    const key = `${value.context ?? ''}\u0004${value.text}`;
    if (!plurals.has(key)) {
      plurals.set(key, value.plural);
    } else if (plurals.get(key) !== value.plural) {
      const [first, second] = [plurals.get(key), value.plural];
      errors.push(`the text "${value.text}" is used with two different plurals: ${first === undefined ? 'none' : `"${first}"`} and ${second === undefined ? 'none' : `"${second}"`}`);
    }
  }
  return errors;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function collectMessages(ir: Ir): Ir['messages'] {
  const byKey = new Map<string, Ir['messages'][number]>();
  for (const value of textValuesOf(ir)) {
    if (value.kind !== 'message') continue;
    const key = `${value.context ?? ''}\u0004${value.text}`;
    if (byKey.has(key)) continue;
    const entry: Ir['messages'][number] = { text: value.text };
    if (value.context !== undefined) entry.context = value.context;
    if (value.plural !== undefined) entry.plural = value.plural;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => compare(a.context ?? '', b.context ?? '') || compare(a.text, b.text));
}

// A copy of the IR where every text is a literal English string: what the preview embeds for its script.
export function englishIr(ir: Ir): Ir {
  const literal = (value: TextValue): TextValue => ({ kind: 'literal', value: textOf(value) });
  const node = (n: Node): Node => ({
    ...n,
    ...(n.title ? { title: literal(n.title) } : {}),
    ...(n.content && n.content.kind !== 'state' ? { content: literal(n.content) } : {}),
    children: n.children.map(node),
  });
  return {
    ...ir,
    root: node(ir.root),
    states: ir.states.map((s) => ({ id: s.id, initial: literal(s.initial) })),
    handlers: ir.handlers.map((h) => ({ id: h.id, effects: h.effects.map((e) => ({ ...e, value: literal(e.value) })) })),
    commands: ir.commands.map((c) => ({ ...c, description: literal(c.description) })),
  };
}
