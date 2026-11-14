import type { Loc, Rule, Selector, StyleValue } from './parse.ts';
import { PROPERTIES } from './properties.ts';
import type { ElementKind } from './properties.ts';
import type { MediaQuery, Variant } from '../ir/types.ts';

export type Style = Record<string, StyleValue>;
export type ElementRef = { classes: string[]; id?: string };

const mediaOf = (rule: Rule): MediaQuery | undefined => {
  const condition = (rule.conditions ?? []).find((c) => c.kind === 'media');
  return condition?.kind === 'media' ? condition.query : undefined;
};

export function resolveStyle(
  kind: ElementKind,
  element: ElementRef,
  rules: Rule[],
  file: string,
): { style: Style; variants: Variant[]; errors: string[] } {
  const matched: { rule: Rule; specificity: number }[] = [];
  for (const rule of rules) {
    const specificity = Math.max(-1, ...rule.selectors.map((sel) => specificityIfMatching(sel, kind, element)));
    if (specificity >= 0) matched.push({ rule, specificity });
  }
  matched.sort((a, b) => a.specificity - b.specificity || a.rule.order - b.rule.order);
  const style: Style = {};
  const errors: { loc: Loc; message: string }[] = [];
  const fail = (loc: Loc, message: string) => errors.push({ loc, message: `${file}:${loc[0]}:${loc[1]}: ${message}` });
  // The last place in the cascade where a rule outside @media sets each property: it beats every @media rule before it.
  const lastBase: Record<string, number> = {};
  matched.forEach(({ rule }, index) => {
    if (mediaOf(rule) === undefined) for (const decl of rule.declarations) lastBase[decl.property] = index;
  });
  const variants: Variant[] = [];
  matched.forEach(({ rule }, index) => {
    const query = mediaOf(rule);
    const variantStyle: Style = {};
    for (const decl of rule.declarations) {
      if (!PROPERTIES[decl.property].kinds.includes(kind)) {
        fail(decl.loc, `"${decl.property}" is not supported on <${kind}> in v1`);
        continue;
      }
      if (query === undefined) {
        style[camelCase(decl.property)] = decl.value;
      } else if (kind === 'window' && (decl.property === 'width' || decl.property === 'height')) {
        fail(decl.loc, `"${decl.property}" on <window> cannot change with @media: the window size is what @media measures`);
      } else if ((lastBase[decl.property] ?? -1) < index) {
        variantStyle[camelCase(decl.property)] = decl.value;
      }
    }
    if (query === undefined || Object.keys(variantStyle).length === 0) return;
    const last = variants.at(-1);
    if (last && JSON.stringify(last.query) === JSON.stringify(query)) Object.assign(last.style, variantStyle);
    else variants.push({ query, style: variantStyle });
  });
  return { style, variants, errors: errors.sort((a, b) => a.loc[0] - b.loc[0] || a.loc[1] - b.loc[1]).map((e) => e.message) };
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
