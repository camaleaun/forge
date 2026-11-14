import { englishIr, textOf } from '../ir/text.ts';
import type { Ir, Node, Style } from '../ir/types.ts';

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

function styleAttr(kind: Node['kind'], style: Style): string {
  const decls: string[] = [];
  if (kind === 'window' || kind === 'view') {
    decls.push('display:flex');
    if (style.flexDirection === undefined) decls.push('flex-direction:column');
  }
  for (const [key, value] of Object.entries(style)) {
    if (!/^[a-zA-Z]+$/.test(key)) continue;
    const css = cssValue(key, value);
    if (css !== undefined) decls.push(`${cssName(key)}:${css}`);
  }
  if (kind === 'window') decls.push('box-sizing:border-box');
  return decls.length ? ` style="${esc(decls.join(';'))}"` : '';
}

function renderNode(node: Node, ir: Ir): string {
  const attrs = ` id="${esc(node.id)}"` + (node.classes.length ? ` class="${esc(node.classes.join(' '))}"` : '');
  let text = '';
  let bound = '';
  if (node.content && node.content.kind !== 'state') text = esc(textOf(node.content));
  else if (node.content?.kind === 'state') {
    const stateId = node.content.state;
    bound = ` data-state="${esc(stateId)}"`;
    const initial = ir.states.find((s) => s.id === stateId)?.initial;
    text = esc(initial ? textOf(initial) : '');
  }
  const style = styleAttr(node.kind, node.style);
  const children = node.children.map((child) => renderNode(child, ir)).join('');
  switch (node.kind) {
    case 'text':
      return `<div${attrs}${bound}${style}>${text}</div>`;
    case 'button': {
      const click = node.on?.click ? ` data-click="${esc(node.on.click)}"` : '';
      return `<button type="button"${attrs}${bound}${click}${style}>${text}</button>`;
    }
    default:
      return `<div${attrs}${style}>${children}</div>`;
  }
}

const RELOAD = `try{new EventSource('/events').onmessage=function(e){if(e.data==='reload')location.reload();};}catch(e){}`;

const CSS = `body{margin:0;padding:16px;font-family:system-ui,sans-serif;background:#eceff1;color:#222}
.card{box-shadow:0 2px 12px rgba(0,0,0,.2);background:#fff;overflow:hidden;max-width:100%}
#forge-cli{margin-top:24px;max-width:480px;font-size:13px}
#forge-cli button{margin:0 8px 8px 0}
#forge-cli-out{white-space:pre-wrap;font-family:ui-monospace,monospace;background:#111;color:#8f8;padding:8px;min-height:1em}`;

const APP_SCRIPT = `(function(){
var ir=JSON.parse(document.getElementById('forge-ir').textContent);
var handlers={};
ir.handlers.forEach(function(h){handlers[h.id]=h;});
function run(id){
  var printed=[];
  var h=handlers[id];
  if(!h)return printed;
  h.effects.forEach(function(e){
    if(e.op!=='set')return;
    var els=document.querySelectorAll('[data-state="'+e.state+'"]');
    for(var i=0;i<els.length;i++)els[i].textContent=e.value.value;
    printed.push(e.value.value);
  });
  return printed;
}
var out=document.getElementById('forge-cli-out');
var lines=[];
function on(selector,attr,show){
  var els=document.querySelectorAll(selector);
  for(var i=0;i<els.length;i++)(function(el){
    el.addEventListener('click',function(){
      var printed=run(el.getAttribute(attr));
      if(show&&out){lines.push(el.getAttribute('data-command')+': '+printed.join(' | '));out.textContent=lines.join('\\n');}
    });
  })(els[i]);
}
on('[data-click]','data-click',false);
on('[data-command]','data-handler',true);
${RELOAD}
})();`;

function document_(title: string, body: string, script: string, extra = ''): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body>${body}${extra}<script>${script}</script></body></html>
`;
}

export function renderPage(ir: Ir): string {
  const cli = ir.commands.length
    ? `<section id="forge-cli"><strong>CLI</strong><p>${ir.commands
        .map(
          (c) =>
            `<button type="button" data-command="${esc(c.flag)}" data-handler="${esc(c.handler)}">${esc(c.flag)}</button> ${esc(textOf(c.description))}<br>`,
        )
        .join('')}</p><div id="forge-cli-out"></div></section>`
    : '';
  const body = `<div class="card" style="width:fit-content;max-width:100%">${renderNode(ir.root, ir)}</div>${cli}`;
  const json = `<script type="application/json" id="forge-ir">${safeJson(englishIr(ir))}</script>`;
  return document_(ir.root.title ? textOf(ir.root.title) : ir.app.name, body + json, APP_SCRIPT);
}

export function renderErrorPage(errors: string[]): string {
  const items = errors.map((e) => `<li><code>${esc(e)}</code></li>`).join('');
  const body = `<h1 style="color:#b00020">Build errors</h1><ul>${items}</ul>`;
  return document_('forge: errors', body, RELOAD);
}
