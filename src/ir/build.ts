import { APP_NAME_PATTERN, CPP_KEYWORDS, ID_PATTERN, RESERVED_FLAGS, RESERVED_ID_PREFIXES, SEMVER } from './names.ts';
import { Message } from '../i18n/message.ts';
import { Fragment } from './runtime.ts';
import type { VNode } from './runtime.ts';
import { State, registeredStates, traceHandler } from './state.ts';
import { collectMessages, messageConflicts, toTextValue } from './text.ts';
import type { Effect, Ir, Loc, Node, TextValue } from './types.ts';

export type CommandDef = { description: string | Message; run: () => void };
export type BuildInput = {
  file: string;
  app: { name: string; version: string };
  App: () => unknown;
  commands?: Record<string, CommandDef>;
  // Set when the project has an i18n/ folder: literal JSX text and the window title become translatable messages.
  translateLiterals?: boolean;
};

type Handler = () => void;

const KINDS = ['window', 'view', 'text', 'button', 'select'];

function isVNode(value: unknown): value is VNode {
  return typeof value === 'object' && value !== null && 'type' in value;
}

// Expands components and fragments into a flat list of intrinsic elements, strings and states.
function expand(child: unknown): unknown[] {
  if (Array.isArray(child)) return child.flatMap(expand);
  if (isVNode(child)) {
    if (child.type === Fragment) return child.children.flatMap(expand);
    if (typeof child.type === 'function') {
      return expand((child.type as (props: unknown) => unknown)({ ...child.props, children: child.children }));
    }
    return [{ ...child, children: child.children.flatMap(expand) }];
  }
  return [child];
}

export function buildIr(input: BuildInput): { ir?: Ir; errors: string[] } {
  const { file } = input;
  const errors: string[] = [];
  const at = (loc: Loc, message: string) => errors.push(`${file}:${loc[0]}:${loc[1]}: ${message}`);
  const handlerIds = new Map<Handler, string>();
  const handlers: { id: string; effects: Effect[] }[] = [];
  const seenIds = new Set<string>();
  let preorder = 0;

  if (!SEMVER.test(input.app.version)) errors.push(`package.json: version "${input.app.version}" must be semver x.y.z`);
  if (!APP_NAME_PATTERN.test(input.app.name)) errors.push(`package.json: name "${input.app.name}" must match ${APP_NAME_PATTERN}`);

  const literalOrMessage = (value: string): TextValue =>
    input.translateLiterals && value !== '' ? { kind: 'message', text: value } : { kind: 'literal', value };

  const handlerFor = (fn: Handler): string => {
    const known = handlerIds.get(fn);
    if (known) return known;
    const id = fn.name || `handler_${handlers.length}`;
    handlerIds.set(fn, id);
    try {
      handlers.push({ id, effects: traceHandler(id, fn) });
    } catch (error) {
      errors.push((error as Error).message);
    }
    return id;
  };

  const checkId = (id: string, loc: Loc) => {
    if (!ID_PATTERN.test(id) || CPP_KEYWORDS.has(id)) {
      at(loc, `invalid id "${id}" (must match ${ID_PATTERN} and not be a C++ keyword)`);
    } else if (RESERVED_ID_PREFIXES.some((prefix) => prefix.test(id))) {
      at(loc, `id "${id}" uses a name that forge reserves`);
    }
    if (seenIds.has(id)) at(loc, `duplicate id "${id}"`);
    seenIds.add(id);
  };

  const toNode = (vnode: VNode, isRoot: boolean): Node => {
    const kind = vnode.type as Node['kind'];
    const props = vnode.props ?? {};
    const loc = (props['forge:loc'] as Loc | undefined) ?? [0, 0];
    const index = preorder++;
    const node: Node = {
      kind,
      id: typeof props.id === 'string' ? props.id : `${kind}_${index}`,
      classes: typeof props.class === 'string' ? props.class.split(/\s+/).filter(Boolean) : [],
      style: {},
      children: [],
      loc,
    };
    if (!KINDS.includes(String(kind))) {
      at(loc, `unknown element <${String(kind)}> (expected ${KINDS.join(' | ')})`);
      return node;
    }
    if (kind === 'window' && !isRoot) at(loc, '<window> can only be the root element');
    if (typeof props.id === 'string') checkId(props.id, loc);
    if (typeof props.title === 'string') node.title = literalOrMessage(props.title);
    else if (props.title instanceof Message) node.title = toTextValue(props.title);
    if (props.onClick !== undefined) {
      if (kind !== 'button') at(loc, 'onClick is only supported on <button>');
      else if (typeof props.onClick === 'function') node.on = { click: handlerFor(props.onClick as Handler) };
      else at(loc, 'onClick must be a function');
    }
    if (kind === 'select') {
      if (props.language !== true) at(loc, '<select> is only supported with the language attribute in v1');
      else if (vnode.children.length > 0) at(loc, '<select language> cannot have children: the options are the available languages');
      else if (!input.translateLiterals) at(loc, '<select language> needs an i18n/ folder with at least one language file');
      else node.select = { language: true };
    } else if (kind === 'text' || kind === 'button') {
      const states = vnode.children.filter((child): child is State => child instanceof State);
      const messages = vnode.children.filter((child): child is Message => child instanceof Message);
      if (states.length > 0 && states.length < vnode.children.length) {
        at(loc, `<${kind}> cannot mix text and state in v1`);
      } else if (states.length > 0) {
        node.content = { kind: 'state', state: states[0].id };
      } else if (messages.length > 0) {
        if (messages.length === 1 && vnode.children.length === 1) node.content = toTextValue(messages[0]);
        else at(loc, `<${kind}> cannot mix a message with other content in v1`);
      } else {
        node.content = literalOrMessage(vnode.children.map(String).join(''));
      }
    } else {
      node.children = vnode.children.filter(isVNode).map((child) => toNode(child, false));
    }
    return node;
  };

  const roots = expand(input.App()).filter(isVNode);
  if (roots.length !== 1) {
    errors.push(`${file}: App() must return a single <window> element`);
    return { errors };
  }
  const root = toNode(roots[0], true);
  if (root.kind !== 'window') at(root.loc, 'the root element must be <window>');

  const commands: Ir['commands'] = [];
  for (const [flag, command] of Object.entries(input.commands ?? {})) {
    if (!flag.startsWith('--')) errors.push(`${file}: command "${flag}" must start with "--"`);
    else if (RESERVED_FLAGS.includes(flag) || flag.startsWith('--forge-')) errors.push(`${file}: command "${flag}" is reserved`);
    else commands.push({ flag, description: toTextValue(command.description), handler: handlerFor(command.run) });
  }

  const ir: Ir = {
    irVersion: 2,
    app: input.app,
    root,
    states: registeredStates().map((s) => ({ id: s.id, initial: s.initial })),
    messages: [],
    handlers,
    commands,
  };
  ir.messages = collectMessages(ir);
  errors.push(...messageConflicts(ir).map((message) => `${file}: ${message}`));

  if (errors.length > 0) return { errors };
  return { ir, errors };
}
