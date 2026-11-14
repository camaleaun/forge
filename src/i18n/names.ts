// Language names in their own language, for the Language menu and the preview select.
import { normalizeTag } from './locale.ts';

const NAMES: Record<string, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  ja: '日本語',
  'zh-CN': '简体中文',
  ru: 'Русский',
};

/** Endonym of a tag; unknown tags come back unchanged. */
export function languageName(tag: string): string {
  const normalized = normalizeTag(tag);
  return normalized !== undefined && Object.hasOwn(NAMES, normalized) ? NAMES[normalized] : tag;
}
