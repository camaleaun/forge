export type Asset = { name: string; sha256: string; size: number };
type File = { url: string; sha256: string; size: number };
export type PackageKind = 'deb' | 'rpm' | 'snap' | 'appimage' | 'dmg';
// Variant files also list the portable archives.
export type VariantKind = PackageKind | 'zip' | 'tar.gz';
export type ManifestOptions = { version: string; repo: string; tag: string };
export type Manifest = {
  version: string;
  platforms: Record<string, File>;
  // Present only when the release has installable packages (.deb, .rpm, .snap, .AppImage, .dmg), per platform.
  packages?: Record<string, Partial<Record<PackageKind, File>>>;
  // Present only when the release has language packs (<app>-<version>-<tag>.lang).
  languages?: Record<string, { url: string; sha256: string; size: number }>;
  // Present only when the release has language variants of the packages (<app>-<version>-<platform>-<tag>.<ext>).
  variants?: Record<string, Record<string, Partial<Record<VariantKind, File>>>>;
};

// <app>-<version>-<os>-<arch>[-<tag>].<ext>; the tag (pt-BR, fr) marks a language variant.
const TAG = '[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*';
const PLATFORM = '([a-z0-9_]+-[a-z0-9_]+)';
const VERSION = '(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.]+)?)';
const EXTENSIONS = 'zip|tar\\.gz|deb|rpm|snap|AppImage|dmg';
// With the release version known, a dash inside it (0.4.0-rc.3) or in the platform (darwin-arm64) cannot be mistaken for the tag.
const KNOWN_FILE = (version: string) => new RegExp(`^.+?-${escapeRegExp(version)}-${PLATFORM}(?:-(${TAG}))?\\.(${EXTENSIONS})$`);
// Any version: only used to say which version a file was built for.
const ANY_FILE = new RegExp(`^.+?-${VERSION}-${PLATFORM}(?:-(${TAG}))?\\.(${EXTENSIONS})$`);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// <app>-<version>-<tag>.lang; the tag is a BCP 47 looking suffix (pt-BR, zh-Hant-TW).
const ANY_VERSION_LANG = new RegExp(`^.+?-(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.]+)??)-(${TAG})\\.lang$`);


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
  const variants: NonNullable<Manifest['variants']> = {};
  const variantNames: Record<string, string> = {};
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
    const extension = /\.(zip|tar\.gz|deb|rpm|snap|AppImage|dmg)$/.exec(asset.name)?.[1];
    if (extension === undefined) continue;
    const match = KNOWN_FILE(options.version).exec(asset.name);
    if (!match) {
      // The macOS CPack name (<app>-<version>-Darwin[-<tag>].dmg) carries no platform: it is not part of the manifest.
      if (extension === 'dmg') continue;
      const other = ANY_FILE.exec(asset.name);
      if (other && other[1] !== options.version) {
        throw new Error(`asset "${asset.name}": version ${other[1]} does not match release version ${options.version}`);
      }
      throw new Error(`asset "${asset.name}": name must be <app>-<version>-<os>-<arch>.${extension}`);
    }
    const [, platform, variant] = match;
    const portable = extension === 'zip' || extension === 'tar.gz';
    const kind = (portable ? extension : extension.toLowerCase()) as VariantKind;
    if (variant !== undefined) {
      const key = `${variant} ${platform} ${kind}`;
      if (variantNames[key] !== undefined) throw new Error(`asset "${asset.name}": ${key} is already provided by ${variantNames[key]}`);
      variantNames[key] = asset.name;
      ((variants[variant] ??= {})[platform] ??= {})[kind] = { url, sha256: asset.sha256, size: asset.size };
    } else if (portable) {
      if (portableNames[platform] !== undefined) {
        throw new Error(`asset "${asset.name}": platform ${platform} is already provided by ${portableNames[platform]}`);
      }
      portableNames[platform] = asset.name;
      platforms[platform] = { url, sha256: asset.sha256, size: asset.size };
    } else {
      const key = `${platform} ${kind}`;
      if (packageNames[key] !== undefined) throw new Error(`asset "${asset.name}": ${key} is already provided by ${packageNames[key]}`);
      packageNames[key] = asset.name;
      (packages[platform] ??= {})[kind as PackageKind] = { url, sha256: asset.sha256, size: asset.size };
    }
  }
  const result: Manifest = { version: options.version, platforms };
  if (Object.keys(languages).length > 0) result.languages = languages;
  if (Object.keys(packages).length > 0) result.packages = packages;
  if (Object.keys(variants).length > 0) result.variants = variants;
  return result;
}
