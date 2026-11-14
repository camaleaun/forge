export const ID_PATTERN = /^[a-z][A-Za-z0-9_]*$/;
export const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
export const APP_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
export const RESERVED_FLAGS = ['--version', '--help'];
export const RESERVED_ID_PREFIXES = [/^forge_/, /^s\d/, /^handler_/];
export const CPP_KEYWORDS = new Set((
  'alignas alignof and asm auto bool break case catch char class concept const consteval constexpr constinit ' +
  'const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false ' +
  'float for friend goto if inline int long mutable namespace new noexcept not nullptr operator or private ' +
  'protected public register reinterpret_cast requires return short signed sizeof static static_assert ' +
  'static_cast struct switch template this thread_local throw true try typedef typeid typename union ' +
  'unsigned using virtual void volatile while xor'
).split(' '));
