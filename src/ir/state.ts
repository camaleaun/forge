import type { Effect } from './types.ts';

let states: State[] = [];
let recorder: Effect[] | null = null;
let tracingHandler = '';

class TraceError extends Error {}

export class State {
  id: string;
  initial: string;

  constructor(id: string, initial: string) {
    this.id = id;
    this.initial = initial;
  }

  set(value: string): void {
    if (recorder === null) throw new Error('state.set() can only run inside a handler');
    if (typeof value !== 'string') {
      throw new TraceError(`handler "${tracingHandler}": state "${this.id}".set() expects a string`);
    }
    recorder.push({ op: 'set', state: this.id, value: { kind: 'literal', value } });
  }

  toString(): string {
    throw new Error('state values cannot be read in v1; bind the state as a child instead');
  }

  valueOf(): never {
    throw new Error('state values cannot be read in v1; bind the state as a child instead');
  }
}

export function state(initial: string): State {
  const created = new State(`s${states.length}`, initial);
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
