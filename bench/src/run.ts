// Phase 0 benchmark harness: render every generated output, then measure it.
//   node bench/src/run.ts [--only haiku/C/08] [--min-id 41 --rows raw-heldout] [--models opus-r3] [--no-browser] [--edits]
// Writes bench/out/html/<model>/<arm>/<id>.html, screenshots under bench/out/shots/,
// and one row per output to bench/results/raw.json (or edits.json with --edits).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import MarkdownIt from 'markdown-it';
import { chromium, type Browser } from 'playwright-core';
import { parse, LedeStream, type DiagramBlock } from '@lede-lang/core';
import { render, layoutFlow } from '@lede-lang/html';
import { MD_CSS } from './md-style.ts';
import { CHROME } from './shot.ts';

const require = createRequire(import.meta.url);
const { countTokens } = require('@anthropic-ai/tokenizer') as { countTokens: (s: string) => number };

const ROOT = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const EDITS = args.includes('--edits');
const GEN = join(ROOT, EDITS ? 'edits' : 'gen');
const OUT =
  join(ROOT, 'out', EDITS ? 'edits' : 'main') +
  (process.argv.includes('--tag') ? `-${process.argv[process.argv.indexOf('--tag') + 1]}` : '');
const minId = args.includes('--min-id') ? Number(args[args.indexOf('--min-id') + 1]) : 0;
const onlyModels = args.includes('--models') ? args[args.indexOf('--models') + 1].split(',') : null;
const rowsName = args.includes('--rows') ? args[args.indexOf('--rows') + 1] : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const noBrowser = args.includes('--no-browser');
const armOnly = args.includes('--arm') ? args[args.indexOf('--arm') + 1] : null;
const tag = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : null;
const EXT = { A: 'md', B: 'html', C: 'lede' } as const;
type Arm = keyof typeof EXT;

interface Task {
  id: string;
  category: string;
  needs: string[];
  checklist: { sections: string[]; visible: string[]; values: string[] };
  edit: { request: string; expect_visible: string[]; expect_values: string[]; expect_absent: string[] };
}
const tasks: Task[] = readdirSync(join(ROOT, 'tasks'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'tasks', f), 'utf8')));
// Task ids are numeric file prefixes: two digits up to 99 (`08`), three for 100.
const idKey = (name: string) => /^\d+/.exec(name)![0].padStart(2, '0');
const taskById = new Map(tasks.map((t) => [idKey(t.id), t]));

const md = new MarkdownIt({ html: false, linkify: true });
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (toks, idx, o, env, self) => {
  const t = toks[idx];
  if (t.info.trim() === 'mermaid') return `<pre class="mermaid">${md.utils.escapeHtml(t.content)}</pre>\n`;
  return defaultFence(toks, idx, o, env, self);
};

function mdPage(src: string, assets: string): string {
  const title = /^#\s+(.+)$/m.exec(src)?.[1] ?? 'Page';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${md.utils.escapeHtml(title)}</title><style>${MD_CSS}</style></head><body><main class="markdown-body">${md.render(src)}</main>
<script src="${assets}/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:false,theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'default',securityLevel:'strict'});
window.__mermaid=mermaid.run({querySelector:'.mermaid'}).then(()=>({ok:true}),e=>({ok:false,err:String(e&&e.message||e)}));</script></body></html>`;
}

// ---------------------------------------------------------------- time to first meaningful render

/** Tokens the model must emit before the page shows a heading plus one content block. */
function ttfmr(arm: Arm, src: string): number | null {
  const lines = src.split('\n');
  if (arm === 'C') {
    for (let n = 1; n <= lines.length; n++) {
      const s = new LedeStream();
      s.write(lines.slice(0, n).join('\n') + '\n');
      const b = s.snapshot().blocks.filter((x) => x.type !== 'data');
      if (b.some((x) => x.type === 'heading') && b.some((x) => x.type !== 'heading')) return countTokens(lines.slice(0, n).join('\n'));
    }
    return null;
  }
  if (arm === 'A') {
    for (let n = 1; n <= lines.length; n++) {
      const toks = md.parse(lines.slice(0, n).join('\n'), {});
      const head = toks.some((t) => t.type === 'heading_open');
      const body = toks.some(
        (t) =>
          ['paragraph_open', 'bullet_list_open', 'ordered_list_open', 'table_open', 'blockquote_open', 'fence'].includes(t.type) &&
          !(t.type === 'fence' && t.info.trim() === 'mermaid'),
      );
      if (head && body) return countTokens(lines.slice(0, n).join('\n'));
    }
    return null;
  }
  // HTML: browsers paint progressively once <head> styles are parsed. Meaningful = a closed
  // heading inside <body> followed by one closed text-bearing element.
  const bodyAt = src.search(/<body[\s>]/i);
  if (bodyAt < 0) return null;
  const rest = src.slice(bodyAt);
  const h = /<\/h[1-3]>/i.exec(rest);
  if (!h) return null;
  const after = rest.slice(h.index + h[0].length);
  const m = /<\/(p|li|td|table|figure|section|div|span|ul|ol|blockquote|svg)>/i.exec(after);
  if (!m) return null;
  return countTokens(src.slice(0, bodyAt + h.index + h[0].length + m.index + m[0].length));
}

// ---------------------------------------------------------------- checks

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/\s+/g, ' ');

function fidelity(t: Task, visible: string, src: string) {
  const v = norm(visible);
  const s = norm(src);
  const miss = (list: string[], hay: string) => list.filter((x) => !hay.includes(norm(x)));
  const missSections = miss(t.checklist.sections, v);
  const missVisible = miss(t.checklist.visible, v);
  const missValues = miss(t.checklist.values, s);
  const total = t.checklist.sections.length + t.checklist.visible.length + t.checklist.values.length;
  return { score: 1 - (missSections.length + missVisible.length + missValues.length) / total, missSections, missVisible, missValues };
}

function editCheck(t: Task, visible: string, src: string) {
  const v = norm(visible);
  const s = norm(src);
  const fails = [
    ...t.edit.expect_visible.filter((x) => !v.includes(norm(x))).map((x) => `missing visible: ${x}`),
    ...t.edit.expect_values.filter((x) => !s.includes(norm(x))).map((x) => `missing value: ${x}`),
    ...t.edit.expect_absent.filter((x) => v.includes(norm(x))).map((x) => `still present: ${x}`),
  ];
  return { ok: fails.length === 0, fails };
}

/** Label/edge/node collisions in Lede flow diagrams (the compiler's own guarantee, checked on real output). */
async function geometry(src: string): Promise<{ diagrams: number; collisions: string[] }> {
  const doc = parse(src);
  const out: string[] = [];
  const diags = doc.blocks
    .flatMap((b) => (b.type === 'grid' ? b.children : [b]))
    .filter((b): b is DiagramBlock => b.type === 'diagram' && b.kind === 'flow' && b.nodes.length > 0);
  for (const d of diags) {
    const p = await layoutFlow(d);
    const hit = (s: number[], b: { x: number; y: number; w: number; h: number }) =>
      Math.max(s[0], s[2]) > b.x + 1 &&
      Math.min(s[0], s[2]) < b.x + b.w - 1 &&
      Math.max(s[1], s[3]) > b.y + 1 &&
      Math.min(s[1], s[3]) < b.y + b.h - 1;
    for (const e of p.edges) {
      const segs = e.points.slice(1).map((q, i) => [e.points[i].x, e.points[i].y, q.x, q.y]);
      for (const s of segs)
        for (const n of p.nodes)
          if (n.node.id !== e.edge.from && n.node.id !== e.edge.to && hit(s, n))
            out.push(`edge ${e.edge.from}->${e.edge.to} crosses ${n.node.id}`);
      if (e.label)
        for (const o of p.edges)
          if (o !== e)
            for (const s of o.points.slice(1).map((q, i) => [o.points[i].x, o.points[i].y, q.x, q.y]))
              if (hit(s, e.label)) out.push(`label "${e.label.text}" on edge ${o.edge.from}->${o.edge.to}`);
    }
  }
  return { diagrams: diags.length, collisions: [...new Set(out)] };
}

// ---------------------------------------------------------------- browser measurements

const VIS_TEXT = `(() => {
  const out = [];
  const walk = el => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { out.push(n.textContent); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (['script', 'style', 'title', 'desc', 'noscript', 'template'].includes(tag)) continue;
      if (tag === 'details' && !n.open) { const s = n.querySelector('summary'); if (s) out.push(s.textContent); continue; }
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      walk(n);
      if (/^(p|div|li|tr|td|th|h[1-6]|text|tspan|section|figure|br)$/.test(tag)) out.push(' ');
    }
  };
  walk(document.body);
  return out.join(' ').replace(/\\s+/g, ' ');
})()`;

async function browse(browser: Browser, file: string, shotBase: string) {
  const res: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [w, scheme] of [
    [1280, 'light'],
    [400, 'light'],
    [400, 'dark'],
    [1280, 'dark'],
  ] as const) {
    // bypassCSP: the pages ship a default-src 'none' CSP (D20); the harness must still inject axe-core
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme, bypassCSP: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('requestfailed', (r) => {
      if (!r.url().startsWith('file:')) errors.push(`blocked request ${r.url()}`);
    });
    await page.route(/^https?:/, (r) => r.abort());
    await page.goto(`file://${file}`, { waitUntil: 'load', timeout: 30000 });
    const merm = (await page.evaluate('window.__mermaid ? window.__mermaid : null').catch(() => null)) as {
      ok: boolean;
      err?: string;
    } | null;
    if (merm && !merm.ok) errors.push(`mermaid: ${merm.err}`);
    await page.waitForTimeout(100);
    const key = `${w}-${scheme}`;
    if (w === 1280 && scheme === 'light') {
      res.visible = await page.evaluate(VIS_TEXT);
      res.mermaidErrors = await page.evaluate(
        `[...document.querySelectorAll('.mermaid')].filter(e => /Syntax error|Parse error/i.test(e.textContent)).length`,
      );
      res.mermaidBlocks = await page.evaluate(`document.querySelectorAll('.mermaid').length`);
    }
    // Horizontal overflow at both widths (Req 2.6); the 400px keys keep their Phase 0 names.
    const overflow = await page.evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
    if (w === 400) res[`overflow-${scheme}`] = overflow;
    else res[`overflow-${w}-${scheme}`] = overflow;
    if (scheme === 'light' || w === 400) {
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const r = await page.evaluate(
        `axe.run(document, { runOnly: ['color-contrast'] }).then(r => r.violations.reduce((a, v) => a + v.nodes.length, 0))`,
      );
      res[`contrast-${key}`] = r;
    }
    await page.screenshot({ path: `${shotBase}-${key}.png`, fullPage: true });
    await ctx.close();
  }
  res.jsErrors = errors;
  return res;
}

// ---------------------------------------------------------------- main

async function main() {
  const assets = join(OUT, 'html', '_assets');
  mkdirSync(assets, { recursive: true });
  copyFileSync(require.resolve('mermaid/dist/mermaid.min.js'), join(assets, 'mermaid.min.js'));
  const browser = noBrowser ? null : await chromium.launch({ executablePath: CHROME });
  const rowsFile = join(ROOT, 'results', rowsName ? `${rowsName}.json` : `${EDITS ? 'edits' : 'raw'}${tag ? `-${tag}` : ''}.json`);
  mkdirSync(dirname(rowsFile), { recursive: true });
  const rows: Record<string, unknown>[] =
    existsSync(rowsFile) && (only || armOnly || minId || onlyModels) ? JSON.parse(readFileSync(rowsFile, 'utf8')) : [];
  for (const model of readdirSync(GEN).sort()) {
    if (onlyModels && !onlyModels.includes(model)) continue;
    for (const arm of ['A', 'B', 'C'] as Arm[]) {
      if (armOnly && arm !== armOnly) continue;
      const dir = join(GEN, model, arm);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)
        .filter((name) => name.endsWith(`.${EXT[arm]}`))
        .sort()) {
        const id = idKey(f);
        if (minId && Number(id) < minId) continue;
        const key = `${model}/${arm}/${id}`;
        if (only && key !== only) continue;
        const t = taskById.get(id)!;
        const src = readFileSync(join(dir, f), 'utf8');
        const htmlDir = join(OUT, 'html', model, arm);
        const shotDir = join(OUT, 'shots', model, arm);
        mkdirSync(htmlDir, { recursive: true });
        mkdirSync(shotDir, { recursive: true });
        const htmlFile = join(htmlDir, `${id}.html`);
        const row: Record<string, unknown> = {
          key,
          model,
          arm,
          id,
          category: t.category,
          needs: t.needs,
          srcBytes: Buffer.byteLength(src),
          tokens: countTokens(src),
        };
        if (arm === 'A') writeFileSync(htmlFile, mdPage(src, '../../_assets'));
        else if (arm === 'B') writeFileSync(htmlFile, src);
        else {
          const doc = parse(src);
          row.errors = doc.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line}:${d.col} ${d.code} ${d.message}`);
          row.warnings = doc.diagnostics.filter((d) => d.severity === 'warning').map((d) => `${d.line}:${d.col} ${d.code} ${d.message}`);
          writeFileSync(htmlFile, await render(doc));
          row.geometry = await geometry(src);
        }
        row.pageBytes = Buffer.byteLength(readFileSync(htmlFile));
        row.ttfmrTokens = ttfmr(arm, src);
        if (browser) {
          const b = await browse(browser, htmlFile, join(shotDir, id));
          const visible = typeof b.visible === 'string' ? b.visible : '';
          delete b.visible;
          Object.assign(row, b);
          row.fidelity = fidelity(t, visible, src);
          if (EDITS) row.edit = editCheck(t, visible, src);
        }
        const i = rows.findIndex((r) => r.key === key);
        if (i >= 0) rows[i] = row;
        else rows.push(row);
        process.stderr.write(
          `${key} tokens=${String(row.tokens)} fid=${(row.fidelity as { score: number } | undefined)?.score?.toFixed(2) ?? '-'}\n`,
        );
      }
    }
  }
  await browser?.close();
  writeFileSync(rowsFile, JSON.stringify(rows, null, 1));
}

await main();
