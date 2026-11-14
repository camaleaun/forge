// PHP/WordPress printf subset used by sprintf(): %s %d %1$s %2$d %%.
// It never throws: a specifier it cannot fill (too few arguments, unknown conversion) is left as written.
const SPECIFIER = /%(?:(\d{1,2})\$)?([sd%])/g;

export function formatPrintf(pattern: string, args: (string | number)[]): string {
  let next = 0;
  return pattern.replace(SPECIFIER, (whole, position: string | undefined, conversion: string) => {
    if (conversion === '%') return '%';
    const index = position === undefined ? next++ : Number(position) - 1;
    if (index < 0 || index >= args.length) return whole;
    const value = args[index];
    if (conversion === 's') return String(value);
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? String(number) : whole;
  });
}

// How many arguments the pattern needs: the highest positional index, or the number of sequential specifiers.
export function placeholderCount(pattern: string): number {
  let sequential = 0;
  let highest = 0;
  for (const match of pattern.matchAll(SPECIFIER)) {
    if (match[2] === '%') continue;
    if (match[1] === undefined) sequential += 1;
    else highest = Math.max(highest, Number(match[1]));
  }
  return Math.max(sequential, highest);
}
