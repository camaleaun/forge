// The contract between `forge build` (which makes the language packs) and the generators (which embed their hashes).
export type PackInfo = {
  tag: string;      // normalized, for example "pt-BR"
  file: string;     // file name inside lang/, for example "hello-0.2.0-pt-BR.lang"
  sha256: string;   // lowercase hex of the pack bytes
  size: number;     // pack size in bytes
};

export type I18nGenOptions = {
  appId: string;    // reverse-DNS bundle id, also the cache folder and the defaults domain
  packs: PackInfo[];
  baseUrl: string;  // where the packs are downloaded from, with a trailing slash
  download: boolean; // false = never download, only use the cache (package.json forge.i18n.download = false)
  menu: boolean;     // add the Language menu (package.json forge.i18n.menu !== false)
  // `forge build --bundle-locale <tag>`: the pack text is embedded in the binary and its tag is the default language.
  bundle?: { tag: string; text: string };
};
