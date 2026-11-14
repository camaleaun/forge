import type { Loc, Rule, Selector, StyleValue } from './parse.ts';
import { PROPERTIES } from './properties.ts';
import type { ElementKind } from './properties.ts';

export type Style = Record<string, StyleValue>;
export type ElementRef = { classes: string[]; id?: string };

export function resolveStyle(
  kind: ElementKind,
  element: ElementRef,
  rules: Rule[],
  file: string,
): { style: Style; errors: string[] } {
  const matched: { rule: Rule; specificity: number }[] = [];
  for (const rule of rules) {
    const specificity = Math.max(-1, ...rule.selectors.map((sel) => specificityIfMatching(sel, kind, element)));
    if (specificity >= 0) matched.push({ rule, specificity });
  }
  matched.sort((a, b) => a.specificity - b.specificity || a.rule.order - b.rule.order);
  const style: Style = {};
  const errors: { loc: Loc; message: string }[] = [];
  for (const { rule } of matched) {
    for (const decl of rule.declarations) {
      if (!PROPERTIES[decl.property].kinds.includes(kind)) {
        const [line, column] = decl.loc;
        errors.push({ loc: decl.loc, message: `${file}:${line}:${column}: "${decl.property}" is not supported on <${kind}> in v1` });
        continue;
      }
      style[camelCase(decl.property)] = decl.value;
    }
  }
  return { style, errors: errors.sort((a, b) => a.loc[0] - b.loc[0] || a.loc[1] - b.loc[1]).map((e) => e.message) };
}

/** Specificity (id 2 > class 1 > type 0) when the selector matches, otherwise -1. */
function specificityIfMatching(sel: Selector, kind: ElementKind, element: ElementRef): number {
  if (sel.kind === 'id') return element.id === sel.name ? 2 : -1;
  if (sel.kind === 'class') return element.classes.includes(sel.name) ? 1 : -1;
  return sel.name === kind ? 0 : -1;
}

function camelCase(property: string): string {
  return property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
