import { basename } from 'node:path';
import { parseCss } from '../css/parse.ts';
import type { Rule } from '../css/parse.ts';
import { resolveStyle } from '../css/resolve.ts';
import { DEFAULT_TARGET } from '../ir/targets.ts';
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

// A rule applies when every target condition it sits under holds for `target`.
function appliesTo(rule: Rule, target: string): boolean {
  return (rule.conditions ?? []).every((c) => c.kind !== 'target' || (c.mode === 'only') === (c.targets as string[]).includes(target));
}

// Fills node.style on the whole tree for `target` (default: the web preview). Returns the style errors.
export function applyStyles(ir: Ir, allRules: Rule[], file: string, target: string = DEFAULT_TARGET): string[] {
  const rules = allRules.filter((rule) => appliesTo(rule, target));
  const errors: string[] = [];
  const visit = (node: Node) => {
    const { style, variants, errors: nodeErrors } = resolveStyle(node.kind, { classes: node.classes, id: node.id }, rules, file);
    node.style = style;
    if (variants.length > 0) node.variants = variants;
    else delete node.variants;
    errors.push(...nodeErrors);
    node.children.forEach(visit);
  };
  visit(ir.root);
  return errors;
}
