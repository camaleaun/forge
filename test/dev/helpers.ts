import { readFileSync } from 'node:fs';
import type { Ir } from '../../src/ir/types.ts';

export const helloIr = (): Ir => JSON.parse(readFileSync(new URL('../fixtures/hello.ir.json', import.meta.url), 'utf8'));
