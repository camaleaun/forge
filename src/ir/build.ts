import { APP_NAME_PATTERN, CPP_KEYWORDS, ID_PATTERN, RESERVED_FLAGS, RESERVED_ID_PREFIXES, SEMVER } from './names.ts';
import { Message } from '../i18n/message.ts';
import { Fragment } from './runtime.ts';
import type { VNode } from './runtime.ts';
import { DEFAULT_TARGET, TARGET_LIST, isTarget } from './targets.ts';
import type { Target } from './targets.ts';
import { State, registeredStates, traceHandler } from './state.ts';
import { collectMessages, messageConflicts, toTextValue } from './text.ts';
import type { Effect, Ir, Loc, Node, TextValue } from './types.ts';

export type CommandDef = { description: string | Message; run: () => void };
export type BuildInput = {
  file: string;
  app: { name: string; version: string };
  App: () => unknown;
  commands?: Record<string, CommandDef>;
  // Set when the project has an languages/ folder: literal JSX text and the window title become translatable messages.
  translateLiterals?: boolean;
  // Which target the IR is for; <only>/<except> are resolved against it. Defaults to the preview target (web).
  target?: string;
};

type Handler = () => void;

const KINDS = ['window', 'view', 'steps', 'step', 'text', 'button', 'select', 'progress'];

function isVNode(value: unknown): value is VNode {
  return typeof value === 'object' && value !== null && 'type' in value;
}

export function buildIr(input: BuildInput): { ir?: Ir; errors: string[] } {
  const { file } = input;
  const errors: string[] = [];
  const at = (loc: Loc, message: string) => errors.push(`${file}:${loc[0]}:${loc[1]}: ${message}`);
  const handlerIds = new Map<Handler, string>();
  const handlers: { id: string; effects: Effect[] }[] = [];
  const seenIds = new Set<string>();
  let preorder = 0;
  const target = input.target ?? DEFAULT_TARGET;
  if (!isTarget(target)) {
    return { errors: [`unknown target "${target}" (expected ${TARGET_LIST})`] };
  }

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

  const progressOf = (props: Record<string, unknown>, hasChildren: boolean, loc: Loc): Node['progress'] | undefined => {
    const before = errors.length;
    const progress: NonNullable<Node['progress']> = {};
    if (hasChildren) at(loc, '<progress> cannot have children');
    let max = 1;
    if (props.max !== undefined) {
      if (typeof props.max === 'number' && Number.isFinite(props.max) && props.max > 0) {
        max = props.max;
        progress.max = max;
      } else at(loc, '<progress> max must be a finite number greater than 0');
    }
    if (props.value !== undefined) {
      if (typeof props.value !== 'number') at(loc, '<progress> value must be a number, e.g. value={0.5}');
      else if (!Number.isFinite(props.value) || props.value < 0 || props.value > max) {
        at(loc, `<progress> value must be a finite number from 0 to max (${max}), got ${props.value}`);
      } else progress.value = props.value;
    }
    if (props.indeterminate !== undefined) {
      if (props.indeterminate !== true) at(loc, '<progress> indeterminate is a bare attribute');
      else if (props.value !== undefined) at(loc, '<progress> cannot be indeterminate and have a value');
      else progress.indeterminate = true;
    }
    if (props.source !== undefined) {
      if (props.source !== 'language-download') at(loc, '<progress> source must be "language-download"');
      else if (!input.translateLiterals) at(loc, '<progress source="language-download"> needs an languages/ folder with at least one language file');
      else progress.source = 'language-download';
    }
    return errors.length === before ? progress : undefined;
  };

  // Expands components, fragments and <only>/<except> into a flat list of intrinsic elements, strings and states.
  const expand = (child: unknown, top = false): unknown[] => {
    if (Array.isArray(child)) return child.flatMap((c) => expand(c, top));
    if (!isVNode(child)) return [child];
    if (child.type === Fragment) return child.children.flatMap((c) => expand(c, top));
    if (typeof child.type === 'function') {
      return expand((child.type as (props: unknown) => unknown)({ ...child.props, children: child.children }), top);
    }
    if (child.type === 'only' || child.type === 'except') return expandConditional(child, top);
    return [{ ...child, children: child.children.flatMap((c) => expand(c)) }];
  };

  const expandConditional = (vnode: VNode, top: boolean): unknown[] => {
    const tag = String(vnode.type);
    const props = vnode.props ?? {};
    const loc = (props['forge:loc'] as Loc | undefined) ?? [0, 0];
    if (top) {
      at(loc, `<${tag}> cannot wrap the root <window>`);
      return [];
    }
    const names = Object.keys(props).filter((key) => key !== 'forge:loc' && key !== 'children');
    const children = vnode.children.flatMap((c) => expand(c));
    let valid = true;
    if (names.length === 0) {
      at(loc, `<${tag}> needs at least one target (${TARGET_LIST})`);
      valid = false;
    }
    if (names.includes('only') || names.includes('except')) {
      at(loc, `<${tag}> cannot mix only and except: nest one tag in the other`);
      valid = false;
    } else {
      for (const name of names) {
        if (!isTarget(name)) {
          at(loc, `unknown target "${name}" in <${tag}> (expected ${TARGET_LIST})`);
          valid = false;
        } else if (props[name] !== true) {
          at(loc, `<${tag}> targets are bare attributes, e.g. <${tag} ${name}>`);
          valid = false;
        }
      }
    }
    if (children.some((c) => !isVNode(c))) {
      at(loc, `<${tag}> can only contain elements, not text or state`);
      valid = false;
    }
    if (!valid) return [];
    const listed = names.includes(target as Target);
    return (tag === 'only' ? listed : !listed) ? children : [];
  };

  const toNode = (vnode: VNode, isRoot: boolean, parent?: Node['kind']): Node => {
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
    if (kind === 'steps' && parent !== 'window') at(loc, '<steps> must be a direct child of the root <window>');
    if (kind === 'step') {
      if (parent !== 'steps') at(loc, '<step> must be a direct child of <steps>');
      if (typeof props.id !== 'string') at(loc, '<step> needs an id, e.g. <step id="welcome">');
      const size: NonNullable<Node['step']> = {};
      for (const side of ['width', 'height'] as const) {
        const value = props[side];
        if (value === undefined) continue;
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) size[side] = value;
        else at(loc, `<step> ${side} must be a number greater than 0, e.g. ${side}={${side === 'width' ? 420 : 180}}`);
      }
      node.step = size;
      if (!vnode.children.some(isVNode)) at(loc, '<step> needs at least one child element');
    }
    if (props.waitsForDownload !== undefined) {
      if (kind !== 'button') at(loc, 'waitsForDownload is only supported on <button>');
      else if (props.waitsForDownload !== true) at(loc, 'waitsForDownload is a bare attribute');
      else if (!input.translateLiterals) at(loc, '<button waitsForDownload> needs an languages/ folder with at least one language file');
      else node.disabledDuringDownload = true;
    }
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
      else if (!input.translateLiterals) at(loc, '<select language> needs an languages/ folder with at least one language file');
      else node.select = { language: true };
    } else if (kind === 'progress') {
      node.progress = progressOf(props, vnode.children.length > 0, loc);
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
      if (kind === 'steps') {
        if (vnode.children.length === 0) at(loc, '<steps> needs at least one <step>');
        else if (vnode.children.some((child) => !isVNode(child) || child.type !== 'step')) {
          const stray = vnode.children.find((child) => isVNode(child) && child.type !== 'step');
          at((stray && ((stray as VNode).props?.['forge:loc'] as Loc | undefined)) || loc, '<steps> can only contain <step> elements');
        }
      }
      node.children = vnode.children.filter(isVNode).map((child) => toNode(child, false, kind));
      if (kind === 'window' && node.children.some((child) => child.kind === 'steps')) {
        const stepsNodes = node.children.filter((child) => child.kind === 'steps');
        if (stepsNodes.length > 1) at(stepsNodes[1].loc, 'a <window> can have only one <steps>');
        const other = node.children.find((child) => child.kind !== 'steps');
        if (other) at(other.loc, 'a <window> with <steps> cannot have other content: put it inside the <step>s');
      }
    }
    return node;
  };

  const roots = expand(input.App(), true).filter(isVNode);
  if (roots.length !== 1) {
    if (errors.length === 0 || roots.length > 1) errors.push(`${file}: App() must return a single <window> element`);
    return { errors };
  }
  const root = toNode(roots[0], true);
  if (root.kind !== 'window') at(root.loc, 'the root element must be <window>');

  const commandNavigates = (id: string) => handlers.find((handler) => handler.id === id)?.effects.some((effect) => effect.op === 'go');
  const commands: Ir['commands'] = [];
  for (const [flag, command] of Object.entries(input.commands ?? {})) {
    if (!flag.startsWith('--')) errors.push(`${file}: command "${flag}" must start with "--"`);
    else if (RESERVED_FLAGS.includes(flag) || flag.startsWith('--forge-')) errors.push(`${file}: command "${flag}" is reserved`);
    else {
      const handler = handlerFor(command.run);
      if (commandNavigates(handler)) errors.push(`${file}: command "${flag}" cannot navigate between steps`);
      commands.push({ flag, description: toTextValue(command.description), handler });
    }
  }

  const stepIds = new Set<string>();
  const collectSteps = (node: Node) => {
    if (node.kind === 'step') stepIds.add(node.id);
    node.children.forEach(collectSteps);
  };
  collectSteps(root);
  const hasSteps = root.children.some((child) => child.kind === 'steps');
  const checkNavigation = (node: Node) => {
    const effects = node.on?.click ? (handlers.find((handler) => handler.id === node.on!.click)?.effects ?? []) : [];
    for (const effect of effects) {
      if (effect.op !== 'go') continue;
      if (!hasSteps) at(node.loc, 'navigation (next, back, goTo) needs a <steps> in the <window>');
      else if (typeof effect.to === 'object' && !stepIds.has(effect.to.step)) at(node.loc, `goTo("${effect.to.step}"): there is no <step id="${effect.to.step}">`);
    }
    node.children.forEach(checkNavigation);
  };
  checkNavigation(root);

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
