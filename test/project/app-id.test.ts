import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appIdFor } from '../../src/project/app-id.ts';

describe('given an app name', () => {
  it('when the target is macos, then the id is local.forge.<name> unchanged', () => {
    assert.equal(appIdFor({ name: 'my-app' }, 'macos'), 'local.forge.my-app');
  });
  it('when the target is linux, then dashes become underscores', () => {
    assert.equal(appIdFor({ name: 'my-app' }, 'linux'), 'local.forge.my_app');
    assert.equal(appIdFor({ name: 'hello' }, 'linux'), 'local.forge.hello');
  });
});

describe('given package.json forge.appId', () => {
  it('when it is a reverse-DNS id, then it wins on linux (dashes become underscores)', () => {
    assert.equal(appIdFor({ name: 'hello', forge: { appId: 'org.example.Hello-App' } }, 'linux'), 'org.example.Hello_App');
  });
  it('when it is not reverse-DNS, then it throws naming the field', () => {
    for (const bad of ['hello', 'a..b', '1org.app', 'org.exa mple', '', 42]) {
      assert.throws(() => appIdFor({ name: 'hello', forge: { appId: bad } }, 'linux'), /forge\.appId/);
    }
  });
  it('when the forge field has no appId, then the default applies', () => {
    assert.equal(appIdFor({ name: 'hello', forge: { i18n: {} } }, 'linux'), 'local.forge.hello');
  });
});
