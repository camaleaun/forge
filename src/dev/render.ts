import { languageName } from '../i18n/names.ts';
import { textOf } from '../ir/text.ts';
import type { Ir, Node, Style, TextValue } from '../ir/types.ts';
import { CLIENT_SOURCE } from './i18n-client.ts';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** JSON that is safe inside <script>: no `<`, `>`, `&` or line separators can appear in it. */
const safeJson = (value: unknown): string =>
  JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const UNITLESS = new Set(['flex', 'fontWeight']);
const KEYWORDS: Record<string, string> = {
  start: 'flex-start', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly',
};
const SAFE_VALUE = /^[#\w .%,()-]+$/;

const cssName = (key: string): string => key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

function cssValue(key: string, value: string | number | number[]): string | undefined {
  let out: string;
  if (Array.isArray(value)) out = value.map((n) => `${n}px`).join(' ');
  else if (typeof value === 'number') out = UNITLESS.has(key) ? String(value) : `${value}px`;
  else out = KEYWORDS[value] ?? value;
  return SAFE_VALUE.test(out) ? out : undefined;
}

// The preview is plain HTML in the browser: the app window's own size (width, height, flex) is ignored and
// the root fills the whole page, so @media and the layout follow the real viewport.
const WINDOW_IGNORED = new Set(['width', 'height', 'flex']);

function styleAttr(kind: Node['kind'], style: Style): string {
  const decls: string[] = [];
  if (kind === 'window' || kind === 'view' || kind === 'step') {
    decls.push('display:flex');
    if (style.flexDirection === undefined) decls.push('flex-direction:column');
  }
  if (kind === 'step') decls.push('flex:1 1 auto');
  decls.push(...declarations(kind, style));
  if (kind === 'window') decls.push('width:100%', 'min-height:100vh', 'box-sizing:border-box');
  return decls.length ? ` style="${esc(decls.join(';'))}"` : '';
}

// Declarations for the entries of a style that are valid CSS; the app window's own size is dropped.
function declarations(kind: Node['kind'], style: Style, suffix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(style)) {
    if (!/^[a-zA-Z]+$/.test(key) || (kind === 'window' && WINDOW_IGNORED.has(key))) continue;
    const css = cssValue(key, value);
    if (css !== undefined) out.push(`${cssName(key)}:${css}${suffix}`);
  }
  return out;
}

const QUERY_FEATURES = [['minWidth', 'min-width'], ['maxWidth', 'max-width'], ['minHeight', 'min-height'], ['maxHeight', 'max-height']] as const;

// @media variants as real CSS: the browser's viewport drives them. The base style is inline, so they use !important;
// they keep their order, so a later variant still wins over an earlier one.
function mediaCss(node: Node): string {
  const selector = node.kind === 'select' ? '#forge-lang' : `#${node.id}`;
  const own = (node.variants ?? []).flatMap((variant) => {
    const decls = declarations(node.kind, variant.style, '!important');
    if (decls.length === 0) return [];
    const query = QUERY_FEATURES.filter(([key]) => variant.query[key] !== undefined).map(([key, name]) => `(${name}:${variant.query[key]}px)`);
    return [`@media ${query.join(' and ')}{${selector}{${decls.join(';')}}}`];
  });
  return own.join('') + node.children.map(mediaCss).join('');
}

function languageOptions(languages: string[], auto: boolean): string {
  return (auto ? ['<option value="auto">Auto</option>'] : [])
    .concat('<option value="en">English</option>', languages.map((tag) => `<option value="${esc(tag)}">${esc(languageName(tag))}</option>`))
    .join('');
}

function hasSteps(node: Node): boolean {
  return node.kind === 'steps' || node.children.some(hasSteps);
}

function hasSelect(node: Node): boolean {
  return node.kind === 'select' || node.children.some(hasSelect);
}

/** Collects the message texts the script re-renders; the index in the list is the data-msg-key. */
type Texts = TextValue[];

function msgKey(value: TextValue, texts: Texts): string {
  if (value.kind !== 'message') return '';
  texts.push(value);
  return ` data-msg-key="${texts.length - 1}"`;
}

function renderNode(node: Node, ir: Ir, texts: Texts, languages: string[], hiddenStep = false): string {
  const attrs = ` id="${esc(node.id)}"` + (node.classes.length ? ` class="${esc(node.classes.join(' '))}"` : '');
  let text = '';
  let bound = '';
  if (node.content && node.content.kind !== 'state') {
    text = esc(textOf(node.content));
    bound = msgKey(node.content, texts);
  }
  else if (node.content?.kind === 'state') {
    const stateId = node.content.state;
    bound = ` data-state="${esc(stateId)}"`;
    const initial = ir.states.find((s) => s.id === stateId)?.initial;
    text = esc(initial ? textOf(initial) : '');
  }
  const style = styleAttr(node.kind, node.style);
  const children = node.children.map((child, index) => renderNode(child, ir, texts, languages, node.kind === 'steps' && index > 0)).join('');
  switch (node.kind) {
    case 'steps':
      return `<div${attrs} style="display:contents">${children}</div>`;
    case 'step':
      return `<div${attrs} data-step="${esc(node.id)}"${hiddenStep ? ' hidden' : ''}${style}>${children}</div>`;
    case 'text':
      return `<div${attrs}${bound}${style}>${text}</div>`;
    case 'select': {
      // The language dropdown: English plus one option per available pack; the script wires it up by id.
      const options = languageOptions(languages, false);
      return `<select id="forge-lang"${node.classes.length ? ` class="${esc(node.classes.join(' '))}"` : ''}${style}>${options}</select>`;
    }
    case 'progress': {
      // value/max like HTML; no value attribute = indeterminate. A language-download bar starts hidden and the script shows it.
      const { value, max = 1, source } = node.progress ?? {};
      const extra = (value !== undefined ? ` value="${value}"` : '') + ` max="${max}"`;
      const bound = source === 'language-download' ? ' data-source="language-download" hidden' : '';
      return `<progress${attrs}${bound}${extra}${style}></progress>`;
    }
    case 'button': {
      const click = node.on?.click ? ` data-click="${esc(node.on.click)}"` : '';
      const waits = node.disabledDuringDownload ? ' data-waits-download' : '';
      const marks = (node.primary ? ' data-primary' : '') + (node.cancel ? ' data-cancel' : '');
      return `<button type="button"${attrs}${bound}${click}${waits}${marks}${style}>${text}</button>`;
    }
    default:
      return `<div${attrs}${style}>${children}</div>`;
  }
}

const RELOAD = `try{new EventSource('/events').onmessage=function(e){if(e.data==='reload')location.reload();};}catch(e){}`;

// Light and dark follow the system (prefers-color-scheme); the app's own CSS colours are left as authored.
const CSS = `:root{color-scheme:light dark}
progress[hidden]{display:none}
button[data-primary]{outline:2px solid #0a84ff;outline-offset:-1px}
[data-step][hidden]{display:none!important}
#forge-notice{padding:8px 16px;font-size:13px;background:#fff3cd;color:#533f03}
body{margin:0;padding:0;font-family:system-ui,sans-serif;background:#fff;color:#222}
h1.forge-errors{color:#b00020}
#forge-tools{padding:16px;font-size:13px}
#forge-cli{max-width:480px}
#forge-cli button{margin:0 8px 8px 0}
#forge-cli-out{white-space:pre-wrap;font-family:ui-monospace,monospace;background:#111;color:#8f8;padding:8px;min-height:1em}
@media (prefers-color-scheme: dark){body{background:#1c1c1e;color:#f2f2f7}h1.forge-errors{color:#ff6b81}#forge-cli-out{background:#000;color:#9f9}}`;

const APP_SCRIPT = `(function(){
${CLIENT_SOURCE}
var data=JSON.parse(document.getElementById('forge-ir').textContent);
var texts=data.texts||[];
var languages=data.languages||[];
var handlers={};
data.handlers.forEach(function(h){handlers[h.id]=h;});
var values={};
data.states.forEach(function(s){values[s.id]=s.initial;});
var pack=null;
var request=0;
function tr(v){
  if(v.kind!=='message')return v.value;
  var args=v.args||[];
  var entry=pack&&pack.entries[(v.context||'')+'\\u0004'+v.text];
  if(entry){
    var i=v.plural!==undefined&&pack.plural?pack.plural(v.count===undefined?1:v.count):0;
    var form=entry[i]!==undefined?entry[i]:entry[0];
    if(form)return forgeFormat(form,args);
  }
  return forgeFormat(v.plural!==undefined&&v.count!==1?v.plural:v.text,args);
}
function all(selector){return document.querySelectorAll(selector);}
function renderState(id){
  var els=all('[data-state="'+id+'"]');
  for(var i=0;i<els.length;i++)els[i].textContent=tr(values[id]);
}
function render(){
  var els=all('[data-msg-key]');
  for(var i=0;i<els.length;i++){var t=texts[Number(els[i].getAttribute('data-msg-key'))];if(t)els[i].textContent=tr(t);}
  for(var id in values)renderState(id);
  if(data.root.title)document.title=tr(data.root.title);
}
// <steps>: only the current step shows; next, back, goTo and quit move between them (the preview ignores step sizes).
var current=0;
function showStep(to){
  var steps=all('[data-step]');
  if(!steps.length)return;
  var at=current;
  if(to==='next')at=Math.min(steps.length-1,current+1);
  else if(to==='back')at=Math.max(0,current-1);
  else if(to&&to.step){for(var i=0;i<steps.length;i++)if(steps[i].getAttribute('data-step')===to.step)at=i;}
  else if(to===0)at=0;
  current=at;
  for(var j=0;j<steps.length;j++)steps[j].hidden=j!==current;
}
// Enter fires the primary button and Escape the cancel button of the visible step (a disabled button does nothing).
function pressKey(name){
  var found=all('['+name+']').filter(function(b){return !b.disabled&&!(b.closest&&b.closest('[data-step][hidden]'));})[0];
  if(found)found.click();
  return !!found;
}
if(document.addEventListener)document.addEventListener('keydown',function(e){
  var tag=e.target&&e.target.tagName;
  if(tag==='TEXTAREA'||tag==='SELECT'||e.defaultPrevented)return;
  if(e.key==='Enter'&&tag!=='BUTTON'&&pressKey('data-primary'))e.preventDefault();
  else if(e.key==='Escape'&&pressKey('data-cancel'))e.preventDefault();
});
function notice(show){var n=document.getElementById('forge-notice');if(n)n.hidden=!show;}
function run(id){
  var printed=[];
  var h=handlers[id];
  if(!h)return printed;
  notice(false);
  h.effects.forEach(function(e){
    if(e.op==='go'){showStep(e.to);return;}
    if(e.op==='quit'){showStep(0);notice(true);return;}
    if(e.op!=='set')return;
    values[e.state]=e.value;
    renderState(e.state);
    printed.push(tr(e.value));
  });
  return printed;
}
var out=document.getElementById('forge-cli-out');
var lines=[];
function on(selector,attr,show){
  var els=all(selector);
  for(var i=0;i<els.length;i++)(function(el){
    el.addEventListener('click',function(){
      var printed=run(el.getAttribute(attr));
      if(show&&out){lines.push(el.getAttribute('data-command')+': '+printed.join(' | '));out.textContent=lines.join('\\n');}
    });
  })(els[i]);
}
on('[data-click]','data-click',false);
on('[data-command]','data-handler',true);
function stored(){try{return localStorage.getItem('forge-lang');}catch(e){return null;}}
function queryLang(){
  var m=/[?&]lang=([^&]*)/.exec(typeof location!=='undefined'&&location.search?location.search:'');
  if(!m)return null;
  try{return decodeURIComponent(m[1]);}catch(e){return null;}
}
function resolve(choice){
  if(choice&&choice!=='auto')return choice==='en'?'en':forgePickLocale([choice],languages);
  var preferred=typeof navigator!=='undefined'?(navigator.languages||(navigator.language?[navigator.language]:[])):[];
  return forgePickLocale(Array.prototype.slice.call(preferred),languages);
}
// The <progress source="language-download"> bars: shown while a pack downloads, hidden otherwise.
// value is null while the total size is unknown (indeterminate), else 0..1.
function bars(show,value){
  var els=all('[data-source="language-download"]');
  for(var i=0;i<els.length;i++){
    els[i].hidden=!show;
    if(show&&value!==null&&value!==undefined)els[i].value=value;
    else els[i].removeAttribute('value');
  }
  var waiting=all('[data-waits-download]');
  for(var k=0;k<waiting.length;k++)waiting[k].disabled=show;
}
// Reads the response as text; with a Content-Length and a streaming body the bars follow the bytes received.
function download(r,mine){
  var total=r.headers&&r.headers.get?Number(r.headers.get('Content-Length')):0;
  if(!total||!r.body||!r.body.getReader||typeof TextDecoder==='undefined')return r.text();
  var reader=r.body.getReader();
  var parts=[];
  var got=0;
  function next(){
    return reader.read().then(function(step){
      if(step.done){
        var all_=new Uint8Array(got);var at=0;
        parts.forEach(function(p){all_.set(p,at);at+=p.length;});
        return new TextDecoder().decode(all_);
      }
      parts.push(step.value);got+=step.value.length;
      if(mine===request)bars(true,Math.min(1,got/total));
      return next();
    });
  }
  return next();
}
function apply(choice){
  var tag=resolve(choice);
  var mine=++request;
  if(tag==='en'||typeof fetch==='undefined'){bars(false);pack=null;render();return;}
  bars(true,null);
  fetch('lang/'+encodeURIComponent(tag)+'.lang',{credentials:'same-origin'}).then(function(r){
    if(!r.ok)throw new Error('no pack');
    return download(r,mine);
  }).then(function(text){
    if(mine!==request)return;
    bars(false);
    pack=forgeParseLang(text);render();
  }).catch(function(){
    if(mine!==request)return;
    bars(false);
    pack=null;render();
  });
}
var select=document.getElementById('forge-lang');
var initial=queryLang()||stored()||'auto';
if(select){
  select.value=select.getAttribute('data-auto')?initial:resolve(initial);
  select.addEventListener('change',function(){
    try{localStorage.setItem('forge-lang',select.value);}catch(e){}
    apply(select.value);
  });
}
if(languages.length)apply(initial);
${RELOAD}
})();`;

function document_(title: string, body: string, script: string, extra = ''): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body>${body}${extra}<script>${script}</script></body></html>
`;
}

export function renderPage(ir: Ir, options: { languages?: string[] } = {}): string {
  const languages = options.languages ?? [];
  const texts: Texts = [];
  const card = renderNode(ir.root, ir, texts, languages);
  const cli = ir.commands.length
    ? `<section id="forge-cli"><strong>CLI</strong><p>${ir.commands
        .map(
          (c) =>
            `<button type="button" data-command="${esc(c.flag)}" data-handler="${esc(c.handler)}">${esc(c.flag)}</button> <span${msgKey(c.description, texts)}>${esc(textOf(c.description))}</span><br>`,
        )
        .join('')}</p><div id="forge-cli-out"></div></section>`
    : '';
  const select =
    languages.length && !hasSelect(ir.root)
      ? `<p><select id="forge-lang" data-auto="1" aria-label="Language">${languageOptions(languages, true)}</select></p>`
      : '';
  // The app is the page; the language picker and the CLI panel sit below it and never shrink it.
  const tools = select || cli ? `<div id="forge-tools">${select}${cli}</div>` : '';
  const media = mediaCss(ir.root);
  const notice = hasSteps(ir.root) ? '<div id="forge-notice" hidden>The app would quit here. The preview goes back to the first step.</div>' : '';
  const body = `${media ? `<style id="forge-media">${media}</style>` : ''}${card}${notice}${tools}`;
  const json = `<script type="application/json" id="forge-ir">${safeJson({ ...ir, languages, texts })}</script>`;
  return document_(ir.root.title ? textOf(ir.root.title) : ir.app.name, body + json, APP_SCRIPT);
}

export function renderErrorPage(errors: string[]): string {
  const items = errors.map((e) => `<li><code>${esc(e)}</code></li>`).join('');
  const body = `<h1 class="forge-errors">Build errors</h1><ul>${items}</ul>`;
  return document_('forge: errors', body, RELOAD);
}
