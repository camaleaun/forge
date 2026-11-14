import { basename } from 'node:path';
import { parseCss } from '../css/parse.ts';
import type { Rule } from '../css/parse.ts';
import { resolveStyle } from '../css/resolve.ts';
import type { Ir, Node } from '../ir/types.ts';

// Parses every CSS source (in import order) into one rule list; later files win ties.
export function parseStyles(sources: { file: string; source: string }[]): { rules: Rule[]; errors: string[] } {
  const rules: Rule[] = [];
  const errors: string[] = [];
  for (const { file, source } of sources) {
    const parsed = parseCss(source, basename(file));
    errors.push(...parsed.errors);
    for (const rule of parsed.rules) rules.push({ ...rule, order: rules.length });
  }
  return { rules, errors };
}

// Fills node.style on the whole tree. Returns the style errors.
export function applyStyles(ir: Ir, rules: Rule[], file: string): string[] {
  const errors: string[] = [];
  const visit = (node: Node) => {
    const { style, errors: nodeErrors } = resolveStyle(node.kind, { classes: node.classes, id: node.id }, rules, file);
    node.style = style;
    errors.push(...nodeErrors);
    node.children.forEach(visit);
  };
  visit(ir.root);
  return errors;
}
