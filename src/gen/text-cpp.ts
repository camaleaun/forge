import type { Ir, TextValue } from '../ir/types.ts';
import { cppString } from './escape.ts';

// The C++ expression of a text in i18n mode: a literal stays a literal, a message points into MESSAGES[].
export function textExpr(ir: Ir, value: TextValue): string {
  if (value.kind === 'literal') return `Text(${cppString(value.value)})`;
  const index = ir.messages.findIndex((m) => m.text === value.text && (m.context ?? '') === (value.context ?? ''));
  if (index < 0) throw new Error(`the message "${value.text}" is missing from the IR message table`);
  const args = (value.args ?? []).map((arg) => cppString(String(arg)));
  if (args.length > 0) return `Text::msg(${index}, ${value.count ?? 0}, {${args.join(', ')}})`;
  if (value.count !== undefined) return `Text::msg(${index}, ${value.count})`;
  return `Text::msg(${index})`;
}
