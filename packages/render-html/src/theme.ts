// The compiler owns the design: every color is a token, redefined for dark mode.
// Categorical series colors are the validated eight-slot order from the dataviz
// reference palette (adjacent-pair CVD ΔE ≥ 8 in both modes).
import { HEX_COLOR } from '@lede-lang/core';

const LIGHT = `
  --bg:#fbfbfa; --surface:#ffffff; --fg:#16181d; --fg2:#4d515c; --muted:#6b707c; --line:#dcdde1; --line2:#c4c6cc;
  --accent:#2357c6; --accent-tint:#e9effb; --accent-line:#bccbec; --accent-ink:#1d4aa8; --good:#1c7a4a; --good-bg:#e6f4ec; --bad:#b4372f; --bad-bg:#fbeceb; --bad-line:#e9a9a3; --warn:#8a5a00; --warn-bg:#fff6e0; --warn-line:#e8c26b; --info-bg:#f1f2f4;
  --c1:#2a78d6; --c2:#eb6834; --c3:#1baf7a; --c4:#eda100; --c5:#e87ba4; --c6:#008300; --c7:#6250d6; --c8:#e34948; --cm:#b4b7bf;
  --h1:#cde2fb; --h2:#9ec5f4; --h3:#6da7ec; --h4:#5598e7; --h5:#3987e5;
  color-scheme:light;`;
const DARK = `
  --bg:#131416; --surface:#1b1c1f; --fg:#eceef1; --fg2:#b9bcc4; --muted:#9a9ea8; --line:#2e3035; --line2:#41444b;
  --accent:#7aa7ff; --accent-tint:#1b2944; --accent-line:#2f4670; --accent-ink:#9dbdff; --good:#5cc48d; --good-bg:#15291e; --bad:#f07a70; --bad-bg:#2e1715; --bad-line:#6e2f2a; --warn:#f0c062; --warn-bg:#2a2210; --warn-line:#6b5420; --info-bg:#24262b;
  --c1:#3987e5; --c2:#d95926; --c3:#199e70; --c4:#c98500; --c5:#d55181; --c6:#008300; --c7:#9085e9; --c8:#e66767; --cm:#4b4e56;
  --h1:#0d366b; --h2:#104281; --h3:#184f95; --h4:#1c5cab; --h5:#256abf;
  color-scheme:dark;`;

export function css(opts: { accent?: string; theme?: string; wide?: boolean }): string {
  const accent = opts.accent && HEX_COLOR.test(opts.accent) ? `--accent:${opts.accent};--accent-ink:${opts.accent};` : '';
  const forced =
    opts.theme === 'dark'
      ? `:root{${DARK}}`
      : opts.theme === 'light'
        ? `:root{${LIGHT}}`
        : `:root{${LIGHT}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}`;
  const col = opts.wide ? '64rem' : '46rem';
  return `${forced}
:root{${accent}
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,ui-serif,serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 var(--sans);
  padding:0 max(16px,env(safe-area-inset-right)) 0 max(16px,env(safe-area-inset-left))}
.doc{--col:${col};display:grid;grid-template-columns:minmax(0,1fr) min(var(--col),100%) minmax(0,1fr);row-gap:16px;padding:48px 0 80px}
.doc>*{grid-column:2;min-width:0;margin:0}
.doc>.wide{grid-column:1/-1;width:100%;max-width:64rem;justify-self:center}
h1,h2,h3,h4{font-family:var(--serif);line-height:1.18;text-wrap:balance;margin:0;font-weight:600;color:var(--fg)}
h1{font-size:2.5rem;letter-spacing:-.015em;line-height:1.1}
h2{font-size:1.5rem;margin-top:28px;padding-top:18px;border-top:1px solid var(--line);position:relative}
h2::before{content:"";position:absolute;top:-1px;left:0;width:40px;height:3px;background:var(--accent)}
h1+h2,.mast+h2{border-top:0;padding-top:0;margin-top:12px}
h1+h2::before,.mast+h2::before{display:none}
h3{font-size:1.18rem;margin-top:10px}
h4{font-size:1rem;margin-top:4px}
.mast{display:flex;flex-direction:column;gap:10px;padding-bottom:6px}
.mast+*{margin-top:8px}
.subtitle{font-size:1.2rem;line-height:1.45;color:var(--fg2);margin:0;text-wrap:balance}
.byline{font-size:14px;line-height:1.5;color:var(--fg2);margin:2px 0 0}
.by-n{color:var(--fg);font-weight:500}
.by-s{color:var(--muted)} .byline time{white-space:nowrap}
.lead{font-size:1.15rem;line-height:1.6;color:var(--fg2)}
p{text-wrap:pretty;orphans:2;widows:2}
ul,ol{padding-left:1.4em} li+li{margin-top:5px} li::marker{color:var(--muted)}
ul.tasks{list-style:none;padding-left:0}
li.t{display:grid;grid-template-columns:14px minmax(0,1fr);column-gap:10px;align-items:baseline}
li.t>.sub{grid-column:2}
ul.tasks>li:not(.t){padding-left:24px}
.box-c{flex:none;display:inline-block;width:14px;height:14px;border:1px solid var(--line2);border-radius:3px;transform:translateY(2px);position:relative;background:var(--surface)}
.box-c.on{background:var(--accent);border-color:var(--accent)}
.box-c.on::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid var(--surface);border-width:0 2px 2px 0;transform:rotate(45deg)}
.box-c.on+span{color:var(--fg2)}
ul.marks{list-style:none;padding-left:0}
ul.marks>li{position:relative;padding-left:26px}
ul.marks>li.yes::before,ul.marks>li.no::before{position:absolute;left:0;top:.2em;width:17px;height:17px;border-radius:50%;font:700 11px/17px var(--sans);text-align:center}
ul.marks>li.yes::before{content:"✓";color:var(--good);background:var(--good-bg)}
ul.marks>li.no::before{content:"✕";color:var(--bad);background:var(--bad-bg);font-size:10px}
ul.marks>li:not(.yes):not(.no)::before{content:"";position:absolute;left:6px;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--muted)}
ul.sub,ol.sub{margin:6px 0 2px}
ul.sub>li+li{margin-top:3px}
ul.sub{list-style:none;padding-left:18px}
ul.sub>li{position:relative}
ul.sub>li::before{content:"";position:absolute;left:-14px;top:.78em;width:7px;height:1.5px;background:var(--muted)}
ul.sub.tasks{padding-left:0} ul.sub.tasks>li::before{display:none}
a{color:var(--accent);text-underline-offset:2px} a:focus-visible,[tabindex]:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
code{font:.88em var(--mono);background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:.05em .3em;overflow-wrap:anywhere}
hr{border:0;border-top:1px solid var(--line);width:100%;margin:8px 0}
blockquote{position:relative;padding:4px 0 4px 44px;color:var(--fg)}
blockquote::before{content:"\\201C";position:absolute;left:0;top:-4px;font:700 3.6rem/1 var(--serif);color:var(--accent)}
blockquote p{margin:0;font:italic 1.3rem/1.45 var(--serif);text-wrap:pretty}
blockquote cite{display:block;font:600 13px/1.4 var(--sans);font-style:normal;color:var(--fg2);margin-top:10px;letter-spacing:.01em}
.note{background:var(--accent-tint);border:1px solid var(--accent-line);border-left:3px solid var(--accent);border-radius:8px;padding:12px 16px}
.note b.nl{display:block;font:700 11px/1.4 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:3px}
.note .nt{display:block;font-weight:650;margin-bottom:2px}
.note.warn{background:var(--warn-bg);border-color:var(--warn-line);border-left-color:var(--warn)}
.note.warn b.nl{color:var(--warn)}
.note.danger{background:var(--bad-bg);border-color:var(--bad-line);border-left-color:var(--bad)}
.note.danger b.nl{color:var(--bad)}
.pill{display:inline-block;font-size:12.5px;font-weight:600;line-height:1.4;padding:1px 8px 1px 18px;border-radius:999px;position:relative;white-space:nowrap;background:var(--info-bg);color:var(--fg2)}
.pill::before{content:"";position:absolute;left:7px;top:50%;width:6px;height:6px;margin-top:-3px;border-radius:50%;background:currentColor}
.pill.good{background:var(--good-bg);color:var(--good)} .pill.warn{background:var(--warn-bg);color:var(--warn)} .pill.bad{background:var(--bad-bg);color:var(--bad)}
.pill strong{font-weight:inherit}
ol{list-style:none;padding-left:0;counter-reset:step}
ol>li{counter-increment:step;position:relative;padding-left:38px;min-height:24px}
ol>li::before{content:counter(step);position:absolute;left:0;top:1px;width:24px;height:24px;border-radius:50%;border:1px solid var(--line2);font:600 12px/22px var(--mono);text-align:center;color:var(--fg2);background:var(--surface)}
ol>li+li{margin-top:10px}
ol.sub{counter-reset:sub;margin-top:8px}
ol.sub>li{counter-increment:sub;padding-left:34px;min-height:0}
ol.sub>li+li{margin-top:4px}
ol.sub>li::before{content:counter(step) "." counter(sub);width:auto;height:auto;border:0;border-radius:0;background:none;font:500 12.5px/1.3 var(--mono);top:.25em;text-align:left;color:var(--muted)}
ol.sub.alpha>li::before{content:counter(sub,lower-alpha) "."}
ol.sub.tasks>li{padding-left:0} ol.sub.tasks>li::before{display:none}
pre.code{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow-x:auto;margin:0}
pre.code[data-lang]{padding-top:32px}
pre.code[data-lang]::before{content:attr(data-lang);position:absolute;top:10px;left:16px;font:600 10.5px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
pre.code code{background:none;border:0;padding:0;font-size:13px;line-height:1.6;white-space:pre;overflow-wrap:normal}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr));gap:12px}
.kpi{display:flex;flex-direction:column;gap:5px;padding:14px 16px 15px;background:var(--surface);border:1px solid var(--line);border-radius:10px;min-width:0}
.kl{font:600 11.5px/1.35 var(--sans);letter-spacing:.07em;text-transform:uppercase;color:var(--fg2)}
.kv{font:600 2.1rem/1.08 var(--serif);font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.01em;overflow-wrap:anywhere;color:var(--fg)}
.kv.good{color:var(--good)} .kv.bad{color:var(--bad)}
.kd{font:600 13px/1.3 var(--sans);font-variant-numeric:tabular-nums;color:var(--fg2);align-self:flex-start}
.kd.good{color:var(--good)} .kd.bad{color:var(--bad)}
.kn{font-size:13px;line-height:1.4;color:var(--fg2)}
.kpis.solo{display:block}
.kpi.hero{align-items:center;text-align:center;gap:8px;padding:36px 24px 34px;border-radius:14px}
.kpi.hero .kl{font-size:13px;letter-spacing:.1em}
.kpi.hero .kv{font-size:clamp(4rem,13vw,7rem);line-height:.95;letter-spacing:-.03em;margin:6px 0 4px}
.kpi.hero .kd{align-self:center;font-size:15px;padding:3px 10px;border-radius:999px;background:var(--info-bg)}
.kpi.hero .kd.good{background:var(--good-bg)} .kpi.hero .kd.bad{background:var(--bad-bg)}
.kpi.hero .kn{font-size:15px;max-width:36rem}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px 20px;min-width:0;display:flex;flex-direction:column;gap:10px}
.card>*{margin:0}
.card>h2,.card>h3,.card>h4{border:0;padding:0;margin:0;font-size:1.12rem;line-height:1.3}
.card>h2::before{display:none}
.cards{display:grid;gap:14px;align-items:stretch}
.cards.n2{grid-template-columns:repeat(2,minmax(0,1fr))}
.cards.n3{grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))}
.cl{font:700 11px/1.3 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--fg2);margin-top:4px}
.cl.yes{color:var(--good)} .cl.no{color:var(--bad)}
.card.pc{border-top:3px solid var(--good)} .card.pc.no{border-top-color:var(--bad)}
.card.pc>:first-child{color:var(--good)} .card.pc.no>:first-child{color:var(--bad)}
.faqs{display:flex;flex-direction:column;gap:12px;margin-top:4px}
.card.faq{padding:18px 22px 20px;gap:8px}
.card.faq>h2,.card.faq>h3{font-size:1.15rem}
.card .note{padding:10px 14px}
.card.set ul.marks>li.yes,.card.set ul.marks>li.no{padding:8px 12px 8px 38px;border-radius:7px;background:var(--good-bg)}
.card.set ul.marks>li.no{background:var(--bad-bg)}
.card.set ul.marks>li.yes::before,.card.set ul.marks>li.no::before{left:12px;top:calc(8px + .2em);background:var(--surface)}
.card.set ul.marks>li+li{margin-top:6px}
.prose{font:1.125rem/1.72 var(--serif);--col:37rem}
.prose h2{font-size:1.55rem;margin-top:36px;padding-top:0;border-top:0}
.prose h2::before{display:none}
.prose h3{font-size:1.22rem;margin-top:20px}
.prose h2+*,.prose h3+*{margin-top:-4px}
.prose .byline,.prose .subtitle{font-family:var(--sans)}
.prose .mast{padding-bottom:22px;margin-bottom:8px;border-bottom:1px solid var(--line)}
.prose .mast+h2{margin-top:20px}
.prose .lead{font-size:1.32rem;line-height:1.55;color:var(--fg)}
.prose blockquote{margin:16px 0;padding:22px 0 20px;border-top:2px solid var(--fg);border-bottom:1px solid var(--line)}
.prose blockquote::before{position:static;display:block;height:.5em;margin-bottom:2px;font-size:4.2rem;line-height:1}
.prose blockquote p{font-size:1.6rem;line-height:1.32;letter-spacing:-.005em}
.prose .note{font-family:var(--sans);font-size:1rem;line-height:1.6}
.prose li+li{margin-top:8px}
.prose ol>li::before{top:4px}
@media (max-width:560px){
  .mast{gap:8px} .subtitle{font-size:1.08rem} .doc>h2{margin-top:20px;padding-top:14px}
  .cards.n2{grid-template-columns:minmax(0,1fr)} .card{padding:14px 16px;gap:8px} .cards,.faqs{gap:10px}
  blockquote{padding-left:36px} blockquote::before{font-size:3rem}
  .kpis:not(.solo){grid-template-columns:repeat(2,minmax(0,1fr))} .kpis>.kpi:last-child:nth-child(odd){grid-column:1/-1}
  .kpi{padding:12px 14px} .kpi.hero{padding:28px 18px 26px}
  .lead{font-size:1.06rem} pre.code code{white-space:pre-wrap;overflow-wrap:anywhere}
  .prose{font-size:1.0625rem} .prose .lead{font-size:1.2rem} .prose blockquote{padding-left:0} .prose blockquote p{font-size:1.35rem}}
.viz{display:flex;flex-direction:column;gap:8px;min-width:0;margin:0}
.chart-fig,.dg-fig{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px}
@media (max-width:560px){.chart-fig,.dg-fig{padding:12px 8px}}
figcaption{font:600 12px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--fg2)}
.scroll{overflow-x:auto;min-width:0;-webkit-overflow-scrolling:touch}
.chart{display:block;width:100%;height:auto;overflow:visible}
.chart-narrow{display:none}
@media (max-width:560px){.chart-wide{display:none}.chart-narrow{display:block}}
.chart .grid{stroke:var(--line);stroke-width:1;shape-rendering:crispEdges}
.chart .grid.zero{stroke:var(--line2)}
.chart text{font-family:var(--sans);font-size:12px;fill:var(--muted)}
.chart .cat,.chart .end{fill:var(--fg2)}
.chart .val{fill:var(--fg);font-variant-numeric:tabular-nums}
.chart .line{stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.chart .area{opacity:.16}
.chart .dot{stroke:var(--surface);stroke-width:2}
.chart .pt{stroke:var(--surface);stroke-width:1.5}
.chart .target{stroke:var(--fg2);stroke-width:1.25;stroke-dasharray:5 4}
.chart .target-l{fill:var(--fg2);font-size:12px;font-weight:600;paint-order:stroke;stroke:var(--surface);stroke-width:4px}
.chart .hit{fill:transparent}
.chart .hit:hover{fill:var(--fg);fill-opacity:.08}
.c1{color:var(--c1)}.c2{color:var(--c2)}.c3{color:var(--c3)}.c4{color:var(--c4)}.c5{color:var(--c5)}.c6{color:var(--c6)}.c7{color:var(--c7)}.c8{color:var(--c8)}.cm{color:var(--cm)}
.legend{display:flex;gap:4px 16px;flex-wrap:wrap;font-size:13px;color:var(--fg2)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{width:10px;height:10px;border-radius:2px;background:currentColor}
details.data summary{cursor:pointer;font:12px var(--mono);color:var(--muted);width:max-content}
details.data table{margin-top:8px}
table{border-collapse:collapse;width:100%;font-size:14px;font-variant-numeric:tabular-nums}
caption{text-align:left;font:600 12px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--fg2);padding-bottom:8px}
th{text-align:left;font-weight:600;color:var(--fg2);font-size:12px;letter-spacing:.04em;text-transform:uppercase;border-bottom:1px solid var(--fg2);padding:6px 12px 6px 0}
tbody th{text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg);border-bottom:1px solid var(--line);font-weight:500}
td{border-bottom:1px solid var(--line);padding:8px 12px 8px 0;vertical-align:top}
td.n,th.n{text-align:right;white-space:nowrap} td.nw{white-space:nowrap}
td:last-child,th:last-child{padding-right:0}
.tbl{background:var(--surface);border:1px solid var(--line);border-radius:10px}
table.lt caption{padding:12px 16px 10px;border-bottom:1px solid var(--line)}
table.lt th,table.lt td{padding:10px 14px;vertical-align:middle}
table.lt thead th{background:var(--info-bg);border-bottom:1px solid var(--line);padding-top:9px;padding-bottom:9px;font-size:11.5px;letter-spacing:.06em}
table.lt tbody tr:last-child>*{border-bottom:0}
table.lt tbody th{font-weight:600;white-space:normal;min-width:7rem}
table.lt.rh tbody th,table.lt.rh thead th:first-child{position:sticky;left:0;z-index:1;background:var(--hl-bg,var(--surface))}
table.lt.rh thead th:first-child{background:var(--info-bg)}
table.lt tr.hl>*{background:var(--hl-bg)}
table.lt tr.hl>:first-child{box-shadow:inset 3px 0 0 var(--hl-edge)}
table.lt tr.hl.pick{--hl-bg:var(--accent-tint);--hl-edge:var(--accent)}
table.lt tr.hl.pick strong{color:var(--accent-ink)}
table.lt tr.hl.bad{--hl-bg:var(--bad-bg);--hl-edge:var(--bad)}
table.lt tr.hl.warn{--hl-bg:var(--warn-bg);--hl-edge:var(--warn)}
@media (max-width:520px){
  table.lt{font-size:13px} table.lt th,table.lt td{padding:8px 7px}
  table.lt thead th{font-size:10.5px;letter-spacing:.04em;white-space:normal;vertical-align:bottom}
  table.lt tbody th{min-width:0}
  table.lt.tight{font-size:12px} table.lt.tight th,table.lt.tight td{padding:7px 5px} table.lt.tight thead th{font-size:10px;letter-spacing:.02em}
  table.lt.stack td:empty{display:none}
  .tbl.stack{background:none;border:0;border-radius:0;overflow:visible}
  table.stack,table.stack tbody,table.stack caption{display:block}
  table.stack caption{padding:0 0 8px;border:0}
  table.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  table.stack tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:0 14px 10px;margin-bottom:8px}
  table.stack tr:last-child{margin-bottom:0}
  table.stack tr.hl{background:var(--hl-bg);box-shadow:inset 3px 0 0 var(--hl-edge)}
  table.stack tr.hl>:first-child{box-shadow:none}
  table.lt.stack tbody th{grid-column:1/-1;display:block;text-align:left;font-size:14.5px;padding:10px 0 8px;border-bottom:1px solid var(--line);position:static;background:none;white-space:normal}
  table.lt.stack td{display:block;padding:8px 0 0;border:0;text-align:left;white-space:normal;min-width:0;background:none;font-size:14px}
  table.lt.stack td.w{grid-column:1/-1}
  table.stack.trio tr{grid-template-columns:repeat(3,minmax(0,1fr));column-gap:10px}
  table.stack td::before{content:attr(data-label);display:block;font:600 10.5px/1.3 var(--sans);letter-spacing:.05em;text-transform:uppercase;color:var(--fg2);margin-bottom:2px}
}
.lgrid{display:grid;gap:16px;grid-template-columns:repeat(var(--cols),minmax(0,1fr));align-items:start}
@media (max-width:720px){.lgrid{grid-template-columns:minmax(0,1fr)}}
.lgrid>*{margin:0;min-width:0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
img{max-width:100%;height:auto;border-radius:6px;display:block}
figure.img{margin:0;display:flex;flex-direction:column;gap:8px}
figure.img figcaption{text-transform:none;letter-spacing:0;font:14px/1.4 var(--sans);color:var(--muted)}
.img-blocked{border:1px dashed var(--line2);border-radius:6px;padding:16px;color:var(--muted);font-size:14px}
.dg-fig .scroll{padding-bottom:4px}
.dg-fig{justify-self:center;width:100%;max-width:min(var(--w),100%)}
.doc>.wide.dg-fig{max-width:min(var(--w),64rem)}
@media (max-width:560px){.dg-fig,.doc>.wide.dg-fig{max-width:min(var(--wv,var(--w)),100%)}}
.dg-wrap{margin:0 auto;min-width:var(--minw)}
.dg-v{display:none;max-width:var(--wv);margin:0 auto}
@media (max-width:560px){.dg-h{display:none}.dg-v{display:block}.dg-wrap{min-width:var(--minwv,var(--minw))}}
.dg{display:block;width:100%;height:auto}
.dg text{font-family:var(--sans)}
.dg .grp{fill:none;stroke:var(--line2);stroke-width:1;stroke-dasharray:4 3}
.dg .glabel{font:600 10px var(--mono);letter-spacing:.06em;fill:var(--muted)}
.dg .edge{fill:none;stroke:var(--muted);stroke-width:1.25}
.dg .edge.dash{stroke-dasharray:5 4}
.dg .edge.hot{stroke:var(--accent);stroke-width:1.5}
.dg .ah{fill:var(--muted)}
.dg .lmask{fill:var(--surface)}
.dg .elabel{font:500 10px var(--mono);letter-spacing:.04em;fill:var(--fg2)}
.dg .box{fill:var(--surface);stroke:var(--line2);stroke-width:1}
.dg .name{font-size:13px;font-weight:600;fill:var(--fg)}
.dg .sub{font:10px var(--mono);fill:var(--muted)}
.dg .tag{fill:none;stroke:var(--line2);stroke-width:1}
.dg .tagt{font:600 9px var(--mono);letter-spacing:.06em;fill:var(--muted)}
.dg .node.focus .box{fill:var(--accent-tint);stroke:var(--accent);stroke-width:1.5}
.dg .node.focus .tag{stroke:var(--accent)} .dg .node.focus .tagt{fill:var(--accent)}
.dg .node.k-ext .box,.dg .node.k-external .box{stroke-dasharray:4 3}
.dg .node.k-user .box,.dg .node.k-client .box,.dg .node.k-actor .box{fill:var(--bg)}
.dg .life{stroke:var(--line2);stroke-width:1;stroke-dasharray:2 4}
.dg .seqn{font:10px var(--mono);fill:var(--muted)}
.dg .note-box{fill:var(--warn-bg);stroke:var(--warn-line);stroke-width:1}
.dg .note-t{font-size:11px;fill:var(--fg)}
@media (max-width:560px){h1{font-size:1.9rem} h2{font-size:1.3rem} .doc{padding-top:24px} .kv{font-size:1.6rem}}
@media print{body{background:#fff} .chart-narrow{display:none!important} .chart-wide{display:block!important} details.data{display:none}}
/* stream-a: chart event markers */
.chart .mk-rule{stroke:var(--muted);stroke-width:1;shape-rendering:crispEdges}
.chart .mk-pole{stroke:var(--fg2);stroke-width:2}
.chart .mk-dot{fill:var(--muted)}
.chart .mk-band{fill:var(--fg);fill-opacity:.05}
.chart .mk-flag{fill:var(--info-bg);stroke:var(--line2);stroke-width:1}
.chart .mk-t{fill:var(--fg);font-size:12px;font-weight:600}
.chart .mk-hit{fill:transparent}
.chart .tick.mk-x{fill:var(--fg);font-weight:600}
/* end stream-a */
/* stream-b */
.dg .node.dec .box{fill:var(--warn-bg);stroke:color-mix(in srgb,var(--warn) 55%,var(--surface));stroke-width:1.25}
.dg .node.dec.focus .box{fill:var(--accent-tint);stroke:var(--accent);stroke-width:1.5}
.dg .elabel.yes{fill:var(--good);font-weight:700}
.dg .elabel.no{fill:var(--bad);font-weight:700}
.dg .fr{fill:none;stroke:var(--muted);stroke-width:1}
.dg .fr-tag{fill:var(--fg2)}
.dg .fr-k{font:700 9px var(--mono);letter-spacing:.06em;fill:var(--surface)}
.dg .fr-e{font:700 9px var(--mono);letter-spacing:.06em;fill:var(--fg2)}
.dg .fr-t{font:500 11px var(--sans);fill:var(--fg)}
.dg .fr-div{stroke:var(--muted);stroke-width:1;stroke-dasharray:5 4}
/* /stream-b */
/* stream 3.1 */
.by-r{color:var(--muted)}code{white-space:nowrap}code.brk{white-space:normal}
th{white-space:normal;hyphens:manual}
thead th.n{white-space:normal}
.lgrid>*{overflow-wrap:anywhere}
.lgrid>*,.lgrid>*>*{max-width:100%}
.kpi{container-type:inline-size}
.kv{white-space:nowrap;overflow-wrap:normal}
.kpi .kv{font-size:min(2.1rem,calc(100cqw / var(--kvn,1) * 1.5))}
.kpi.hero .kv{font-size:min(clamp(4rem,13vw,7rem),calc(var(--col) / var(--kvn,1) * 1.55))}
@media (max-width:560px){
  .kpi .kv{font-size:min(1.6rem,calc(100cqw / var(--kvn,1) * 1.5))}
  .kpi.hero .kv{font-size:min(clamp(4rem,13vw,7rem),calc(100vw / var(--kvn,1) * 1.3))}
}
@supports (width:1cqw){
  .kpi.hero .kv{font-size:min(clamp(4rem,13vw,7rem),calc(100cqw / var(--kvn,1) * 1.5))}
  @media (max-width:560px){.kpi.hero .kv{font-size:min(clamp(4rem,13vw,7rem),calc(100cqw / var(--kvn,1) * 1.5))}}
}
.kv.long{white-space:normal;overflow-wrap:anywhere;font-size:1.45rem;line-height:1.2}
.kpi.hero .kv.long{font-size:2.4rem}
@media (max-width:560px){.kv.long{font-size:1.25rem}.kpi.hero .kv.long{font-size:1.9rem}}
/* end stream 3.1 */
/* stream 3.2 */
.chart .ybreak{stroke:var(--fg2);stroke-width:1.5;stroke-linecap:round}
@media (min-width:721px){.chart-cell~.chart-narrow{display:none}}
@media (max-width:720px){.chart-wide.chart-cell{display:none}.chart-cell~.chart-narrow{display:block}}
.barlist{container-type:inline-size;display:flex;flex-direction:column;gap:14px}
.bl{display:flex;flex-wrap:wrap;align-items:center;column-gap:10px;row-gap:5px;min-width:0}
.bl-l{flex:0 0 100%;font-size:15px;line-height:1.3;color:var(--fg);overflow-wrap:anywhere}
.bl-b{flex:0 0 auto;width:calc(var(--w) * .62);min-width:3px;height:14px;border-radius:0 4px 4px 0;background:var(--c1)}
.bl-v{flex:none;font-size:15px;line-height:1.3;font-variant-numeric:tabular-nums;font-weight:600;color:var(--fg);white-space:nowrap}
@container (min-width:400px){.bl-b{width:calc(var(--w) * .74)}}
@container (min-width:560px){.bl-b{width:calc(var(--w) * .82)}}
.barlist.focus .bl:not(.on) .bl-b{background:var(--cm)}
.barlist.focus .bl:not(.on) .bl-l,.barlist.focus .bl:not(.on) .bl-v{color:var(--muted);font-weight:400}
.barlist.focus .bl.on .bl-l{font-weight:600}
/* end stream 3.2 */
/* stream 3.3 */
.dg-v[data-flow] .dg .sub,.dg-v[data-flow] .dg .tagt,.dg-v[data-flow] .dg .elabel,.dg-v[data-flow] .dg .glabel{font-size:12px}
.dg .edge.blocked{stroke:var(--bad);stroke-dasharray:5 4}
.dg .elabel.blocked{fill:var(--bad);font-weight:700}
.dg .blk circle{fill:var(--surface);stroke:var(--bad);stroke-width:1.5}
.dg .blk path{fill:none;stroke:var(--bad);stroke-width:1.5;stroke-linecap:round}
/* the flow legend: the div after the drawing (selected by position, since the class name is searched for in the markup) */
.dg-fig>.scroll+div{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.dg-fig>.scroll+div .tag{font:600 11px var(--mono);letter-spacing:.06em;color:var(--fg2);border:1px solid var(--line2);border-radius:2px;padding:1px 6px}
/* a flow too wide to draw legibly on a phone: the edge list (groups as uncounted frame rows) */
.flowlist>li.blocked::after{content:" (blocked)";color:var(--bad);font-weight:600;font-size:14px}
/* end stream 3.3 */
/* stream 3.4 */
.dg.seq .elabel{font-size:12px}
.dg .pfr{fill:none;stroke:var(--muted);stroke-width:1}
.dg .pfr-tag{fill:var(--fg2)}
.dg .pfr-k{font:700 12px var(--mono);letter-spacing:.06em;text-transform:uppercase;fill:var(--surface)}
.dg .pfr-e{font:700 12px var(--mono);letter-spacing:.06em;text-transform:uppercase;fill:var(--fg2)}
.dg .pfr-t{font:500 12px var(--sans);fill:var(--fg)}
.dg .pfr-div{stroke:var(--muted);stroke-width:1;stroke-dasharray:5 4}
.dg-v .dg.seq :is(.elabel,.seqn,.tagt,.sub,.note-t){font-size:12px}
.dg-v .dg.seq .name{font-size:13px}
.seqlist{counter-reset:sq;margin:0;font:15px/1.45 var(--sans);color:var(--fg)}
.seqlist>li{counter-increment:sq;margin:0;min-height:0;padding:7px 0 7px 38px;overflow-wrap:anywhere}
.seqlist>li::before{content:counter(sq);top:7px;width:26px;height:26px;font:600 14px/24px var(--mono)}
.seqlist b{font-weight:600}
.seqlist>li.reply{color:var(--fg2)}
.seqlist>li.reply::after{content:" (reply)";color:var(--muted);font-size:14px}
.seqlist>li.in{margin-left:4px;padding-left:46px;border-left:3px solid var(--muted)}
.seqlist>li.in::before{left:9px}
.seqlist>li.frame,.seqlist>li.note{counter-increment:none}
.seqlist>li.frame::before,.seqlist>li.note::before{display:none}
.seqlist>li.frame{margin:8px 0 2px;padding:6px 10px;border-left:3px solid var(--muted);background:var(--surface);font-weight:600;font-size:14px;line-height:1.4;letter-spacing:.02em}
.seqlist>li.note{margin:6px 0 6px 38px;padding:6px 10px;font-size:14px;line-height:1.4;background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:4px}
/* end stream 3.4 */
/* stream v04-3 */
.dg-h .dg.seq .tagt,.dg-h .dg.seq .fr-k,.dg-h .dg.seq .fr-e{font-size:10px}
.dg-h .dg.seq .seqn{font-size:11px}
.dg-h .dg.seq :is(.note-t,.fr-t){font-size:12px}
.dg-fig>.scroll+.dg-key{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}
.dgk{display:inline-flex;align-items:center;gap:7px;font:12px/1.3 var(--sans);color:var(--fg2)}
.dgk-sw{flex:none;display:block;overflow:visible}
.dgk-sw .box{fill:var(--surface);stroke:var(--line2);stroke-width:1}
.dgk-sw .k-ext .box,.dgk-sw .k-external .box{stroke-dasharray:4 3}
.dgk-sw .k-user .box,.dgk-sw .k-client .box,.dgk-sw .k-actor .box{fill:var(--bg)}
.dgk-sw .dec .box{fill:var(--warn-bg);stroke:color-mix(in srgb,var(--warn) 55%,var(--surface));stroke-width:1.25;stroke-linejoin:round}
.dgk-sw .focus .box{fill:var(--accent-tint);stroke:var(--accent);stroke-width:1.5}
.dgk-sw .grp{fill:none;stroke:var(--line2);stroke-width:1;stroke-dasharray:4 3}
.dgk-sw .edge{fill:none;stroke:var(--muted);stroke-width:1.25}
.dgk-sw .edge.dash{stroke-dasharray:5 4}
.dgk-sw .edge.blocked{stroke:var(--bad);stroke-dasharray:5 4}
.dgk-sw .ah{fill:var(--muted)}
.dgk-sw .blk circle{fill:var(--surface);stroke:var(--bad);stroke-width:1.5}
.dgk-sw .blk path{fill:none;stroke:var(--bad);stroke-width:1.5;stroke-linecap:round}
/* end stream v04-3 */
/* stream 5.1 */
table.lt td[class*=" h"],table.lt td.h1,table.lt td.h2,table.lt td.h3,table.lt td.h4,table.lt td.h5{color:var(--fg)}
table.lt td.h1{background:var(--h1)} table.lt td.h2{background:var(--h2)} table.lt td.h3{background:var(--h3)} table.lt td.h4{background:var(--h4)} table.lt td.h5{background:var(--h5)}
table.lt.stack td.h1,table.lt.stack td.h2,table.lt.stack td.h3,table.lt.stack td.h4,table.lt.stack td.h5{padding:8px 8px;margin-top:8px;border-radius:6px}
table.lt.stack td.h1{background:var(--h1)} table.lt.stack td.h2{background:var(--h2)} table.lt.stack td.h3{background:var(--h3)} table.lt.stack td.h4{background:var(--h4)} table.lt.stack td.h5{background:var(--h5)}
.heat-legend{display:flex;align-items:center;gap:0;margin:6px 0 0;font:12px/1.4 var(--sans);color:var(--muted)}
.heat-legend i{display:block;width:22px;height:10px}
.heat-legend i:first-child{border-radius:3px 0 0 3px} .heat-legend i:nth-child(5){border-radius:0 3px 3px 0;margin-right:8px}
.heat-legend .h1{background:var(--h1)} .heat-legend .h2{background:var(--h2)} .heat-legend .h3{background:var(--h3)} .heat-legend .h4{background:var(--h4)} .heat-legend .h5{background:var(--h5)}
.cb{position:relative;display:block;min-width:5rem;padding:2px 8px;text-align:right;isolation:isolate;font-variant-numeric:tabular-nums}
.cb>i{position:absolute;z-index:-1;left:0;top:0;bottom:0;width:var(--p);background:var(--accent-line);border-radius:3px;opacity:.8}
table.lt.tight .cb{min-width:3.5rem}
table.lt.stack td .cb{min-width:0;padding:3px 8px;text-align:left}
table.lt th.pick,table.lt td.pick:not(.h1):not(.h2):not(.h3):not(.h4):not(.h5){background:var(--accent-tint)}
table.lt th.pick{color:var(--accent-ink);box-shadow:inset 0 3px 0 var(--accent)}
table.lt.stack td.pick{padding:8px 8px;border-radius:6px}
.tblx{display:flex;flex-direction:column;gap:8px;min-width:0}
.tlwrap{min-width:0}
.tl-unit{margin:0 0 8px;font:12px/1.4 var(--mono);color:var(--muted)}
.tl-cap{margin:0 0 8px;font:600 14px/1.4 var(--sans);color:var(--fg2)}
ol.timeline{list-style:none;margin:0;padding:0 0 0 22px;position:relative}
ol.timeline::before{content:"";position:absolute;left:5px;top:10px;bottom:10px;width:2px;background:var(--line2)}
ol.timeline>li{position:relative;display:grid;grid-template-columns:minmax(4.5rem,max-content) minmax(0,1fr);column-gap:16px;align-items:baseline;padding:7px 0}
ol.timeline>li::before{content:"";position:absolute;left:-22px;top:14px;width:12px;height:12px;box-sizing:border-box;border-radius:50%;background:var(--surface);border:2px solid var(--muted)}
ol.timeline>li.em::before{background:var(--accent);border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-tint)}
ol.timeline time{font:600 13.5px/1.5 var(--mono);color:var(--fg2);white-space:nowrap}
ol.timeline>li.em time{color:var(--accent-ink)}
ol.timeline span{min-width:0;overflow-wrap:anywhere}
@media (max-width:520px){
  ol.timeline>li{grid-template-columns:minmax(0,1fr);row-gap:1px;padding:6px 0}
}
/* end stream 5.1 */
/* stream 5.2 */
.card.rec{border-left:4px solid var(--accent);gap:8px}
.card.rec>p{font-size:1rem;line-height:1.6}
.card.rec>.note{background:none;border:0;border-radius:0;padding:0}
.card.rec>.note b.nl{display:none}
.card.rec>.rec-t{font-size:1.12rem;line-height:1.4;color:var(--fg)}
.card.rec>.rec-t strong{font-weight:700}
ol.steps.cards{display:flex;flex-direction:column;gap:12px;padding:0}
ol.steps.cards>li{display:grid;grid-template-columns:32px minmax(0,1fr);column-gap:14px;row-gap:6px;align-items:start;margin:0;min-height:0;padding:16px 20px;background:var(--surface);border:1px solid var(--line);border-radius:12px}
ol.steps.cards>li::before{display:none}
ol.steps.cards>li>.n{grid-row:1/span 2;width:32px;height:32px;border-radius:50%;background:var(--accent);color:var(--bg);font:700 14px/32px var(--mono);text-align:center}
ol.steps.cards>li>b{grid-column:2;font-size:1.05rem;line-height:1.35;color:var(--fg);padding-top:3px}
ol.steps.cards>li>div{grid-column:2;min-width:0;color:var(--fg2)}
ol.steps.cards>li>div>ul.sub,ol.steps.cards>li>div>ol.sub{margin:8px 0 0}
@media (max-width:560px){
  ol.steps.cards>li{grid-template-columns:28px minmax(0,1fr);column-gap:10px;padding:12px 14px}
  ol.steps.cards>li>.n{width:28px;height:28px;font-size:13px;line-height:28px}
}
/* end stream 5.2 */
/* stream v04-1 */
.s-good{color:var(--good)}.s-warn{color:var(--warn)}.s-bad{color:var(--bad)}.s-none{color:var(--muted)}
.chart .hatch-s{fill:var(--surface)}
.chart .hatch{pointer-events:none}
.legend i.hatch-k{background:repeating-linear-gradient(135deg,var(--fg2) 0 2px,transparent 2px 4px);box-shadow:inset 0 0 0 1px var(--fg2)}
.chart .seg-v{paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}
.chart .rg-band{stroke:var(--muted);stroke-width:1;stroke-dasharray:2 3}
.chart .rg-band-l{fill:var(--fg2);font-weight:600;paint-order:stroke;stroke:var(--surface);stroke-width:4px}
.chart .rg-at{fill:var(--fg);stroke:var(--surface);stroke-width:2}
.legend i.rg-at-k{border-radius:50%;background:var(--fg)}
/* end stream v04-1 */
/* stream v04-2 */
.chip{display:inline-block;font-size:12.5px;font-weight:600;line-height:1.4;padding:1px 8px;border-radius:999px;white-space:nowrap;background:var(--info-bg);color:var(--fg);border:1px solid var(--line2);font-variant-numeric:tabular-nums}
.chip strong{font-weight:inherit}
.kn>.chip,.kn>.pill{vertical-align:baseline}
.cards.lcards{grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:16px}
@media (max-width:720px){.cards.lcards{grid-template-columns:minmax(0,1fr)}}
.card.lc{container:lcard/inline-size}
.card.lc>.kpis{grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr))}
.card.lc>*{max-width:100%}
.card.lc{overflow-wrap:anywhere}
.card.lc.rec{border-left:4px solid var(--accent)}
.card.lc.rec>.note{background:var(--accent-tint);border:1px solid var(--accent-line);border-left:3px solid var(--accent);border-radius:8px;padding:10px 14px}
.card.lc.rec>.note.warn{background:var(--warn-bg);border-color:var(--warn-line);border-left-color:var(--warn)}
.card.lc.rec>.note.danger{background:var(--bad-bg);border-color:var(--bad-line);border-left-color:var(--bad)}
.card.lc.rec>.note b.nl{display:block}
.kbar{display:block;align-self:stretch;height:8px;border-radius:999px;background:var(--line);overflow:hidden;margin:2px 0}
.kbar>i{display:block;height:100%;border-radius:999px;background:var(--accent)}
.kbar.good>i{background:var(--good)} .kbar.bad>i{background:var(--bad)} .kbar.neutral>i{background:var(--fg2)}
.kpi.hero .kbar{width:100%;max-width:24rem;align-self:center;height:10px}
.cb.tgt{padding-bottom:13px}
.cb.tgt::before{content:"";position:absolute;z-index:-1;left:0;right:0;bottom:3px;height:6px;border-radius:3px;background:var(--line)}
.cb.tgt>i{top:auto;bottom:3px;height:6px;opacity:1;background:var(--accent)}
.cb>b.tg{position:absolute;z-index:-1;bottom:0;height:12px;left:var(--t);width:2px;margin-left:-1px;background:var(--fg);border-radius:1px}
table.lt.stack td .cb.tgt{padding:3px 0 13px}
ol.steps.sx>li>.st{grid-column:2;display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;padding-top:3px;color:var(--fg)}
ol.steps.sx>li>.st>b{font-size:1.05rem;line-height:1.35}
ol.steps.sx>li>.sn{grid-column:2;min-width:0;color:var(--fg2);overflow-wrap:anywhere}
@container lcard (max-width:520px){
  table.lt{font-size:13px} table.lt th,table.lt td{padding:8px 7px}
  table.lt thead th{font-size:10.5px;letter-spacing:.04em;white-space:normal;vertical-align:bottom}
  table.lt tbody th{min-width:0}
  table.lt.tight{font-size:12px} table.lt.tight th,table.lt.tight td{padding:7px 5px} table.lt.tight thead th{font-size:10px;letter-spacing:.02em}
  table.lt.stack td:empty{display:none}
  .tbl.stack{background:none;border:0;border-radius:0;overflow:visible}
  table.stack,table.stack tbody,table.stack caption{display:block}
  table.stack caption{padding:0 0 8px;border:0}
  table.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  table.stack tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:0 14px 10px;margin-bottom:8px}
  table.stack tr:last-child{margin-bottom:0}
  table.stack tr.hl{background:var(--hl-bg);box-shadow:inset 3px 0 0 var(--hl-edge)}
  table.stack tr.hl>:first-child{box-shadow:none}
  table.lt.stack tbody th{grid-column:1/-1;display:block;text-align:left;font-size:14.5px;padding:10px 0 8px;border-bottom:1px solid var(--line);position:static;background:none;white-space:normal}
  table.lt.stack td{display:block;padding:8px 0 0;border:0;text-align:left;white-space:normal;min-width:0;background:none;font-size:14px}
  table.lt.stack td.w{grid-column:1/-1}
  table.stack.trio tr{grid-template-columns:repeat(3,minmax(0,1fr));column-gap:10px}
  table.stack td::before{content:attr(data-label);display:block;font:600 10.5px/1.3 var(--sans);letter-spacing:.05em;text-transform:uppercase;color:var(--fg2);margin-bottom:2px}
  table.lt.stack td .cb{min-width:0;padding:3px 8px;text-align:left}
}
/* end stream v04-2 */
`;
}
