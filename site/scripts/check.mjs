// Structure and link check for dist/ (plain Node, no dependencies).
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const dist = resolve('dist');
const base = '/forge';
const errors = [];
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const pages = walk(dist).filter((f) => f.endsWith('.html'));

function exists(urlPath) {
  const p = join(dist, urlPath);
  if (existsSync(p) && statSync(p).isFile()) return true;
  return existsSync(join(p, 'index.html'));
}

for (const file of pages) {
  const html = readFileSync(file, 'utf8');
  const rel = file.slice(dist.length);
  const fail = (m) => errors.push(`${rel}: ${m}`);
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) fail(`expected one <h1>, found ${h1}`);
  if (!/<title>[^<]+<\/title>/.test(html)) fail('missing <title>');
  if (!/<meta name="description" content="[^"]+"/.test(html)) fail('missing meta description');
  for (const img of html.match(/<img\b[^>]*>/g) || []) if (!/\balt=/.test(img)) fail(`img without alt: ${img}`);
  for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    let url = m[1];
    if (/^(https?:|mailto:|data:|#)/.test(url)) continue;
    url = url.split('#')[0].split('?')[0];
    if (!url) continue;
    const target = url.startsWith('/')
      ? (url.startsWith(base + '/') || url === base ? url.slice(base.length) || '/' : null)
      : resolve('/', dirname(rel), url);
    if (target === null) fail(`link outside base: ${m[1]}`);
    else if (!exists(target)) fail(`broken link: ${m[1]}`);
  }
}
if (pages.length === 0) errors.push('no pages found in dist/');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`check ok: ${pages.length} pages`);
