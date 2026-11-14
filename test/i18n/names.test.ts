import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { languageName } from '../../src/i18n/names.ts';

describe('given a language tag', () => {
  it('when it is en then the name is English', () => assert.equal(languageName('en'), 'English'));
  it('when it is pt-BR then the name is Português (Brasil)', () => assert.equal(languageName('pt-BR'), 'Português (Brasil)'));
  it('when it is written pt_br then it is normalized first', () => assert.equal(languageName('pt_br'), 'Português (Brasil)'));
  it('when it is one of the future languages then it has an endonym', () => {
    const want: Record<string, string> = {
      es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano', ja: '日本語', 'zh-CN': '简体中文', ru: 'Русский',
    };
    for (const [tag, name] of Object.entries(want)) assert.equal(languageName(tag), name);
  });
  it('when it is unknown then the tag itself is returned', () => {
    assert.equal(languageName('xx-YY'), 'xx-YY');
    assert.equal(languageName('__proto__'), '__proto__');
    assert.equal(languageName('constructor'), 'constructor');
  });
});
