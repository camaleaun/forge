// The texts forge itself prints (the generated --help). Their translations ship with forge as
// src/i18n/builtin/<tag>.lang, so every app's language pack has them without the author writing them.
// A language without a builtin file simply shows these in English.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Ir } from '../ir/types.ts';
import { decodeUtf8, parseLang } from './lang.ts';
import type { LangEntry } from './lang.ts';
import { normalizeTag } from './locale.ts';

export const BUILTIN_PHRASES = ['Print the version', 'Show this help'];

const DIR = fileURLToPath(new URL('./builtin/', import.meta.url));

export function builtinEntries(tag: string): LangEntry[] {
  const normalized = normalizeTag(tag);
  if (!normalized || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(normalized)) return [];
  const path = `${DIR}${normalized}.lang`;
  if (!existsSync(path)) return [];
  return parseLang(decodeUtf8(readFileSync(path), path), path).entries.filter((e) => BUILTIN_PHRASES.includes(e.text));
}

const byBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

// The IR with the builtin phrases added to its message table (same order the generators rely on).
export function withBuiltinMessages(ir: Ir): Ir {
  const have = new Set(ir.messages.filter((m) => (m.context ?? '') === '').map((m) => m.text));
  const added = BUILTIN_PHRASES.filter((text) => !have.has(text)).map((text) => ({ text }));
  const messages = [...ir.messages, ...added].sort((a, b) => byBytes(a.context ?? '', b.context ?? '') || byBytes(a.text, b.text));
  return { ...ir, messages };
}
