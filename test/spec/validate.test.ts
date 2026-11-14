import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../../src/spec/validate.ts';
import { hello } from '../helpers/fixtures.ts';

describe('given a spec with one label and one button whose action exists', () => {
  it('when validated, then it returns no errors', () => {
    assert.deepEqual(validateSpec(hello(), ['greet']), []);
  });
});

describe('given a widget of type "slider"', () => {
  it('when validated, then it reports an unknown widget type', () => {
    const spec = hello();
    (spec.widgets as unknown[]).push({ type: 'slider', id: 'volume', x: 0, y: 0, width: 10, height: 10 });
    assert.deepEqual(validateSpec(spec, ['greet']), [
      'widgets[2].type: unknown widget type "slider" (expected label | button)',
    ]);
  });
});

describe('given two widgets with the same id', () => {
  it('when validated, then it reports the duplicate id', () => {
    const spec = hello();
    spec.widgets.push({ type: 'label', id: 'message', text: 'Again', x: 0, y: 0, width: 10, height: 10 });
    assert.deepEqual(validateSpec(spec, ['greet']), ['widgets[2].id: duplicate id "message"']);
  });
});

describe('given a widget id that is not a valid C++ identifier', () => {
  for (const id of ['my-label', '1st', 'Message', 'class']) {
    it(`when validated with id "${id}", then it reports the id is invalid`, () => {
      const spec = hello();
      spec.widgets[0].id = id;
      assert.deepEqual(validateSpec(spec, ['greet']), [
        `widgets[0].id: invalid id "${id}" (must match /^[a-z][A-Za-z0-9_]*$/ and not be a C++ keyword)`,
      ]);
    });
  }
});

describe('given a button whose action is not exported by actions.ts', () => {
  it('when validated, then it reports the unknown action', () => {
    const spec = hello();
    (spec.widgets[1] as { action: string }).action = 'missing';
    assert.deepEqual(validateSpec(spec, ['greet']), ['widgets[1].action: unknown action "missing"']);
  });
});

describe('given a command flag that forge reserves', () => {
  for (const flag of ['--version', '--help']) {
    it(`when validated with flag "${flag}", then it reports the flag is reserved`, () => {
      const spec = hello();
      spec.commands[0].flag = flag;
      assert.deepEqual(validateSpec(spec, ['greet']), [`commands[0].flag: "${flag}" is reserved`]);
    });
  }
});

describe('given an app version that is not semver x.y.z', () => {
  it('when validated with "1.0", then it reports the version format', () => {
    const spec = hello();
    spec.app.version = '1.0';
    assert.deepEqual(validateSpec(spec, ['greet']), ['app.version: "1.0" must be semver x.y.z']);
  });
});
