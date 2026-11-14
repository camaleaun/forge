// Helpers for the native tests of generated i18n apps: a pack, a build of the app with a UI stub, a runner.
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { encodeLang } from '../../../src/i18n/lang.ts';
import { generateProject, writeProjectFiles, RUNTIME_DIR, runtimeFilesFor } from '../../../src/gen/index.ts';
import type { I18nGenOptions } from '../../../src/gen/i18n-options.ts';
import type { Ir } from '../../../src/ir/types.ts';
import { helloI18nIr, helloI18nOptions, ROOT } from '../helpers.ts';

const has = (command: string, args: string[]): boolean => spawnSync(command, args).status === 0;
const LINUX_PACKAGES = ['glib-2.0', 'gio-2.0', 'libsoup-3.0'];
export const onLinux = process.platform === 'linux';
const canRunMacos = process.platform === 'darwin' && has('clang++', ['--version']);
const canRunLinux = onLinux && has('g++', ['--version']) && has('pkg-config', ['--exists', ...LINUX_PACKAGES]);
export const canRun = canRunMacos || canRunLinux;
export const skipReason = 'needs macOS with clang++, or Linux with g++ and pkg-config glib-2.0 gio-2.0 libsoup-3.0';

export const PT_PACK = encodeLang({
  tag: 'pt-BR',
  app: 'hello',
  version: '0.1.0',
  entries: [
    { text: 'Hello, world!', forms: ['Olá, mundo!'] },
    { text: 'Greet', forms: ['Cumprimentar'] },
    { text: 'Print the greeting', forms: ['Mostra a saudação'] },
    { text: 'Press the button', forms: ['Aperte o botão'] },
    { text: '%d file', forms: ['%d arquivo', '%d arquivos'] },
    { text: 'Post', forms: ['Postagem'] },
    { context: 'verb', text: 'Post', forms: ['Publicar'] },
  ],
});
export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
export const PT_SHA = sha256(PT_PACK);
export const PT_FILE = 'hello-0.1.0-pt-BR.lang';
export const ptName = (sha = PT_SHA) => `pt-BR-${sha.slice(0, 12)}.lang`;

export const optionsFor = (extra: Partial<I18nGenOptions> = {}): I18nGenOptions =>
  helloI18nOptions({ packs: [{ tag: 'pt-BR', file: PT_FILE, sha256: PT_SHA, size: Buffer.byteLength(PT_PACK) }], ...extra });

// The hello IR plus commands that show plurals and contexts (counts are constants of the build).
export function pluralIr(): Ir {
  const ir = helloI18nIr();
  const files = (n: number) => ({ kind: 'message' as const, text: '%d file', plural: '%d files', count: n, args: [String(n)] });
  for (const n of [0, 1, 3]) {
    ir.handlers.push({ id: `files${n}`, effects: [{ op: 'set', state: 's0', value: files(n) }] });
    ir.commands.push({ flag: `--files${n}`, description: { kind: 'literal', value: `Show ${n}` }, handler: `files${n}` });
  }
  ir.handlers.push({ id: 'post', effects: [{ op: 'set', state: 's0', value: { kind: 'message', text: 'Post' } }] });
  ir.handlers.push({ id: 'postverb', effects: [{ op: 'set', state: 's0', value: { kind: 'message', text: 'Post', context: 'verb' } }] });
  ir.commands.push({ flag: '--post', description: { kind: 'literal', value: 'noun' }, handler: 'post' });
  ir.commands.push({ flag: '--postverb', description: { kind: 'literal', value: 'verb' }, handler: 'postverb' });
  ir.messages = [
    { text: '%d file', plural: '%d files' }, { text: 'Greet' }, { text: 'Hello, forge' }, { text: 'Hello, world!' },
    { text: 'Post' }, { context: 'verb', text: 'Post' }, { text: 'Press the button' }, { text: 'Print the greeting' },
  ];
  return ir;
}

export interface App {
  dir: string;
  binary: string;
  dispose: () => void;
}

const compiler = onLinux ? 'g++' : 'clang++';
const pkgConfig = (mode: string): string[] => spawnSync('pkg-config', [mode, ...LINUX_PACKAGES], { encoding: 'utf8' }).stdout.split(/\s+/).filter(Boolean);

const httpSources = (): [string, string[]][] => [
  [join(RUNTIME_DIR, 'http_common.cpp'), []],
  onLinux ? [join(RUNTIME_DIR, 'http_linux.cpp'), pkgConfig('--cflags')] : [join(RUNTIME_DIR, 'http_macos.mm'), ['-fobjc-arc']],
];

// Generates the project and links it with main.cpp, the i18n runtime and a UI stub (clang++, no cmake).
export function buildApp(ir: Ir, options: I18nGenOptions, uiStub = 'ui_stub.cpp'): App {
  const dir = mkdtempSync(join(tmpdir(), 'forge-i18n-app-'));
  writeProjectFiles(generateProject(ir, 'macos', { i18n: options }), dir);
  const flags = ['-std=c++20', '-Wall', '-Wextra', '-Werror', '-fno-exceptions', '-fno-rtti', '-I', dir, '-I', RUNTIME_DIR];
  const sources: [string, string[]][] = [
    [join(RUNTIME_DIR, 'main.cpp'), []],
    [join(dir, 'actions.cpp'), []],
    [join(dir, 'cli_router.cpp'), []],
    [join(dir, 'messages.cpp'), []],
    [join(RUNTIME_DIR, 'i18n.cpp'), []],
    [join(RUNTIME_DIR, 'i18n_common.cpp'), []],
    onLinux ? [join(RUNTIME_DIR, 'i18n_linux.cpp'), pkgConfig('--cflags')] : [join(RUNTIME_DIR, 'i18n_macos.mm'), ['-fobjc-arc']],
    ...(options.download ? httpSources() : []),
    [join(ROOT, 'test/gen/fixtures', uiStub), onLinux ? pkgConfig('--cflags') : []],
  ];
  const objects: string[] = [];
  for (const [source, extra] of sources) {
    const object = join(dir, `${objects.length}.o`);
    const result = spawnSync(compiler, [...flags, ...extra, '-c', source, '-o', object], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`compiling ${source} failed:\n${result.stderr}`);
    objects.push(object);
  }
  const binary = join(dir, 'hello');
  const link = spawnSync(compiler, [...objects, ...(onLinux ? pkgConfig('--libs') : ['-framework', 'Foundation']), '-o', binary], { encoding: 'utf8' });
  if (link.status !== 0) throw new Error(`linking failed:\n${link.stderr}`);
  return { dir, binary, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

// An environment that does not leak the developer's locale into the test.
const baseEnv = (): Record<string, string> => ({ PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LANG: 'en_US.UTF-8' });

export function run(app: App, args: string[], env: Record<string, string> = {}): Result {
  const result = spawnSync(app.binary, args, { encoding: 'utf8', env: { ...baseEnv(), ...env }, timeout: 20000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Asynchronous, so that a fake server in this process can answer while the binary runs.
export function runAsync(app: App, args: string[], env: Record<string, string> = {}): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn(app.binary, args, { env: { ...baseEnv(), ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'forge-i18n-cache-'));
export const removeDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });
