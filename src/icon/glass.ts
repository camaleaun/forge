// macOS 26 "Liquid Glass" app icon: builds an Icon Composer document (<name>.icon folder) from flat SVG layers
// and the actool arguments that compile it into Assets.car.
//
// Sources and confidence (see the forge-rag notes): Apple does not publish the icon.json schema. The shape used here
// comes from real Icon Composer files and a reverse-engineered schema (github.com/giginet/apple-icon-composer-skill).
// Everything that depends on that undocumented format lives in iconJson() and glassCompileArgs(); the rest is plain
// file layout and validation.
import { parseSvg } from './svg.ts';

export interface GlassLayers { background?: string; foreground: string[] }
export interface GlassOptions { name?: string }
export interface GlassCompileOptions {
  iconPath: string;
  outputDir: string;
  partialPlist: string;
  name?: string;
  minimumDeploymentTarget?: string;
}

const DEFAULT_NAME = 'AppIcon';

function checkLayer(file: string, source: string): void {
  const doc = parseSvg(source, { file });
  if (doc.viewBox.width !== doc.viewBox.height) {
    throw new Error(`${file}: a glass icon layer must be square (the canvas is 1024x1024), found ${doc.viewBox.width}x${doc.viewBox.height}`);
  }
}

// UNCERTAIN PART 1: the icon.json document. Group 0 is the front-most; `foreground` is given back to front (SVG
// painter's order), icon.json lists layers front first. The background is its own group with glass off, so the
// system's glass applies only to the foreground. Without a background the icon gets the system's light fill.
function iconJson(foregroundCount: number, hasBackground: boolean): string {
  const front = [];
  for (let i = foregroundCount; i >= 1; i--) front.push({ glass: true, 'image-name': `foreground-${i}.svg`, name: `foreground-${i}` });
  const groups: object[] = [{
    layers: front,
    shadow: { kind: 'neutral', opacity: 0.5 },
    translucency: { enabled: true, value: 0.5 },
  }];
  if (hasBackground) {
    groups.push({
      layers: [{ glass: false, 'image-name': 'background.svg', name: 'background' }],
      shadow: { kind: 'none', opacity: 0.5 },
      translucency: { enabled: false, value: 0.5 },
    });
  }
  const doc: Record<string, unknown> = hasBackground ? {} : { fill: 'system-light' };
  doc.groups = groups;
  doc['supported-platforms'] = { squares: 'shared' };
  return JSON.stringify(doc, null, 2) + '\n';
}

// Returns relative path -> content of the <name>.icon folder.
export function buildGlassIcon(layers: GlassLayers, options: GlassOptions = {}): Map<string, string | Uint8Array> {
  const name = options.name ?? DEFAULT_NAME;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) throw new Error(`invalid icon name "${name}" (use letters, digits, "-" and "_")`);
  if (layers.foreground.length === 0) throw new Error('a glass icon needs at least one foreground layer');
  const dir = `${name}.icon`;
  const files = new Map<string, string | Uint8Array>();
  if (layers.background !== undefined) {
    checkLayer('background.svg', layers.background);
    files.set(`${dir}/Assets/background.svg`, layers.background);
  }
  layers.foreground.forEach((svg, i) => {
    checkLayer(`foreground-${i + 1}.svg`, svg);
    files.set(`${dir}/Assets/foreground-${i + 1}.svg`, svg);
  });
  files.set(`${dir}/icon.json`, iconJson(layers.foreground.length, layers.background !== undefined));
  return files;
}

// UNCERTAIN PART 2: the actool command line (run as `xcrun actool <args>` with Xcode 26). The flags come from
// community reports, not Apple docs. --include-all-app-icons and the stack-fallback flag are the ones reported
// to be needed on Xcode 26.0.x; verify on the real runner. Info.plist then needs CFBundleIconName = <name>.
export function glassCompileArgs(options: GlassCompileOptions): string[] {
  return [
    '--compile', options.outputDir,
    options.iconPath,
    '--platform', 'macosx',
    '--minimum-deployment-target', options.minimumDeploymentTarget ?? '26.0',
    '--app-icon', options.name ?? DEFAULT_NAME,
    '--output-partial-info-plist', options.partialPlist,
    '--include-all-app-icons',
    '--enable-icon-stack-fallback-generation=disabled',
  ];
}
