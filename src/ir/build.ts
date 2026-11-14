import { Fragment } from './runtime.ts';
import type { VNode } from './runtime.ts';
import { State, registeredStates, traceHandler } from './state.ts';
import type { Effect, Ir, Loc, Node } from './types.ts';

export type CommandDef = { description: string; run: () => void };
export type BuildInput = {
  file: string;
  app: { name: string; version: string };
  App: () => unknown;
  commands?: Record<string, CommandDef>;
};

type Handler = () => void;

// Expands components and fragments into a flat list of intrinsic elements, strings and states.
function expand(child: unknown): unknown[] {
  if (Array.isArray(child)) return child.flatMap(expand);
  if (typeof child === 'object' && child !== null && 'type' in child) {
    const vnode = child as VNode;
    if (vnode.type === Fragment) return vnode.children.flatMap(expand);
    if (typeof vnode.type === 'function') {
      return expand((vnode.type as (props: unknown) => unknown)({ ...vnode.props, children: vnode.children }));
    }
    return [{ ...vnode, children: vnode.children.flatMap(expand) }];
  }
  return [child];
}

export function buildIr(input: BuildInput): { ir?: Ir; errors: string[] } {
  const errors: string[] = [];
  const handlerIds = new Map<Handler, string>();
  const handlers: { id: string; effects: Effect[] }[] = [];
  let preorder = 0;

  const handlerFor = (fn: Handler): string => {
    const known = handlerIds.get(fn);
    if (known) return known;
    const id = fn.name || `handler_${handlers.length}`;
    handlerIds.set(fn, id);
    handlers.push({ id, effects: traceHandler(id, fn) });
    return id;
  };

  const toNode = (vnode: VNode): Node => {
    const kind = vnode.type as Node['kind'];
    const props = vnode.props ?? {};
    const index = preorder++;
    const node: Node = {
      kind,
      id: typeof props.id === 'string' ? props.id : `${kind}_${index}`,
      classes: typeof props.class === 'string' ? props.class.split(/\s+/).filter(Boolean) : [],
      style: {},
      children: [],
      loc: (props['forge:loc'] as Loc | undefined) ?? [0, 0],
    };
    if (typeof props.title === 'string') node.title = props.title;
    if (typeof props.onClick === 'function') node.on = { click: handlerFor(props.onClick as Handler) };
    if (kind === 'text' || kind === 'button') {
      const states = vnode.children.filter((child): child is State => child instanceof State);
      node.content = states.length > 0
        ? { kind: 'state', state: states[0].id }
        : { kind: 'literal', value: vnode.children.map(String).join('') };
    } else {
      node.children = vnode.children.map((child) => toNode(child as VNode));
    }
    return node;
  };

  const [root] = expand(input.App());
  const rootNode = toNode(root as VNode);
  const commands = Object.entries(input.commands ?? {}).map(([flag, command]) => ({
    flag,
    description: command.description,
    handler: handlerFor(command.run),
  }));
  const ir: Ir = {
    irVersion: 1,
    app: input.app,
    root: rootNode,
    states: registeredStates().map((s) => ({ id: s.id, initial: s.initial })),
    handlers,
    commands,
  };
  return { ir, errors };
}
