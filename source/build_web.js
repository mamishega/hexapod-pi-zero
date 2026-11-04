// Builds the web manual (one self-contained, offline HTML file) from content.js.
// Usage: node build_web.js <out/index.html> <Wiring Schematic.svg>
const fs = require('fs');
const manual = require('./content.js');
const [out, schematicSvg] = process.argv.slice(2);
const m = manual.meta;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
const ICONS = {
  warning: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  caution: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  verify: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  note: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  planned: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const LABELS = {warning: 'Warning', caution: 'Caution', verify: 'Verify', note: 'Note', planned: 'Planned'};
const icon = kind => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg>`;

let tableNo = 0, figureNo = 0;
function statusCell(text) {
  if (text === 'Available') return '<span class="chip ok">Available</span>';
  if (text === 'Planned') return '<span class="chip plan">Planned</span>';
  if (/^(Designed|Built)/.test(text)) return `<span class="chip warn">${inline(text)}</span>`;
  return inline(text);
}
function block(b) {
  if (b.p) return `<p>${inline(b.p)}</p>`;
  if (b.bullets) return `<ul>${b.bullets.map(t => `<li>${inline(t)}</li>`).join('')}</ul>`;
  if (b.steps) return `<ol class="steps">${b.steps.map(s => {
    const item = typeof s === 'string' ? {text: s} : s;
    return `<li><div>${inline(item.text)}</div>${item.code ? codeBlock(item.code) : ''}</li>`;
  }).join('')}</ol>`;
  if (b.code) return codeBlock(b.code);
  if (b.checklist) {
    const id = b.checklist.id;
    return `<div class="checklist" data-list="${id}"><div class="checklist-head"><span class="progress" aria-live="polite"></span>
      <div class="bar"><i></i></div><button type="button" class="btn ghost small reset">Reset</button></div>
      <ul>${b.checklist.items.map((t, i) => `<li><label><input type="checkbox" data-key="${id}-${i}"><span>${inline(t)}</span></label></li>`).join('')}</ul></div>`;
  }
  if (b.table) {
    const t = b.table, status = t.head[t.head.length - 1] === 'Status';
    return `<figure class="table"><figcaption><b>Table ${++tableNo}</b> ${esc(t.caption)}</figcaption><div class="table-wrap"><table>
      <thead><tr>${t.head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map(r => `<tr>${r.map((c, i) => `<td>${status && i === r.length - 1 ? statusCell(c) : inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></figure>`;
  }
  if (b.callout) {
    const c = b.callout;
    return `<aside class="callout ${c.kind}" role="note">${icon(c.kind)}<div><p class="callout-title"><span>${LABELS[c.kind]}</span>${c.title ? ` ${esc(c.title)}` : ''}</p><p>${inline(c.text)}</p></div></aside>`;
  }
  if (b.figure) {
    return `<figure class="schematic"><div class="schematic-card">${svg}</div>
      <figcaption><b>Figure ${++figureNo}</b> ${esc(b.figure.caption)} <button type="button" class="btn ghost small" data-zoom>View full size</button></figcaption></figure>`;
  }
  return '';
}
function codeBlock(lines) {
  return `<div class="code"><pre><code>${lines.map(esc).join('\n')}</code></pre><button type="button" class="copy" aria-label="Copy command">Copy</button></div>`;
}

const svg = fs.readFileSync(schematicSvg, 'utf8').replace(/<svg /, '<svg role="img" aria-label="Wiring schematic" ').replace(/ width="1700" height="1240"/, '');

// Sections and contents
let number = 0, appendix = 0;
const toc = [], sections = [];
for (const s of manual.sections) {
  const n = s.appendix ? String.fromCharCode(65 + appendix++) : String(++number);
  const label = s.appendix ? `Appendix ${n}` : n;
  const subs = (s.subsections || []).map((sub, i) => ({...sub, n: `${n}.${i + 1}`}));
  toc.push(`<li><a href="#${s.id}"><span class="num">${label}</span>${esc(s.title)}</a>${subs.length ? `<ul>${subs.map(sub => `<li><a href="#${sub.id}"><span class="num">${sub.n}</span>${esc(sub.title)}</a></li>`).join('')}</ul>` : ''}</li>`);
  sections.push(`<section id="${s.id}" class="section" data-search><h2><span class="num">${label}</span>${esc(s.title)}</h2>
    ${(s.blocks || []).map(block).join('')}
    ${subs.map(sub => `<section id="${sub.id}" class="sub" data-search><h3><span class="num">${sub.n}</span>${esc(sub.title)}</h3>${sub.blocks.map(block).join('')}</section>`).join('')}</section>`);
}

const css = `
:root{--bg:#f6f8f9;--surface:#fff;--surface-2:#f1f5f6;--ink:#14252a;--ink-2:#3a4c52;--muted:#66787e;--rule:#dde4e7;--accent:#0d7a69;--accent-ink:#fff;--accent-soft:#e3f2ee;
--warn:#c62828;--warn-bg:#fdecea;--caution:#a35f00;--caution-bg:#fff3df;--note:#1565c0;--note-bg:#e9f1fc;--plan:#5e35b1;--plan-bg:#f0ebfa;--code-bg:#eef2f3;--mark:#ffe58a;
--shadow:0 1px 2px rgba(20,37,42,.05),0 6px 24px rgba(20,37,42,.06);--radius:12px;--top:60px;--font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0b1316;--surface:#111b1f;--surface-2:#162328;--ink:#e6eef0;--ink-2:#bccacd;--muted:#8a9ca1;--rule:#24343a;--accent:#36b9a0;--accent-ink:#05211b;--accent-soft:rgba(54,185,160,.14);
--warn:#ff8a80;--warn-bg:rgba(255,138,128,.1);--caution:#ffb74d;--caution-bg:rgba(255,183,77,.1);--note:#82b1ff;--note-bg:rgba(130,177,255,.1);--plan:#b39ddb;--plan-bg:rgba(179,157,219,.12);--code-bg:#0f1c20;--mark:#6b5a00;--shadow:none}}
:root[data-theme="dark"]{--bg:#0b1316;--surface:#111b1f;--surface-2:#162328;--ink:#e6eef0;--ink-2:#bccacd;--muted:#8a9ca1;--rule:#24343a;--accent:#36b9a0;--accent-ink:#05211b;--accent-soft:rgba(54,185,160,.14);
--warn:#ff8a80;--warn-bg:rgba(255,138,128,.1);--caution:#ffb74d;--caution-bg:rgba(255,183,77,.1);--note:#82b1ff;--note-bg:rgba(130,177,255,.1);--plan:#b39ddb;--plan-bg:rgba(179,157,219,.12);--code-bg:#0f1c20;--mark:#6b5a00;--shadow:none}
*{box-sizing:border-box}html{scroll-padding-top:calc(var(--top) + 16px);-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--font)}
a{color:var(--accent)}code{font:.9em var(--mono);background:var(--code-bg);padding:.1em .35em;border-radius:5px}
.skip{position:absolute;left:-999px;top:8px;background:var(--accent);color:var(--accent-ink);padding:8px 12px;border-radius:8px;z-index:50}.skip:focus{left:8px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.topbar{position:sticky;top:0;z-index:20;height:var(--top);display:flex;align-items:center;gap:12px;padding:0 16px;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--rule)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;white-space:nowrap;min-width:0}.brand .logo{width:28px;height:28px;flex:none}
.brand small{font-weight:500;color:var(--muted);overflow:hidden;text-overflow:ellipsis}
.search{margin-left:auto;position:relative;flex:0 1 300px;min-width:0}.search input{width:100%;height:36px;border:1px solid var(--rule);border-radius:9px;background:var(--surface-2);color:var(--ink);padding:0 12px 0 34px;font:inherit;font-size:14px}
.search svg{position:absolute;left:10px;top:9px;width:18px;height:18px;color:var(--muted)}
.btn{text-decoration:none;display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:9px;border:1px solid var(--rule);background:var(--surface);color:var(--ink);font:inherit;font-size:14px;cursor:pointer}
.btn:hover{border-color:var(--accent)}.btn.icon{width:36px;padding:0;justify-content:center}.btn svg{width:18px;height:18px}.btn.ghost{background:transparent}.btn.small{height:28px;padding:0 10px;font-size:13px}
.menu{display:none}
.layout{display:grid;grid-template-columns:290px minmax(0,1fr);max-width:1240px;margin:0 auto}
.toc{position:sticky;top:var(--top);align-self:start;height:calc(100vh - var(--top));overflow:auto;padding:24px 12px 40px 20px;border-right:1px solid var(--rule)}
.toc h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 10px 8px}
.toc ul{list-style:none;margin:0;padding:0}.toc ul ul{margin:2px 0 8px 14px;border-left:1px solid var(--rule);padding-left:6px}
.toc a{display:flex;gap:8px;padding:5px 8px;border-radius:7px;color:var(--ink-2);text-decoration:none;font-size:14px;line-height:1.35}
.toc ul ul a{font-size:13px;color:var(--muted)}.toc a:hover{background:var(--surface-2);color:var(--ink)}
.toc a.active{background:var(--accent-soft);color:var(--accent);font-weight:600}
.toc .num{min-width:22px;color:var(--muted);font-variant-numeric:tabular-nums}.toc a.active .num{color:inherit}
main{padding:32px 48px 80px;min-width:0}
.hero{background:var(--surface);border:1px solid var(--rule);border-radius:var(--radius);box-shadow:var(--shadow);padding:32px;margin-bottom:28px}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:0}
.hero h1{font-size:clamp(30px,4.5vw,44px);line-height:1.1;margin:8px 0 6px;letter-spacing:-.01em}.hero .scope{color:var(--muted);margin:0 0 22px;font-size:17px}
.meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule);border-radius:10px;overflow:hidden;margin:0}
.meta div{background:var(--surface-2);padding:10px 14px}.meta dt{font-size:12px;color:var(--muted)}.meta dd{margin:0;font-weight:700}
.hero-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.section{background:var(--surface);border:1px solid var(--rule);border-radius:var(--radius);box-shadow:var(--shadow);padding:28px 32px;margin-bottom:22px}
.section h2{display:flex;gap:12px;align-items:baseline;font-size:26px;line-height:1.25;margin:0 0 16px;padding-bottom:12px;border-bottom:2px solid var(--accent)}
.section h2 .num,.sub h3 .num{color:var(--accent);font-variant-numeric:tabular-nums}
.sub{margin-top:26px}.sub h3{display:flex;gap:10px;font-size:19px;margin:0 0 10px}
p{margin:0 0 12px}ul,ol{margin:0 0 14px;padding-left:22px}li{margin:4px 0}
ol.steps{list-style:none;counter-reset:s;padding:0}ol.steps>li{counter-increment:s;position:relative;padding-left:40px;margin:10px 0}
ol.steps>li::before{content:counter(s);position:absolute;left:0;top:0;width:26px;height:26px;border-radius:50%;background:var(--accent);color:var(--accent-ink);font-weight:700;font-size:13px;display:grid;place-items:center}
.code{position:relative;margin:8px 0 6px}.code pre{margin:0;background:var(--code-bg);border:1px solid var(--rule);border-left:3px solid var(--accent);border-radius:8px;padding:10px 70px 10px 14px;overflow-x:auto}
.code pre code{background:none;padding:0;font-size:14px}
.copy{position:absolute;right:8px;top:7px;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--rule);background:var(--surface);color:var(--ink-2);font:12px var(--font);cursor:pointer}.copy.done{color:var(--accent);border-color:var(--accent)}
figure{margin:18px 0}figcaption{font-size:13.5px;color:var(--muted);margin-bottom:8px}figcaption b{color:var(--accent);margin-right:6px}
.table-wrap{overflow-x:auto;border:1px solid var(--rule);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:14.5px}th{background:var(--accent);color:var(--accent-ink);text-align:left;font-weight:600;padding:9px 12px;white-space:nowrap}
td{padding:9px 12px;border-top:1px solid var(--rule);vertical-align:top}tbody tr:nth-child(even) td{background:var(--surface-2)}
.chip{display:inline-block;padding:1px 10px;border-radius:999px;font-size:12.5px;font-weight:700;white-space:nowrap}.chip.ok{background:var(--accent-soft);color:var(--accent)}.chip.plan{background:var(--plan-bg);color:var(--plan)}.chip.warn{background:var(--caution-bg);color:var(--caution);white-space:normal}
.callout{display:flex;gap:12px;border:1px solid var(--rule);border-left:5px solid;border-radius:10px;padding:12px 16px;margin:14px 0}
.callout .ico{flex:none;width:22px;height:22px;margin-top:2px}.callout p{margin:0}.callout-title{font-weight:700;margin-bottom:2px!important}
.callout-title span{text-transform:uppercase;letter-spacing:.06em;font-size:13px;margin-right:6px}
.warning{border-left-color:var(--warn);background:var(--warn-bg)}.warning .ico,.warning .callout-title span{color:var(--warn)}
.caution,.verify{border-left-color:var(--caution);background:var(--caution-bg)}.caution .ico,.caution .callout-title span,.verify .ico,.verify .callout-title span{color:var(--caution)}
.note{border-left-color:var(--note);background:var(--note-bg)}.note .ico,.note .callout-title span{color:var(--note)}
.planned{border-left-color:var(--plan);background:var(--plan-bg)}.planned .ico,.planned .callout-title span{color:var(--plan)}
.schematic-card{background:#fff;border:1px solid var(--rule);border-radius:10px;padding:10px;overflow:hidden}.schematic-card svg{display:block;width:100%;height:auto}
.schematic figcaption{margin:8px 0 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.checklist{border:1px solid var(--rule);border-radius:10px;padding:12px 16px;background:var(--surface-2)}
.checklist-head{display:flex;align-items:center;gap:12px;margin-bottom:6px}.progress{font-size:13px;font-weight:700;color:var(--accent);min-width:90px}
.bar{flex:1;height:6px;border-radius:9px;background:var(--rule);overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .2s}
.checklist ul{list-style:none;padding:0;margin:0}.checklist li{margin:0}.checklist label{display:flex;gap:10px;align-items:flex-start;padding:7px 4px;border-radius:7px;cursor:pointer}
.checklist label:hover{background:var(--surface)}.checklist input{width:18px;height:18px;margin-top:3px;accent-color:var(--accent);flex:none}
.checklist input:checked+span{color:var(--muted);text-decoration:line-through}
mark{background:var(--mark);color:inherit;border-radius:3px;padding:0 1px}
.hidden{display:none!important}.no-results{display:none;text-align:center;color:var(--muted);padding:40px}
.doc-footer{color:var(--muted);font-size:13.5px;text-align:center;padding:10px 0 0}
dialog{border:none;border-radius:12px;padding:0;max-width:96vw;max-height:94vh;width:1400px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.4)}
dialog::backdrop{background:rgba(6,14,17,.7)}dialog .bar-top{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #dde4e7;color:#14252a;font-weight:700}
dialog .zoom-body{overflow:auto;max-height:calc(94vh - 56px)}dialog svg{display:block;width:100%;min-width:1100px;height:auto}
dialog .btn{background:#fff;color:#14252a;border-color:#dde4e7}
.scrim{display:none}
@media (max-width:980px){main{padding:20px 16px 60px}.layout{grid-template-columns:1fr}.menu{display:inline-flex}
.toc{position:fixed;left:0;top:var(--top);bottom:0;width:min(320px,86vw);height:auto;background:var(--surface);z-index:30;transform:translateX(-102%);transition:transform .2s;border-right:1px solid var(--rule)}
body.nav-open .toc{transform:none}body.nav-open .scrim{display:block;position:fixed;inset:var(--top) 0 0 0;background:rgba(6,14,17,.45);z-index:25}
.section{padding:20px 18px}.hero{padding:22px 18px}.meta{grid-template-columns:repeat(2,minmax(0,1fr))}.brand small{display:none}}
@media (max-width:560px){.print-btn{display:none}.brand span{display:none}.search{flex-basis:auto}.section h2{font-size:22px}}
@media print{:root{--bg:#fff;--surface:#fff;--shadow:none}.topbar,.toc,.copy,.reset,.hero-actions,[data-zoom],.scrim{display:none!important}
.layout{display:block}main{padding:0}.section,.hero{border:none;box-shadow:none;padding:0;margin:0 0 18px}.section{break-before:page}
.checklist input{appearance:none;-webkit-appearance:none;border:1.5px solid #333;border-radius:3px}.checklist input:checked+span{text-decoration:none;color:inherit}
.callout,figure,tr{break-inside:avoid}body{font-size:11pt}a{color:inherit;text-decoration:none}}
`;

const js = `
(function(){
  var store={get:function(k){try{return localStorage.getItem(k)}catch(e){return null}},set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}},del:function(k){try{localStorage.removeItem(k)}catch(e){}}};
  var root=document.documentElement;
  var saved=store.get('hxp-um-theme');if(saved)root.setAttribute('data-theme',saved);
  document.getElementById('theme').addEventListener('click',function(){
    var dark=root.getAttribute('data-theme')?root.getAttribute('data-theme')==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
    var next=dark?'light':'dark';root.setAttribute('data-theme',next);store.set('hxp-um-theme',next);
  });
  document.querySelectorAll('[data-print]').forEach(function(b){b.addEventListener('click',function(){window.print()})});
  // Mobile navigation
  var body=document.body;
  document.getElementById('menu').addEventListener('click',function(){var open=body.classList.toggle('nav-open');this.setAttribute('aria-expanded',open)});
  document.querySelector('.scrim').addEventListener('click',function(){body.classList.remove('nav-open')});
  document.querySelectorAll('.toc a').forEach(function(a){a.addEventListener('click',function(){body.classList.remove('nav-open')})});
  // Scrollspy
  var links={};document.querySelectorAll('.toc a').forEach(function(a){links[a.getAttribute('href').slice(1)]=a});
  var targets=[].slice.call(document.querySelectorAll('section[id]'));
  function spy(){var y=window.scrollY+90,current=targets[0];for(var i=0;i<targets.length;i++){if(targets[i].offsetTop<=y&&!targets[i].classList.contains('hidden'))current=targets[i]}
    Object.keys(links).forEach(function(k){links[k].classList.toggle('active',current&&k===current.id)})}
  window.addEventListener('scroll',spy,{passive:true});spy();
  // Copy buttons
  document.querySelectorAll('.copy').forEach(function(btn){btn.addEventListener('click',function(){
    var text=btn.parentNode.querySelector('code').textContent;
    function done(){btn.textContent='Copied';btn.classList.add('done');setTimeout(function(){btn.textContent='Copy';btn.classList.remove('done')},1600)}
    if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(text).then(done,fallback)}else fallback();
    function fallback(){var t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();try{document.execCommand('copy');done()}catch(e){}document.body.removeChild(t)}
  })});
  // Checklists (remembered in this browser)
  document.querySelectorAll('.checklist').forEach(function(list){
    var boxes=[].slice.call(list.querySelectorAll('input'));
    function update(){var n=boxes.filter(function(b){return b.checked}).length;list.querySelector('.progress').textContent=n+' of '+boxes.length+' done';list.querySelector('.bar i').style.width=(100*n/boxes.length)+'%'}
    boxes.forEach(function(b){b.checked=store.get('hxp-um-'+b.dataset.key)==='1';b.addEventListener('change',function(){if(b.checked)store.set('hxp-um-'+b.dataset.key,'1');else store.del('hxp-um-'+b.dataset.key);update()})});
    list.querySelector('.reset').addEventListener('click',function(){boxes.forEach(function(b){b.checked=false;store.del('hxp-um-'+b.dataset.key)});update()});
    update();
  });
  // Schematic full size
  var dialog=document.getElementById('zoom');
  document.querySelectorAll('[data-zoom]').forEach(function(b){b.addEventListener('click',function(){
    var body=dialog.querySelector('.zoom-body');if(!body.firstChild)body.appendChild(document.querySelector('.schematic-card svg').cloneNode(true));
    if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','')})});
  dialog.querySelector('[data-close]').addEventListener('click',function(){dialog.close()});
  dialog.addEventListener('click',function(e){if(e.target===dialog)dialog.close()});
  // Search
  var input=document.getElementById('q'),none=document.querySelector('.no-results');
  var subs=[].slice.call(document.querySelectorAll('.sub')),sections=[].slice.call(document.querySelectorAll('.section'));
  function clearMarks(){document.querySelectorAll('mark').forEach(function(mk){var p=mk.parentNode;p.replaceChild(document.createTextNode(mk.textContent),mk);p.normalize()})}
  function markIn(el,q){var walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,{acceptNode:function(n){return n.parentNode.closest('svg,script,button')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}}),nodes=[],n;
    while((n=walker.nextNode()))nodes.push(n);
    nodes.forEach(function(node){var text=node.nodeValue,low=text.toLowerCase(),i=low.indexOf(q);if(i<0)return;var frag=document.createDocumentFragment(),last=0;
      while(i>=0){frag.appendChild(document.createTextNode(text.slice(last,i)));var mk=document.createElement('mark');mk.textContent=text.slice(i,i+q.length);frag.appendChild(mk);last=i+q.length;i=low.indexOf(q,last)}
      frag.appendChild(document.createTextNode(text.slice(last)));node.parentNode.replaceChild(frag,node)})}
  var timer;
  input.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(run,120)});
  input.addEventListener('keydown',function(e){if(e.key==='Escape'){input.value='';run()}});
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==input&&!/INPUT|TEXTAREA/.test(document.activeElement.tagName)){e.preventDefault();input.focus()}});
  function run(){
    var q=input.value.trim().toLowerCase();clearMarks();
    document.querySelectorAll('.hidden').forEach(function(el){el.classList.remove('hidden')});
    document.querySelector('.hero').classList.toggle('hidden',!!q);
    if(!q){none.style.display='none';spy();return}
    var any=false;
    sections.forEach(function(sec){
      var head=sec.querySelector('h2').textContent.toLowerCase().indexOf(q)>=0;
      var own=[].slice.call(sec.children).filter(function(c){return !c.classList.contains('sub')&&c.tagName!=='H2'}).some(function(c){return c.textContent.toLowerCase().indexOf(q)>=0});
      var hit=false;
      [].slice.call(sec.querySelectorAll('.sub')).forEach(function(s){var h=head||s.textContent.toLowerCase().indexOf(q)>=0;s.classList.toggle('hidden',!h);if(h)hit=true});
      var show=head||own||hit;sec.classList.toggle('hidden',!show);
      if(show){any=true;markIn(sec,q)}
    });
    none.style.display=any?'none':'block';
    var first=document.querySelector('mark');if(first)first.scrollIntoView({block:'center'});
  }
})();
`;

const html = `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(m.title)} User Manual</title>
<meta name="description" content="${esc(m.title)} user manual: wiring, Raspberry Pi setup, Xbox controller operation and troubleshooting.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 36'%3E%3Cpath d='M16 0l16 9v18l-16 9-16-9V9z' fill='%230d7a69'/%3E%3C/svg%3E">
<style>${css}</style>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="topbar">
  <button class="btn icon ghost menu" id="menu" aria-label="Contents" aria-expanded="false" aria-controls="toc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  <div class="brand"><svg class="logo" viewBox="0 0 32 36" aria-hidden="true"><path d="M16 0l16 9v18l-16 9-16-9V9z" fill="#0d7a69"/><path d="M16 9l8 4.5v9L16 27l-8-4.5v-9z" fill="#fff" opacity=".9"/></svg><span>${esc(m.title)}</span><small>${esc(m.subtitle)} · ${esc(m.docNo)} Rev ${esc(m.revision)}</small></div>
  <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" placeholder="Search the manual  ( / )" aria-label="Search the manual" autocomplete="off"></label>
  <button class="btn icon ghost" id="theme" aria-label="Switch light or dark theme"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>
  <button class="btn ghost print-btn" data-print aria-label="Print"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z"/></svg>Print</button>
</header>
<div class="scrim"></div>
<div class="layout">
  <nav class="toc" id="toc" aria-label="Contents"><h2>Contents</h2><ul>${toc.join('')}</ul></nav>
  <main id="content">
    <div class="hero">
      <p class="eyebrow">User manual</p>
      <h1>${esc(m.title)}</h1>
      <p class="scope">${esc(m.scope)}</p>
      <dl class="meta"><div><dt>Document</dt><dd>${esc(m.docNo)}</dd></div><div><dt>Revision</dt><dd>${esc(m.revision)}</dd></div><div><dt>Date</dt><dd>${esc(m.date)}</dd></div><div><dt>Status</dt><dd>${esc(m.status)}</dd></div></dl>
      <div class="hero-actions"><a class="btn" href="#safety">Safety first</a><a class="btn" href="#start-up">Starting up</a><a class="btn" href="#controls">Controller reference</a><a class="btn" href="#troubleshooting">Troubleshooting</a></div>
    </div>
    ${sections.join('\n')}
    <p class="no-results">No matches. Try another word, or press Esc to clear the search.</p>
    <section class="section" id="revisions"><h2><span class="num"></span>Revision history</h2>
      <div class="table-wrap"><table><thead><tr><th>Revision</th><th>Date</th><th>Description</th></tr></thead><tbody>${manual.revisions.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
    <p class="doc-footer">${esc(m.title)} ${esc(m.subtitle)} · ${esc(m.docNo)} Rev ${esc(m.revision)} · ${esc(m.date)} · ${esc(m.status)}</p>
  </main>
</div>
<dialog id="zoom" aria-label="Wiring schematic, full size"><div class="bar-top">Wiring schematic<button class="btn small" data-close>Close</button></div><div class="zoom-body"></div></dialog>
<script>${js}</script>
</body>
</html>
`;
fs.writeFileSync(out, html);
console.log('wrote', out.split('/').pop(), Math.round(html.length / 1024) + ' KB');
