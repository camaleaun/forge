export type Asset = { name: string; sha256: string; size: number };
type File = { url: string; sha256: string; size: number };
export type PackageKind = 'deb' | 'rpm' | 'snap' | 'appimage' | 'dmg';
export type ManifestOptions = { version: string; repo: string; tag: string };
export type Manifest = {
  version: string;
  platforms: Record<string, File>;
  // Present only when the release has installable packages (.deb, .rpm, .snap, .AppImage, .dmg), per platform.
  packages?: Record<string, Partial<Record<PackageKind, File>>>;
  // Present only when the release has language packs (<app>-<version>-<tag>.lang).
  languages?: Record<string, { url: string; sha256: string; size: number }>;
};

// <app>-<version>-<os>-<arch>.zip (macOS) or .tar.gz (Linux)
const PORTABLE = /^.+?-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-([a-z0-9_]+-[a-z0-9_]+)\.(zip|tar\.gz)$/;
// <app>-<version>-<os>-<arch>.<deb|rpm|snap|AppImage|dmg>
const PACKAGE = /^.+?-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-([a-z0-9_]+-[a-z0-9_]+)\.(deb|rpm|snap|AppImage|dmg)$/;

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
  const packages: NonNullable<Manifest['packages']> = {};
  const providers: Record<string, string> = {};
  const portableNames: Record<string, string> = {};
  const packageNames: Record<string, string> = {};
  for (const asset of assets) {
    const url = `https://github.com/${options.repo}/releases/download/${options.tag}/${asset.name}`;
    if (asset.name.endsWith('.lang')) {
      const tag = languageOf(asset.name, options.version);
      if (providers[tag] !== undefined) throw new Error(`asset "${asset.name}": language ${tag} is already provided by ${providers[tag]}`);
      providers[tag] = asset.name;
      languages[tag] = { url, sha256: asset.sha256, size: asset.size };
      continue;
    }
    const portable = /\.(zip|tar\.gz)$/.exec(asset.name)?.[1];
    if (portable !== undefined) {
      const match = PORTABLE.exec(asset.name);
      if (!match || match[3] !== portable) throw new Error(`asset "${asset.name}": name must be <app>-<version>-<os>-<arch>.${portable}`);
      const [, version, platform] = match;
      if (version !== options.version) {
        throw new Error(`asset "${asset.name}": version ${version} does not match release version ${options.version}`);
      }
      if (portableNames[platform] !== undefined) {
        throw new Error(`asset "${asset.name}": platform ${platform} is already provided by ${portableNames[platform]}`);
      }
      portableNames[platform] = asset.name;
      platforms[platform] = { url, sha256: asset.sha256, size: asset.size };
      continue;
    }
    const extension = /\.(deb|rpm|snap|AppImage|dmg)$/.exec(asset.name)?.[1];
    if (extension === undefined) continue;
    const match = PACKAGE.exec(asset.name);
    if (!match) {
      // The macOS CPack name (<app>-<version>-Darwin.dmg) carries no platform: it is not part of the manifest.
      if (extension === 'dmg') continue;
      throw new Error(`asset "${asset.name}": name must be <app>-<version>-<os>-<arch>.${extension}`);
    }
    const [, version, platform] = match;
    if (version !== options.version) {
      throw new Error(`asset "${asset.name}": version ${version} does not match release version ${options.version}`);
    }
    const kind = extension.toLowerCase() as PackageKind;
    const key = `${platform} ${kind}`;
    if (packageNames[key] !== undefined) throw new Error(`asset "${asset.name}": ${key} is already provided by ${packageNames[key]}`);
    packageNames[key] = asset.name;
    (packages[platform] ??= {})[kind] = { url, sha256: asset.sha256, size: asset.size };
  }
  const result: Manifest = { version: options.version, platforms };
  if (Object.keys(languages).length > 0) result.languages = languages;
  if (Object.keys(packages).length > 0) result.packages = packages;
  return result;
}
