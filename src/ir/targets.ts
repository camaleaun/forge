// Targets a project can name in <only>/<except> (TSX) and @only/@except (CSS).
// windows, android and ios are accepted names; no generator exists for them yet.
export const TARGET_NAMES = ['macos', 'linux', 'windows', 'web', 'android', 'ios'] as const;
export type Target = (typeof TARGET_NAMES)[number];

// The preview (forge start) is the web target; a build that names no target is treated as the preview.
export const DEFAULT_TARGET: Target = 'web';

export const TARGET_LIST = TARGET_NAMES.join(' | ');

export function isTarget(name: string): name is Target {
  return (TARGET_NAMES as readonly string[]).includes(name);
}
