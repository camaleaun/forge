// Locale tags: normalization and best-pack selection.
// Mirrored in C++ and in the preview JS; all three are tested against
// test/fixtures/i18n/vectors.json.

const MAX_TAG_LENGTH = 35;

/**
 * Turns a POSIX or BCP 47 style locale ("pt_BR.UTF-8", "PT-br", "de_DE@euro")
 * into a canonical tag ("pt-BR"). Returns undefined for "C", "POSIX", empty or
 * malformed input.
 */
export function normalizeTag(raw: string): string | undefined {
  if (raw.length > 200) return undefined;
  const base = raw.trim().split(/[.@]/)[0].replace(/_/g, '-');
  if (base === '' || base === 'C' || base === 'POSIX' || base.length > MAX_TAG_LENGTH) return undefined;
  const parts = base.split('-');
  if (!/^[A-Za-z]{2,3}$/.test(parts[0])) return undefined;
  const out = [parts[0].toLowerCase()];
  for (const part of parts.slice(1)) {
    if (!/^[A-Za-z0-9]{1,8}$/.test(part)) return undefined;
    if (/^[A-Za-z]{4}$/.test(part)) out.push(part[0].toUpperCase() + part.slice(1).toLowerCase());
    else if (/^([A-Za-z]{2}|[0-9]{3})$/.test(part)) out.push(part.toUpperCase());
    else out.push(part.toLowerCase());
  }
  return out.join('-');
}

function language(tag: string): string {
  return tag.split('-')[0];
}

/**
 * Walks the user's languages in order. For each one it tries the exact tag,
 * then the bare language, then any available pack of the same language
 * (pt-PT picks pt-BR). An English preference stops the search with "en", which
 * is built in, so nothing is downloaded. No match gives "en".
 */
export function pickLocale(preferred: string[], available: string[]): string {
  const packs = available.map((tag) => normalizeTag(tag)).filter((t): t is string => t !== undefined);
  for (const raw of preferred) {
    const tag = normalizeTag(raw);
    if (tag === undefined) continue;
    const lang = language(tag);
    if (lang === 'en') return 'en';
    const found =
      packs.find((p) => p === tag) ?? packs.find((p) => p === lang) ?? packs.find((p) => language(p) === lang);
    if (found !== undefined) return found;
  }
  return 'en';
}
