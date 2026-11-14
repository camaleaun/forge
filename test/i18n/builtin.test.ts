import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_PHRASES, builtinEntries, withBuiltinMessages } from '../../src/i18n/builtin.ts';
import type { Ir } from '../../src/ir/types.ts';

const ir = { irVersion: 2, app: { name: 'a', version: '1.0.0' }, messages: [{ text: 'Zebra' }, { text: 'Greet' }] } as unknown as Ir;

describe('given the texts forge prints itself', () => {
  it('when asking for pt-BR, then every builtin phrase has a translation', () => {
    const entries = builtinEntries('pt-BR');
    assert.deepEqual(entries.map((e) => e.text).sort(), [...BUILTIN_PHRASES].sort());
    assert.ok(entries.every((e) => e.forms.length === 1 && e.forms[0] !== ''));
  });

  it('when asking for a language forge has no builtin pack for, then there are no entries', () => {
    assert.deepEqual(builtinEntries('fr'), []);
  });

  it('when adding the builtin phrases to an IR, then they join the app phrases sorted and without duplicates', () => {
    const merged = withBuiltinMessages(withBuiltinMessages(ir));
    assert.deepEqual(merged.messages.map((m) => m.text), ['Greet', 'Print the version', 'Show this help', 'Zebra']);
    assert.equal(ir.messages.length, 2);
  });
});
