export type Asset = { name: string; sha256: string; size: number };
export type ManifestOptions = { version: string; repo: string; tag: string };
export type Manifest = {
  version: string;
  platforms: Record<string, { url: string; sha256: string; size: number }>;
  // Present only when the release has language packs (<app>-<version>-<tag>.lang).
  languages?: Record<string, { url: string; sha256: string; size: number }>;
};

// <app>-<version>-<os>-<arch>.zip
const PORTABLE_ZIP = /^.+?-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-([a-z0-9_]+-[a-z0-9_]+)\.zip$/;

// <app>-<version>-<tag>.lang; the tag is a BCP 47 looking suffix (pt-BR, zh-Hant-TW).
const TAG = '[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*';
const ANY_VERSION_LANG = new RegExp(`^.+?-(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.]+)??)-(${TAG})\\.lang$`);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Finds the tag of a language pack. The release version is known, so a prerelease such as 0.1.0-rc.1 is not mistaken for part of the tag.
function languageOf(name: string, version: string): string {
  const known = new RegExp(`^.+?-${escapeRegExp(version)}-(${TAG})\\.lang$`).exec(name);
  if (known) return known[1];
  const other = ANY_VERSION_LANG.exec(name);
  if (!other) throw new Error(`asset "${name}": name must be <app>-<version>-<tag>.lang`);
  throw new Error(`asset "${name}": version ${other[1]} does not match release version ${version}`);
}

export function buildManifest(options: ManifestOptions, assets: Asset[]): Manifest {
  const platforms: Manifest['platforms'] = {};
  const languages: NonNullable<Manifest['languages']> = {};
  const providers: Record<string, string> = {};
  for (const asset of assets) {
    const url = `https://github.com/${options.repo}/releases/download/${options.tag}/${asset.name}`;
    if (asset.name.endsWith('.lang')) {
      const tag = languageOf(asset.name, options.version);
      if (providers[tag] !== undefined) throw new Error(`asset "${asset.name}": language ${tag} is already provided by ${providers[tag]}`);
      providers[tag] = asset.name;
      languages[tag] = { url, sha256: asset.sha256, size: asset.size };
      continue;
    }
    if (!asset.name.endsWith('.zip')) continue;
    const match = PORTABLE_ZIP.exec(asset.name);
    if (!match) throw new Error(`asset "${asset.name}": name must be <app>-<version>-<os>-<arch>.zip`);
    const [, version, platform] = match;
    if (version !== options.version) {
      throw new Error(`asset "${asset.name}": version ${version} does not match release version ${options.version}`);
    }
    platforms[platform] = { url, sha256: asset.sha256, size: asset.size };
  }
  return Object.keys(languages).length > 0 ? { version: options.version, platforms, languages } : { version: options.version, platforms };
}
