import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkProjectI18n, extractTemplate, loadProjectI18n } from '../../src/i18n/project.ts';
import { parseLang } from '../../src/i18n/lang.ts';
import type { Ir } from '../../src/ir/types.ts';

const dirs: string[] = [];
function project(files: Record<string, string | Uint8Array> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-i18n-'));
  dirs.push(dir);
  if (Object.keys(files).length > 0) mkdirSync(join(dir, 'languages'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, 'languages', name), content);
  return dir;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const messages: Ir['messages'] = [
  { text: 'Greet' },
  { text: 'Hello, world!' },
  { text: '%d file', plural: '%d files' },
  { text: 'Open', context: 'verb' },
];
const ir = { irVersion: 2, app: { name: 'hello', version: '0.2.0' }, messages } as unknown as Ir;
const PT = 'Greet\tCumprimentar\nHello, world!\tOlá, mundo!\n%d file\t%d arquivo\t%d arquivos\n@context verb\nOpen\tAbrir\n';
const pkg = { name: 'hello', version: '0.2.0', repository: 'github:camaleaun/forge-hello-world' };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('given a project without a languages folder', () => {
  it('when loading, then the result is empty with no warnings and defaults on', () => {
    const r = loadProjectI18n(project(), ir, pkg);
    assert.deepEqual(r, { packs: [], baseUrl: '', options: { download: true, menu: false }, warnings: [], errors: [] });
  });
});

describe('given languages/pt-BR.lang and a GitHub repository', () => {
  it('when loading, then one pack named <app>-<version>-<tag>.lang carries its header, sha256 and size', () => {
    const r = loadProjectI18n(project({ 'pt-BR.lang': PT }), ir, pkg);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.packs.length, 1);
    const [p] = r.packs;
    assert.equal(p.tag, 'pt-BR');
    assert.equal(p.file, 'hello-0.2.0-pt-BR.lang');
    assert.ok(p.text.startsWith('forge-lang 1 pt-BR hello 0.2.0\nplural-forms: nplurals=2; plural=(n > 1);\n'));
    assert.equal(p.sha256, sha(p.text));
    assert.equal(p.size, Buffer.byteLength(p.text));
    assert.equal(parseLang(p.text, 'x').entries.length, 4);
    assert.equal(r.baseUrl, 'https://github.com/camaleaun/forge-hello-world/releases/download/v0.2.0/');
  });

  it('when the translator file is shuffled or uses CRLF, then the pack bytes are the same', () => {
    const shuffled = '@context verb\r\nOpen\tAbrir\r\n@context\r\n%d file\t%d arquivo\t%d arquivos\r\nHello, world!\tOlá, mundo!\r\nGreet\tCumprimentar\r\n';
    const a = loadProjectI18n(project({ 'pt-BR.lang': PT }), ir, pkg);
    const b = loadProjectI18n(project({ 'pt_BR.lang': shuffled }), ir, pkg);
    assert.deepEqual(b.errors, []);
    assert.equal(b.packs[0].text, a.packs[0].text);
  });

  it('when a phrase is missing, then it is a warning and the pack is still made', () => {
    const r = loadProjectI18n(project({ 'pt-BR.lang': 'Greet\tCumprimentar\n' }), ir, pkg);
    assert.equal(r.packs.length, 1);
    assert.ok(r.warnings.some((w) => w.includes('missing "Hello, world!"')));
  });

  it('when a translation has a bad placeholder, then it is an error with file:line and no pack', () => {
    const r = loadProjectI18n(project({ 'pt-BR.lang': 'Greet\tOi %s\n' }), ir, pkg);
    assert.equal(r.packs.length, 0);
    assert.match(r.errors[0], /^languages\/pt-BR\.lang:1: /);
  });

  it('when en.lang exists, then it is an error', () => {
    const r = loadProjectI18n(project({ 'en.lang': 'Greet\tHi\n' }), ir, pkg);
    assert.match(r.errors[0], /languages\/en\.lang/);
  });

  it('when template.lang and other files are present, then they are ignored', () => {
    const r = loadProjectI18n(project({ 'pt-BR.lang': PT, 'template.lang': 'Greet\t\n', 'README.md': '# hi' }), ir, pkg);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.packs.map((p) => p.tag), ['pt-BR']);
  });
});

describe('given the repository field in its several shapes', () => {
  const base = (repository: unknown) => loadProjectI18n(project({ 'pt-BR.lang': PT }), ir, { ...pkg, repository }).baseUrl;
  const url = 'https://github.com/o/r/releases/download/v0.2.0/';
  it('when it is a string, url or object, then the base URL points at the tag of the version', () => {
    assert.equal(base('github:o/r'), url);
    assert.equal(base('o/r'), url);
    assert.equal(base('https://github.com/o/r'), url);
    assert.equal(base('https://github.com/o/r.git'), url);
    assert.equal(base('git+https://github.com/o/r.git'), url);
    assert.equal(base({ type: 'git', url: 'git+https://github.com/o/r.git' }), url);
  });

  it('when there is no repository and there are packs, then it warns and the base URL is empty', () => {
    const r = loadProjectI18n(project({ 'pt-BR.lang': PT }), ir, { name: 'hello', version: '0.2.0' });
    assert.equal(r.baseUrl, '');
    assert.deepEqual(r.warnings, ['package.json: no "repository": language packs cannot be downloaded (they will only be used from the cache)']);
  });

  it('when the repository is not a recognizable GitHub one, then it warns the same way', () => {
    const r = loadProjectI18n(project({ 'pt-BR.lang': PT }), ir, { ...pkg, repository: 'https://example.com/x/y' });
    assert.equal(r.baseUrl, '');
    assert.equal(r.warnings.length, 1);
  });

  it('when the repository is hostile (path tricks), then it is not used', () => {
    assert.equal(base('o/../r'), '');
    assert.equal(base('github:o/r/../../x'), '');
    assert.equal(base({ url: 5 }), '');
  });

  it('when downloads are off and there is no repository, then there is no warning', () => {
    const r = loadProjectI18n(project({ 'pt-BR.lang': PT }), ir, { name: 'hello', version: '0.2.0', forge: { i18n: { download: false } } });
    assert.deepEqual(r.warnings, []);
  });
});

describe('given package.json forge.i18n options', () => {
  it('when download is false and menu is true, then the options say so; anything else keeps the defaults (download on, menu off)', () => {
    const on = loadProjectI18n(project(), ir, { ...pkg, forge: { i18n: { download: false, menu: true } } });
    assert.deepEqual(on.options, { download: false, menu: true });
    const odd = loadProjectI18n(project(), ir, { ...pkg, forge: { i18n: { download: 'no', menu: 1 } } });
    assert.deepEqual(odd.options, { download: true, menu: false });
    assert.deepEqual(loadProjectI18n(project(), ir, { ...pkg, forge: 5 }).options, { download: true, menu: false });
  });
});

describe('given hostile i18n folders', () => {
  it('when a lang file is a symlink out of the folder, then it is refused', () => {
    const outside = project();
    writeFileSync(join(outside, 'secret.lang'), 'Greet\tX\n');
    const dir = project({ 'fr.lang': 'Greet\tSalut\n' });
    symlinkSync(join(outside, 'secret.lang'), join(dir, 'languages', 'pt-BR.lang'));
    const r = loadProjectI18n(dir, ir, pkg);
    assert.ok(r.errors.some((e) => e.includes('languages/pt-BR.lang') && e.includes('symbolic link')));
    assert.deepEqual(r.packs.map((p) => p.tag), ['fr']);
  });

  it('when the languages folder itself is a symlink, then it is refused', () => {
    const outside = project({ 'pt-BR.lang': PT });
    const dir = project();
    symlinkSync(join(outside, 'languages'), join(dir, 'languages'));
    const r = loadProjectI18n(dir, ir, pkg);
    assert.ok(r.errors.some((e) => e.includes('languages') && e.includes('symbolic link')));
    assert.equal(r.packs.length, 0);
  });

  it('when a file is not valid UTF-8, then it is an error naming the file', () => {
    const r = loadProjectI18n(project({ 'pt-BR.lang': new Uint8Array([0x47, 0xff, 0x09, 0x41, 0x0a]) }), ir, pkg);
    assert.deepEqual(r.errors, ['languages/pt-BR.lang: invalid UTF-8']);
  });

  it('when a file is over 1 MB, then it is an error and is not parsed', () => {
    const r = loadProjectI18n(project({ 'pt-BR.lang': Buffer.alloc(1024 * 1024 + 1, 0x61) }), ir, pkg);
    assert.match(r.errors[0], /languages\/pt-BR\.lang: file is \d+ bytes, over the 1 MB limit/);
  });

  it('when a directory is called x.lang, then it is ignored', () => {
    const dir = project({ 'pt-BR.lang': PT });
    mkdirSync(join(dir, 'languages', 'fr.lang'));
    const r = loadProjectI18n(dir, ir, pkg);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.packs.map((p) => p.tag), ['pt-BR']);
  });

  it('when there are thousands of lang files, then it stops with one error', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 600; i++) files[`x${i}.lang`] = '';
    const r = loadProjectI18n(project(files), ir, pkg);
    assert.equal(r.packs.length, 0);
    assert.deepEqual(r.errors, ['languages: too many .lang files (600, the limit is 200)']);
  });
});

describe('given the phrases of an app', () => {
  it('when extracting the template, then every phrase is there with empty columns, context and sorted like a pack', () => {
    const text = extractTemplate(ir.messages);
    assert.equal(text, '%d file\t\t\nGreet\t\nHello, world!\t\n@context verb\nOpen\t\n');
    const parsed = parseLang(text, 'template.lang');
    assert.equal(parsed.entries.length, 4);
    assert.equal(parsed.entries[0].forms.length, 2);
  });

  it('when extracting from an app without phrases, then the template is just a comment', () => {
    assert.match(extractTemplate([]), /^#/);
  });
});

describe('given translations that cover part of the app', () => {
  it('when checking, then coverage, missing phrases and orphans are reported per locale', () => {
    const lang = 'Greet\tCumprimentar\nHello, world!\tOlá, mundo!\n%d file\t%d arquivo\t%d arquivos\nGone\tSumiu\n';
    const r = checkProjectI18n(project({ 'pt-BR.lang': lang }), ir);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.locales, [{ tag: 'pt-BR', translated: 3, total: 4, missing: ['Open'], orphans: ['Gone'] }]);
  });

  it('when the folder has errors, then they come back as errors', () => {
    const r = checkProjectI18n(project({ 'pt-BR.lang': 'broken\n' }), ir);
    assert.match(r.errors[0], /languages\/pt-BR\.lang:1/);
  });
});
