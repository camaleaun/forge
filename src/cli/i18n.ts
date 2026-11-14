import { existsSync, mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkProjectI18n, extractTemplate } from '../i18n/project.ts';
import { buildProjectIr } from '../project/build.ts';
import { unionMessages } from '../project/messages.ts';

export type I18nCommand = { action: 'extract' | 'check'; project: string; strict?: boolean };

// `forge i18n extract` writes languages/template.lang; `forge i18n check` reports coverage. Returns the exit code.
export async function i18n(command: I18nCommand): Promise<number> {
  const dir = resolve(command.project);
  // Phrases are only translatable once languages/ exists, so extract creates it before reading the app.
  const created = command.action === 'extract' && !existsSync(join(dir, 'languages'));
  if (created) mkdirSync(join(dir, 'languages'), { recursive: true });
  const { ir, errors } = await buildProjectIr(dir);
  if (!ir) {
    if (created) rmdirSync(join(dir, 'languages'));
    for (const error of errors) console.error(`error: ${error}`);
    return 1;
  }
  const phrases = await unionMessages(dir, { target: 'web', ir });
  if (command.action === 'extract') {
    writeFileSync(join(dir, 'languages', 'template.lang'), extractTemplate(phrases));
    console.log(`languages/template.lang: ${phrases.length} phrases`);
    return 0;
  }
  const result = checkProjectI18n(dir, ir, phrases);
  for (const error of result.errors) console.error(`error: ${error}`);
  if (result.locales.length === 0 && result.errors.length === 0) console.log('no translations: add languages/<tag>.lang (forge i18n extract writes a template)');
  let incomplete = false;
  for (const locale of result.locales) {
    const percent = locale.total === 0 ? 100 : Math.floor((locale.translated * 100) / locale.total);
    console.log(`${locale.tag}: ${locale.translated}/${locale.total} phrases (${percent}%)`);
    for (const text of locale.missing) console.log(`  missing: ${text}`);
    for (const text of locale.orphans) console.log(`  orphan: ${text}`);
    if (locale.missing.length > 0 || locale.orphans.length > 0) incomplete = true;
  }
  return result.errors.length > 0 || (command.strict === true && incomplete) ? 1 : 0;
}
