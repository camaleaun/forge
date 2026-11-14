import { TARGET_NAMES } from '../ir/targets.ts';
import type { Ir } from '../ir/types.ts';
import { buildProjectIr } from './build.ts';

type Message = Ir['messages'][number];

// Every translatable phrase of the app over ALL targets (phrases inside <only macos> or <only linux> count for every build),
// so the language catalog, the missing/orphan checks and the pack are the same whichever target is built.
// `known` is the IR already built for one target; the others are built here. A target that does not build adds nothing
// (its errors are reported when that target itself is built).
export async function unionMessages(dir: string, known: { target: string; ir: Ir }): Promise<Message[]> {
  const seen = new Map<string, Message>();
  const add = (messages: Message[]) => {
    for (const m of messages) {
      const key = `${m.context ?? ''}\0${m.text}`;
      if (!seen.has(key)) seen.set(key, m);
    }
  };
  add(known.ir.messages);
  for (const target of TARGET_NAMES) {
    if (target === known.target) continue;
    const built = await buildProjectIr(dir, target);
    if (built.ir) add(built.ir.messages);
  }
  return [...seen.values()];
}
