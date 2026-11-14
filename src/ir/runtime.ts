export type Props = Record<string, unknown> | null;
export type VNode = { type: unknown; props: Props; children: unknown[] };

export const Fragment = Symbol('forge.Fragment');

function flatten(children: unknown[]): unknown[] {
  return children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== true);
}

// JSX factory: <text>hi</text> becomes h('text', props, 'hi').
export function h(type: unknown, props: Props, ...children: unknown[]): VNode {
  return { type, props, children: flatten(children) };
}
