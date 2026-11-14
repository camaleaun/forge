import type { Spec } from './types.ts';

const WIDGET_TYPES = ['label', 'button'];
const RESERVED_FLAGS = ['--version', '--help'];
const ID_PATTERN = /^[a-z][A-Za-z0-9_]*$/;
const CPP_KEYWORDS = new Set((
  'alignas alignof and asm auto bool break case catch char class concept const consteval constexpr constinit ' +
  'const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false ' +
  'float for friend goto if inline int long mutable namespace new noexcept not nullptr operator or private ' +
  'protected public register reinterpret_cast requires return short signed sizeof static static_assert ' +
  'static_cast struct switch template this thread_local throw true try typedef typeid typename union ' +
  'unsigned using virtual void volatile while xor'
).split(' '));

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function checkApp(spec: Spec): string[] {
  return SEMVER.test(spec.app.version) ? [] : [`app.version: "${spec.app.version}" must be semver x.y.z`];
}

function checkWidgets(spec: Spec, actionNames: string[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  spec.widgets.forEach((widget, i) => {
    if (!WIDGET_TYPES.includes(widget.type)) {
      errors.push(`widgets[${i}].type: unknown widget type "${widget.type}" (expected ${WIDGET_TYPES.join(' | ')})`);
    }
    if (!ID_PATTERN.test(widget.id) || CPP_KEYWORDS.has(widget.id)) {
      errors.push(`widgets[${i}].id: invalid id "${widget.id}" (must match ${ID_PATTERN} and not be a C++ keyword)`);
    }
    if (widget.type === 'button' && !actionNames.includes(widget.action)) {
      errors.push(`widgets[${i}].action: unknown action "${widget.action}"`);
    }
    if (seen.has(widget.id)) errors.push(`widgets[${i}].id: duplicate id "${widget.id}"`);
    seen.add(widget.id);
  });
  return errors;
}

function checkCommands(spec: Spec): string[] {
  const errors: string[] = [];
  spec.commands.forEach((command, i) => {
    if (RESERVED_FLAGS.includes(command.flag)) errors.push(`commands[${i}].flag: "${command.flag}" is reserved`);
  });
  return errors;
}

export function validateSpec(spec: Spec, actionNames: string[]): string[] {
  return [...checkApp(spec), ...checkWidgets(spec, actionNames), ...checkCommands(spec)];
}
