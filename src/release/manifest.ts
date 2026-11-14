export type Asset = { name: string; sha256: string; size: number };
export type ManifestOptions = { version: string; repo: string; tag: string };
export type Manifest = {
  version: string;
  platforms: Record<string, { url: string; sha256: string; size: number }>;
};

// <app>-<version>-<os>-<arch>.zip
const PORTABLE_ZIP = /^.+?-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-([a-z0-9_]+-[a-z0-9_]+)\.zip$/;

export function buildManifest(options: ManifestOptions, assets: Asset[]): Manifest {
  const platforms: Manifest['platforms'] = {};
  for (const asset of assets) {
    if (!asset.name.endsWith('.zip')) continue;
    const match = PORTABLE_ZIP.exec(asset.name);
    if (!match) throw new Error(`asset "${asset.name}": name must be <app>-<version>-<os>-<arch>.zip`);
    const [, version, platform] = match;
    if (version !== options.version) {
      throw new Error(`asset "${asset.name}": version ${version} does not match release version ${options.version}`);
    }
    platforms[platform] = {
      url: `https://github.com/${options.repo}/releases/download/${options.tag}/${asset.name}`,
      sha256: asset.sha256,
      size: asset.size,
    };
  }
  return { version: options.version, platforms };
}
