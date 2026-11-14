import type { Spec } from '../spec/types.ts';

export type Effect = { op: 'setText'; target: string; text: string };
export type Ui = { setText(labelId: string, text: string): void };
export type Action = (ui: Ui) => void;

class TraceError extends Error {}

function isThenable(value: unknown): boolean {
  return typeof (value as { then?: unknown } | undefined)?.then === 'function';
}

export function traceAction(name: string, action: Action, spec: Spec): Effect[] {
  const fail = (reason: string) => new TraceError(`action "${name}": ${reason}`);
  const effects: Effect[] = [];
  const ui: Ui = {
    setText(target, text) {
      const widget = spec.widgets.find((w) => w.id === target);
      if (!widget) throw fail(`setText target "${target}" does not exist`);
      if (widget.type !== 'label') throw fail(`setText target "${target}" is not a label`);
      effects.push({ op: 'setText', target, text });
    },
  };

  let result: unknown;
  try {
    result = action(ui);
  } catch (error) {
    if (error instanceof TraceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new TraceError(`action "${name}": ${message}`, { cause: error });
  }
  if (isThenable(result)) throw fail('actions must be synchronous in v1');
  return effects;
}
