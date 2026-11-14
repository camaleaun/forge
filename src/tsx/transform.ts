import type { Attr, Child, ElementNode } from './parse.ts';
import { parseElement } from './parse.ts';
import {
  isJsxStart,
  locOf,
  regexAllowed,
  scanBalanced,
  skipComment,
  skipRegex,
  skipString,
  skipTemplate,
} from './scan.ts';

const PRELUDE = 'import{h as __h,Fragment as __F}from"forge/jsx";';

// Replaces every JSX element with an `__h(...)` call, keeping the line count.
export function transformJsx(source: string, file: string): string {
  return PRELUDE + new Transformer(source, file).segment(0, source.length);
}

function countNewlines(text: string): number {
  let n = 0;
  for (const ch of text) if (ch === '\n') n++;
  return n;
}

class Transformer {
  source: string;
  file: string;
  // Original line that the output written so far has reached.
  line = 1;

  constructor(source: string, file: string) {
    this.source = source;
    this.file = file;
  }

  // Transforms source[start, end): copies code, skipping strings/comments/regex, and replaces JSX.
  segment(start: number, end: number): string {
    const src = this.source;
    let out = '';
    let copied = start;
    let i = start;
    while (i < end) {
      const ch = src[i];
      let next = -1;
      if (ch === '"' || ch === "'") next = skipString(src, i, this.file);
      else if (ch === '`') next = skipTemplate(src, i, this.file);
      else if (ch === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) next = skipComment(src, i, this.file);
      else if (ch === '/' && regexAllowed(src, i)) next = skipRegex(src, i, this.file);
      else if (ch === '<' && isJsxStart(src, i)) {
        const { node, end: elementEnd } = parseElement(src, i, this.file);
        out += src.slice(copied, i) + this.element(node, elementEnd);
        i = copied = elementEnd;
        continue;
      }
      i = next === -1 ? i + 1 : next;
    }
    return out + src.slice(copied, end);
  }

  // Original line at the start of a code segment is tracked by the callers.
  private codeAt(offset: number, code: string): string {
    return this.segment(offset, offset + code.length);
  }

  // Emits the newlines needed to bring the output up to original line `target`.
  private sync(target: number): string {
    const n = target - this.line;
    if (n <= 0) return '';
    this.line += n;
    return '\n'.repeat(n);
  }

  private element(node: ElementNode, end: number): string {
    this.line = node.loc[0];
    const call = this.call(node);
    return call.slice(0, -1) + this.sync(locOf(this.source, end - 1)[0]) + ')';
  }

  // Builds `__h(name, props, ...children)` without its final ")" padding.
  private call(node: ElementNode): string {
    const name = node.name === '' ? '__F' : /^[a-z]/.test(node.name) ? JSON.stringify(node.name) : node.name;
    const props: string[] = [];
    let out = `__h(${name}, `;
    for (const attr of node.attrs) props.push(this.attr(attr));
    props.push(`"forge:loc":${JSON.stringify(node.loc)}`);
    out += node.name === '' && node.attrs.length === 0 ? 'null' : `{${props.join(',')}}`;
    for (const child of node.children) out += ',' + this.child(child);
    return out + ')';
  }

  private attr(attr: Attr): string {
    const sync = this.sync(attr.loc[0]);
    const key = JSON.stringify(attr.name);
    const v = attr.value;
    if (v.kind === 'true') return `${sync}${key}:true`;
    if (v.kind === 'string') return `${sync}${key}:${JSON.stringify(v.value)}`;
    return `${sync}${key}:${this.expr(v.code, attr.loc)}`;
  }

  private child(child: Child): string {
    if (child.kind === 'text') return ' ' + JSON.stringify(child.value);
    if (child.kind === 'expr') return this.sync(child.loc[0]) + ' ' + this.expr(child.code, child.loc);
    const sync = this.sync(child.node.loc[0]);
    return sync + ' ' + this.call(child.node);
  }

  // Transforms the JSX inside raw expression code; `near` is the loc of the "{" or the attribute name.
  private expr(code: string, near: [number, number]): string {
    const offset = this.offsetOf(code, near);
    const out = this.codeAt(offset, code);
    this.line += countNewlines(out);
    return out;
  }

  // Finds where `code` starts in the source: right after the "{" at/after `near`.
  private offsetOf(code: string, near: [number, number]): number {
    let at = 0;
    for (let l = 1; l < near[0]; l++) at = this.source.indexOf('\n', at) + 1;
    at += near[1] - 1;
    const open = this.source.indexOf('{', at);
    return open + 1;
  }
}
