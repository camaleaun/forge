import { formatPrintf, placeholderCount } from './format.ts';

export type MessageArg = string | number;

const RESOLVED_AT_RUNTIME =
  'messages are resolved at runtime: pass the message itself as a child, title, state value, set() value or command description';

// A translatable text. Like State, it is opaque: its final text depends on the language chosen at runtime.
export class Message {
  readonly text: string;
  readonly context: string | undefined;
  readonly plural: string | undefined;
  readonly count: number | undefined;
  readonly args: MessageArg[];

  constructor(parts: { text: string; context?: string; plural?: string; count?: number; args?: MessageArg[] }) {
    this.text = parts.text;
    this.context = parts.context;
    this.plural = parts.plural;
    this.count = parts.count;
    this.args = parts.args ?? [];
  }

  toString(): string {
    throw new Error(RESOLVED_AT_RUNTIME);
  }

  valueOf(): never {
    throw new Error(RESOLVED_AT_RUNTIME);
  }
}

function checkText(fn: string, what: string, value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${fn}(): the ${what} must be a non-empty string`);
  return value;
}

function checkCount(fn: string, count: unknown): number {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new Error(`${fn}(): the count must be a non-negative integer`);
  }
  return count;
}

export function __(text: string): Message {
  return new Message({ text: checkText('__', 'text', text) });
}

export function _x(text: string, context: string): Message {
  return new Message({ text: checkText('_x', 'text', text), context: checkText('_x', 'context', context) });
}

export function _n(single: string, plural: string, count: number): Message {
  return new Message({
    text: checkText('_n', 'singular text', single),
    plural: checkText('_n', 'plural text', plural),
    count: checkCount('_n', count),
  });
}

export function _nx(single: string, plural: string, count: number, context: string): Message {
  return new Message({
    text: checkText('_nx', 'singular text', single),
    plural: checkText('_nx', 'plural text', plural),
    count: checkCount('_nx', count),
    context: checkText('_nx', 'context', context),
  });
}

function plural(count: number, word: string): string {
  return count === 1 ? `${count} ${word}` : `${count} ${word}s`;
}

// Like PHP's sprintf: with a plain string it formats now; with a Message it returns a new Message that carries
// the arguments, so the translated text is filled in at runtime.
export function sprintf(message: string, ...args: MessageArg[]): string;
export function sprintf(message: Message, ...args: MessageArg[]): Message;
export function sprintf(message: Message | string, ...args: MessageArg[]): Message | string {
  if (!args.every((arg) => typeof arg === 'string' || typeof arg === 'number')) {
    throw new Error('sprintf(): arguments must be strings or numbers');
  }
  const text = typeof message === 'string' ? message : message.text;
  const needed = placeholderCount(text);
  if (args.length !== needed) {
    throw new Error(`sprintf(): "${text}" needs ${plural(needed, 'argument')} but ${args.length === 1 ? '1 was' : `${args.length} were`} given`);
  }
  if (typeof message === 'string') return formatPrintf(message, args);
  return new Message({ text: message.text, context: message.context, plural: message.plural, count: message.count, args });
}
