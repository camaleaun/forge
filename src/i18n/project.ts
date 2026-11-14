// What `forge build` and `forge i18n` know about a project's translations.
//
//   loadProjectI18n(dir, ir, pkg)  -> packs to publish, base URL, options, warnings, errors
//   extractTemplate(messages)      -> text of languages/template.lang
//   checkProjectI18n(dir, ir)      -> per-locale coverage, missing phrases, orphans, errors
//
// languages/*.lang are read as bytes (strict UTF-8), never through a symbolic link, and
// languages/template.lang is ignored. The result is deterministic: the same files give
// the same pack bytes.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Ir } from '../ir/types.ts';
import { loadCatalog } from './catalog.ts';
import type { Catalog } from './catalog.ts';
import { MAX_LANG_BYTES, decodeUtf8, encodeLang } from './lang.ts';

export type ProjectPack = { tag: string; file: string; text: string; sha256: string; size: number };
export type ProjectI18n = {
  packs: ProjectPack[];
  baseUrl: string;
  options: { download: boolean; menu: boolean };
  warnings: string[];
  errors: string[];
};
export type PackageInfo = { name: string; version: string; repository?: unknown; forge?: unknown };

const MAX_LANG_FILES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// "owner/repo" from the shapes npm accepts, or undefined when it is not a GitHub repository.
function githubRepo(repository: unknown): string | undefined {
  const raw = typeof repository === 'string' ? repository : isRecord(repository) ? repository.url : undefined;
  if (typeof raw !== 'string') return undefined;
  const name = '[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_])?';
  const patterns = [
    new RegExp(`^(?:github:)?(${name}/${name})$`),
    new RegExp(`^(?:git\\+)?https://github\\.com/(${name}/${name}?)(?:\\.git)?/?$`),
    new RegExp(`^git@github\\.com:(${name}/${name}?)(?:\\.git)?$`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (match && match[1].split('/').every((part) => part !== '..' && part !== '.')) return match[1];
  }
  return undefined;
}

function readLangFiles(projectDir: string): { files: { name: string; text: string }[]; errors: string[] } {
  const dir = join(resolve(projectDir), 'languages');
  const files: { name: string; text: string }[] = [];
  const errors: string[] = [];
  let stat;
  try {
    stat = lstatSync(dir);
  } catch {
    return { files, errors };
  }
  if (stat.isSymbolicLink()) return { files, errors: ['languages: a symbolic link is not allowed, use a real folder'] };
  if (!stat.isDirectory()) return { files, errors: ['languages: must be a folder'] };
  const names = readdirSync(dir).filter((n) => n.endsWith('.lang')).sort();
  if (names.length > MAX_LANG_FILES) {
    return { files, errors: [`languages: too many .lang files (${names.length}, the limit is ${MAX_LANG_FILES})`] };
  }
  for (const base of names) {
    const name = `languages/${base}`;
    const info = lstatSync(join(dir, base));
    if (info.isSymbolicLink()) {
      errors.push(`${name}: a symbolic link is not allowed, copy the file into languages/`);
      continue;
    }
    if (!info.isFile()) continue;
    if (info.size > MAX_LANG_BYTES) {
      errors.push(`${name}: file is ${info.size} bytes, over the 1 MB limit`);
      continue;
    }
    try {
      files.push({ name, text: decodeUtf8(readFileSync(join(dir, base)), name) });
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  return { files, errors };
}

function catalogOf(projectDir: string, ir: Ir): { catalog: Catalog; errors: string[] } {
  const read = readLangFiles(projectDir);
  const catalog = loadCatalog(read.files, { appPhrases: ir.messages });
  return { catalog, errors: [...read.errors, ...catalog.errors] };
}

export function loadProjectI18n(projectDir: string, ir: Ir, pkg: PackageInfo): ProjectI18n {
  const forge = isRecord(pkg.forge) && isRecord(pkg.forge.i18n) ? pkg.forge.i18n : {};
  const options = { download: forge.download !== false, menu: forge.menu === true };
  const { catalog, errors } = catalogOf(projectDir, ir);
  const warnings = [...catalog.warnings];
  const packs: ProjectPack[] = [];
  for (const { tag, file } of catalog.locales) {
    try {
      const text = encodeLang({ tag, app: pkg.name, version: pkg.version, entries: file.entries });
      const bytes = Buffer.from(text, 'utf8');
      packs.push({ tag, file: `${pkg.name}-${pkg.version}-${tag}.lang`, text, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length });
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  let baseUrl = '';
  if (packs.length > 0) {
    const repo = githubRepo(pkg.repository);
    if (repo) {
      baseUrl = `https://github.com/${repo}/releases/download/v${pkg.version}/`;
    } else if (options.download) {
      warnings.push('package.json: no "repository": language packs cannot be downloaded (they will only be used from the cache)');
    }
  }
  return { packs, baseUrl, options, warnings, errors };
}

function escapeField(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

const byBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

// The template has two plural columns (the default for the languages forge knows); the translator adjusts them for other languages.
export function extractTemplate(messages: Ir['messages']): string {
  if (messages.length === 0) return '# This app has no translatable phrases yet.\n';
  const sorted = [...messages].sort((a, b) => byBytes(a.context ?? '', b.context ?? '') || byBytes(a.text, b.text));
  const out: string[] = [];
  let context = '';
  for (const m of sorted) {
    const c = m.context ?? '';
    if (c !== context) {
      out.push(c === '' ? '@context' : `@context ${escapeField(c)}`);
      context = c;
    }
    out.push(escapeField(m.text) + '\t'.repeat(m.plural !== undefined ? 2 : 1));
  }
  return out.join('\n') + '\n';
}

export type LocaleCoverage = { tag: string; translated: number; total: number; missing: string[]; orphans: string[] };

export function checkProjectI18n(projectDir: string, ir: Ir): { locales: LocaleCoverage[]; errors: string[] } {
  const { catalog, errors } = catalogOf(projectDir, ir);
  const keyOf = (context: string | undefined, text: string) => `${context ?? ''}\0${text}`;
  const phrases = new Set(ir.messages.map((m) => keyOf(m.context, m.text)));
  const locales = catalog.locales.map(({ tag, file }) => {
    const translated = new Set(file.entries.filter((e) => e.forms.some((f) => f !== '')).map((e) => keyOf(e.context, e.text)));
    return {
      tag,
      translated: ir.messages.filter((m) => translated.has(keyOf(m.context, m.text))).length,
      total: ir.messages.length,
      missing: ir.messages.filter((m) => !translated.has(keyOf(m.context, m.text))).map((m) => m.text),
      orphans: file.entries.filter((e) => !phrases.has(keyOf(e.context, e.text))).map((e) => e.text),
    };
  });
  return { locales, errors };
}
