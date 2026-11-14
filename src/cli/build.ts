import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RUNTIME_DIR, generateProject, runtimeFilesFor, writeProjectFiles } from '../gen/index.ts';
import type { ProjectFiles } from '../gen/index.ts';
import type { I18nGenOptions } from '../gen/i18n-options.ts';
import { loadProjectI18n } from '../i18n/project.ts';
import type { Ir } from '../ir/types.ts';
import { appIdFor } from '../project/app-id.ts';
import { buildProjectIr } from '../project/build.ts';

export type BuildOptions = { project: string; target: string; out: string; strictI18n?: boolean };

function hasLanguageSelect(node: Ir['root']): boolean {
  return node.select?.language === true || node.children.some(hasLanguageSelect);
}

// Returns the process exit code; messages go to stderr.
export async function build(options: BuildOptions): Promise<number> {
  const { ir, errors, iconSvg, pkg } = await buildProjectIr(resolve(options.project));
  if (!ir || !pkg) {
    for (const error of errors) console.error(`error: ${error}`);
    return 1;
  }
  const i18n = loadProjectI18n(resolve(options.project), ir, pkg);
  // --strict-i18n makes every warning an error (releases use it).
  const errors18n = [...i18n.errors];
  if (i18n.packs.length === 0 && hasLanguageSelect(ir.root)) {
    errors18n.push('<select language> needs at least one language file in languages/');
  }
  const problems = options.strictI18n ? [...errors18n, ...i18n.warnings] : errors18n;
  if (problems.length > 0) {
    for (const error of problems) console.error(`error: ${error}`);
    return 1;
  }
  for (const warning of i18n.warnings) console.error(`warning: ${warning}`);

  const { baseUrl, options: flags, packs } = i18n;
  let appId: string;
  try {
    appId = appIdFor(pkg, options.target);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    return 1;
  }
  const i18nOptions: I18nGenOptions | undefined = packs.length === 0 ? undefined : {
    appId,
    packs: packs.map(({ tag, file, sha256, size }) => ({ tag, file, sha256, size })),
    baseUrl,
    ...flags,
  };
  let files: ProjectFiles;
  try {
    files = generateProject(ir, options.target, { iconSvg, appId, ...(i18nOptions ? { i18n: i18nOptions } : {}) });
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    return 1;
  }
  mkdirSync(options.out, { recursive: true });
  writeProjectFiles(files, options.out);
  for (const name of runtimeFilesFor(i18nOptions, options.target)) copyFileSync(join(RUNTIME_DIR, name), join(options.out, name));
  if (i18n.packs.length > 0) {
    mkdirSync(join(options.out, 'lang'), { recursive: true });
    for (const pack of i18n.packs) writeFileSync(join(options.out, 'lang', pack.file), pack.text);
  }
  return 0;
}
