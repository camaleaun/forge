// The reverse-DNS application id: macOS bundle id, Linux GApplication id, .desktop/icon/metainfo name.
export type AppIdSource = { name: string; forge?: unknown };

const REVERSE_DNS = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/;

function customId(forge: unknown): string | undefined {
  if (typeof forge !== 'object' || forge === null || !('appId' in forge)) return undefined;
  const value = (forge as { appId: unknown }).appId;
  if (typeof value !== 'string' || !REVERSE_DNS.test(value)) {
    throw new Error('package.json forge.appId must be a reverse-DNS id such as "org.example.my_app"');
  }
  return value;
}

// local.forge.<name> by default (never changes, so saved preferences survive); forge.appId overrides it on Linux.
// D-Bus names do not allow "-", so Linux ids use "_" instead.
export function appIdFor(pkg: AppIdSource, target: string): string {
  if (target !== 'linux') return `local.forge.${pkg.name}`;
  return (customId(pkg.forge) ?? `local.forge.${pkg.name}`).replaceAll('-', '_');
}
