import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateDmgSetupScript } from '../../src/gen/dmg.ts';
import { golden, helloIr, serializers } from './helpers.ts';

describe('given the hello IR', () => {
  it('when generating the DMG setup script, then it matches golden/ir-hello/dmg-setup.applescript', (t) => {
    t.assert.fileSnapshot(generateDmgSetupScript(helloIr()), golden('dmg-setup.applescript'), { serializers });
  });
});

describe('given another app name', () => {
  it('when generating, then the disk, the app item and nothing else change', () => {
    const ir = helloIr();
    ir.app.name = 'my-notes';
    const script = generateDmgSetupScript(ir);
    assert.ok(script.includes('tell disk "my-notes"'));
    assert.ok(script.includes('set position of item "my-notes.app" of container window to {150, 190}'));
    assert.ok(!script.includes('"hello'));
  });
});
