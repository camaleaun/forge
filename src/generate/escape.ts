export function cppString(text: string): string {
  let out = '';
  for (const char of text) {
    if (char === '\\') out += '\\\\';
    else if (char === '"') out += '\\"';
    else if (char === '\n') out += '\\n';
    else if (char === '\t') out += '\\t';
    else if (char === '\r') out += '\\r';
    else if (char < ' ' || char === '\u007f') out += `\\${char.charCodeAt(0).toString(8).padStart(3, '0')}`;
    else out += char;
  }
  return `"${out}"`;
}

export function objcString(text: string): string {
  return `@${cppString(text)}`;
}
