import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIr } from '../../src/ir/build.ts';
import { h } from '../../src/ir/runtime.ts';

const app = { name: 'hello', version: '0.1.0' };

const run = (props: Record<string, unknown>, children: unknown[] = [], translateLiterals = false) =>
  buildIr({ file: 'App.tsx', app, App: () => h('window', { 'forge:loc': [1, 1] }, h('progress', { 'forge:loc': [2, 3], ...props }, ...children)), translateLiterals });

describe('given a <progress> leaf', () => {
  it('when it has value and max, then the IR node carries them as numbers', () => {
    const { ir, errors } = run({ value: 5, max: 10, id: 'bar', class: 'big' });
    assert.deepEqual(errors, []);
    assert.deepEqual(ir!.root.children[0], { kind: 'progress', id: 'bar', classes: ['big'], style: {}, children: [], loc: [2, 3], progress: { value: 5, max: 10 } });
  });

  it('when it has no attributes, then progress is an empty object (max defaults to 1 where it is used)', () => {
    assert.deepEqual(run({}).ir!.root.children[0].progress, {});
  });

  it('when it is indeterminate, then the node says so', () => {
    assert.deepEqual(run({ indeterminate: true }).ir!.root.children[0].progress, { indeterminate: true });
  });

  it('when it has source language-download and the project has languages/, then the source is kept', () => {
    const { ir, errors } = run({ source: 'language-download' }, [], true);
    assert.deepEqual(errors, []);
    assert.deepEqual(ir!.root.children[0].progress, { source: 'language-download' });
  });
});

describe('given a <progress> with mistakes', () => {
  const cases: [string, Record<string, unknown>, unknown[], string][] = [
    ['has children', {}, ['x'], '<progress> cannot have children'],
    ['has a value above max', { value: 2 }, [], '<progress> value must be a finite number from 0 to max (1), got 2'],
    ['has a value above a custom max', { value: 11, max: 10 }, [], '<progress> value must be a finite number from 0 to max (10), got 11'],
    ['has a negative value', { value: -1 }, [], '<progress> value must be a finite number from 0 to max (1), got -1'],
    ['has a NaN value', { value: NaN }, [], '<progress> value must be a finite number from 0 to max (1), got NaN'],
    ['has a string value', { value: '0.5' }, [], '<progress> value must be a number, e.g. value={0.5}'],
    ['has max 0', { max: 0 }, [], '<progress> max must be a finite number greater than 0'],
    ['has a string max', { max: 'a' }, [], '<progress> max must be a finite number greater than 0'],
    ['has indeterminate and value', { indeterminate: true, value: 0.5 }, [], '<progress> cannot be indeterminate and have a value'],
    ['has indeterminate={false}', { indeterminate: false }, [], '<progress> indeterminate is a bare attribute'],
    ['has an unknown source', { source: 'upload' }, [], '<progress> source must be "language-download"'],
  ];
  for (const [name, props, children, message] of cases) {
    it(`when it ${name}, then it reports App.tsx:2:3`, () => {
      assert.deepEqual(run(props, children).errors, [`App.tsx:2:3: ${message}`]);
    });
  }

  it('when source is language-download but the project has no languages/ folder, then it reports it like <select language>', () => {
    assert.deepEqual(run({ source: 'language-download' }).errors, ['App.tsx:2:3: <progress source="language-download"> needs an languages/ folder with at least one language file']);
  });

  it('when <progress> is unknown to older lists, then the element list includes it', () => {
    const { errors } = buildIr({ file: 'App.tsx', app, App: () => h('window', { 'forge:loc': [1, 1] }, h('div', { 'forge:loc': [3, 7] })) });
    assert.deepEqual(errors, ['App.tsx:3:7: unknown element <div> (expected window | view | text | button | select | progress)']);
  });
});
