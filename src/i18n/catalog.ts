// Catalog of the translator's i18n/<tag>.lang files, validated for `forge build`.
//
//   loadCatalog(files, { appPhrases }?) -> { locales, errors, warnings }
//
// files:      [{ name, text }] where name is the path used in messages
//             ("i18n/pt-BR.lang") and text is the decoded UTF-8 content.
// appPhrases: optional [{ text, context?, plural? }], every translatable phrase
//             of the app (plural = the English plural text). Without it only
//             what can be checked from the files alone is checked.
// locales:    valid files as { tag, file }, sorted by tag.
// errors:     must fail the build. File names (pt_BR.lang and pt-br.lang both
//             mean pt-BR; en*.lang is refused; template.lang is ignored),
//             syntax errors ("file:line: message"), header/file-name tag
//             mismatch, wrong plural column counts, placeholder mismatches.
// warnings:   missing translations (`i18n/pt-BR.lang: missing "Greet"`) and
//             orphans; `--strict-i18n` turns them into errors in the caller.
//
// Placeholders are %s, %d and %N$s / %N$d (%% is a literal percent). A singular
// message must use exactly the English placeholders (order may change only with
// positional ones). A plural form may omit placeholders (e.g. "Um arquivo") but
// never add or change them. A file with errors contributes no locale.
import { LangError, parseLang } from './lang.ts';
import type { LangEntry, LangFile } from './lang.ts';
import { normalizeTag } from './locale.ts';
import { pluralFormsFor } from './plural.ts';

export type AppPhrase = { text: string; context?: string; plural?: string };
export type Catalog = { locales: { tag: string; file: LangFile }[]; errors: string[]; warnings: string[] };

const key = (context: string | undefined, text: string): string => `${context ?? ''}\0${text}`;

function placeholders(text: string): { raw: string[]; keys: string[] } {
  const raw: string[] = [];
  const keys: string[] = [];
  let next = 1;
  for (const m of text.replace(/%%/g, '').matchAll(/%(?:(\d+)\$)?([sd])/g)) {
    raw.push(m[0]);
    keys.push(`${m[1] ?? next++}:${m[2]}`);
  }
  return { raw, keys: keys.sort() };
}

function isSubMultiset(sub: string[], whole: string[]): boolean {
  const rest = [...whole];
  for (const k of sub) {
    const i = rest.indexOf(k);
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return true;
}

function checkEntry(name: string, tag: string, nplurals: number, e: LangEntry, phrase: AppPhrase | undefined, errors: string[]): void {
  const at = `${name}:${e.line}`;
  const plural = phrase ? phrase.plural !== undefined : e.forms.length > 1;
  if (phrase) {
    if (phrase.plural !== undefined && e.forms.length !== nplurals) {
      errors.push(`${at}: "${e.text}" needs ${nplurals} plural forms for ${tag} but has ${e.forms.length}`);
      return;
    }
    if (phrase.plural === undefined && e.forms.length !== 1) {
      errors.push(`${at}: "${e.text}" is not plural but has ${e.forms.length} columns`);
      return;
    }
  } else if (e.forms.length !== 1 && e.forms.length !== nplurals) {
    errors.push(`${at}: "${e.text}" has ${e.forms.length} columns but ${tag} has ${nplurals} plural forms`);
    return;
  }
  const en = placeholders(phrase?.plural ?? e.text);
  for (const form of e.forms) {
    if (form === '') continue;
    const tr = placeholders(form);
    const ok = plural ? isSubMultiset(tr.keys, en.keys) : tr.keys.join() === en.keys.join();
    if (!ok) {
      errors.push(`${at}: "${e.text}" has placeholders "${tr.raw.join(' ')}" in the translation that do not match the English "${en.raw.join(' ')}"`);
      return;
    }
  }
}

export function loadCatalog(files: { name: string; text: string }[], opts?: { appPhrases?: AppPhrase[] }): Catalog {
  const errors: string[] = [];
  const warnings: string[] = [];
  const found = new Map<string, { name: string; file: LangFile }>();
  const phrases = opts?.appPhrases;
  const phraseByKey = new Map<string, AppPhrase>();
  for (const p of phrases ?? []) phraseByKey.set(key(p.context, p.text), p);

  for (const { name, text } of files) {
    const base = name.split('/').pop() ?? name;
    if (base === 'template.lang') continue;
    const stem = base.endsWith('.lang') ? base.slice(0, -'.lang'.length) : '';
    const tag = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{1,8})*$/.test(stem) ? normalizeTag(stem) : undefined;
    if (tag === undefined) {
      errors.push(`${name}: file name must be <language tag>.lang (for example pt-BR.lang)`);
      continue;
    }
    if (tag.split('-')[0] === 'en') {
      errors.push(`${name}: English is the built-in default language; remove this file`);
      continue;
    }
    const dup = found.get(tag);
    if (dup) {
      errors.push(`${name}: duplicate of ${dup.name} (both are ${tag})`);
      continue;
    }
    let file: LangFile;
    try {
      file = parseLang(text, name);
    } catch (e) {
      if (!(e instanceof LangError)) throw e;
      errors.push(...e.errors);
      continue;
    }
    const before = errors.length;
    if (file.tag !== undefined && file.tag !== tag) {
      errors.push(`${name}: the header says "${file.tag}" but the file name says "${tag}"`);
    }
    const nplurals = pluralFormsFor(tag).nplurals;
    if (file.pluralForms && file.pluralForms.nplurals !== nplurals) {
      errors.push(`${name}: plural-forms says nplurals=${file.pluralForms.nplurals} but ${tag} has ${nplurals}`);
    }
    for (const e of file.entries) checkEntry(name, tag, nplurals, e, phraseByKey.get(key(e.context, e.text)), errors);

    if (errors.length > before) continue;
    found.set(tag, { name, file });
    if (phrases) {
      const translated = new Set(file.entries.filter((e) => e.forms.some((f) => f !== '')).map((e) => key(e.context, e.text)));
      for (const p of phrases) {
        if (!translated.has(key(p.context, p.text))) {
          warnings.push(`${name}: missing "${p.text}"${p.context !== undefined ? ` (context "${p.context}")` : ''}`);
        }
      }
      for (const e of file.entries) {
        if (!phraseByKey.has(key(e.context, e.text))) {
          warnings.push(`${name}:${e.line}: orphan "${e.text}" (the app no longer uses it)`);
        }
      }
    }
  }
  const locales = [...found.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([tag, { file }]) => ({ tag, file }));
  return { locales, errors, warnings };
}
