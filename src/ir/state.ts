import { Message } from '../i18n/message.ts';
import { toTextValue } from './text.ts';
import type { Effect, TextValue } from './types.ts';

let states: State[] = [];
let recorder: Effect[] | null = null;
let tracingHandler = '';

class TraceError extends Error {}

export class State {
  id: string;
  initial: TextValue;

  constructor(id: string, initial: TextValue) {
    this.id = id;
    this.initial = initial;
  }

  set(value: string | Message): void {
    if (recorder === null) throw new Error('state.set() can only run inside a handler');
    if (typeof value !== 'string' && !(value instanceof Message)) {
      throw new TraceError(`handler "${tracingHandler}": state "${this.id}".set() expects a string or a message`);
    }
    recorder.push({ op: 'set', state: this.id, value: toTextValue(value) });
  }

  toString(): string {
    throw new Error('state values cannot be read in v1; bind the state as a child instead');
  }

  valueOf(): never {
    throw new Error('state values cannot be read in v1; bind the state as a child instead');
  }
}

function record(effect: Effect): void {
  if (recorder === null) throw new Error('navigation (next, back, goTo, quit) can only run inside a handler');
  recorder.push(effect);
}

// Ready-made handlers for onClick: go to the next or previous <step>, or quit the app.
export function next(): void {
  record({ op: 'go', to: 'next' });
}
export function back(): void {
  record({ op: 'go', to: 'back' });
}
export function quit(): void {
  record({ op: 'quit' });
}

// A handler that goes to the <step> with this id (checked at build time).
export function goTo(id: string): () => void {
  if (typeof id !== 'string' || id === '') throw new Error('goTo() expects a step id, e.g. goTo("hello")');
  return () => record({ op: 'go', to: { step: id } });
}

export function state(initial: string | Message): State {
  const created = new State(`s${states.length}`, toTextValue(initial));
  states.push(created);
  return created;
}

export function resetStates(): void {
  states = [];
}

export function registeredStates(): State[] {
  return [...states];
}

function isThenable(value: unknown): boolean {
  return typeof (value as { then?: unknown } | undefined)?.then === 'function';
}

// Runs a handler once at build time and returns the effects it recorded.
export function traceHandler(name: string, handler: () => unknown): Effect[] {
  const effects: Effect[] = [];
  recorder = effects;
  tracingHandler = name;
  let result: unknown;
  try {
    result = handler();
  } catch (error) {
    if (error instanceof TraceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new TraceError(`handler "${name}": ${message}`, { cause: error });
  } finally {
    recorder = null;
    tracingHandler = '';
  }
  if (isThenable(result)) throw new TraceError(`handler "${name}": handlers must be synchronous in v1`);
  return effects;
}
