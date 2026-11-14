// The measure step: no model, no network. Validity and build success of what a writer wrote, by arm.
//   C  the real parser (`lede check` is this parse plus printing): valid = no error diagnostic; build = the real renderer ran
//   B  a complete HTML document (doctype and a closing </html>)
//   D  a body fragment that uses the preloaded stylesheet and none of the things the prompt forbids; built = fragment + css
//   E  parses as JSON and passes the structure check (src/kit/json-ui.ts)
//   A  non-empty Markdown (nothing validates it further here)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@lede-lang/core';
import { BENCH, type Arm } from './arms.ts';
import { validateJsonUi } from './json-ui.ts';

export interface Measure {
  valid: boolean;
  /** At most five lines of why not. */
  problems: string[];
  warnings: number;
  buildOk: boolean;
  pageBytes: number | null;
  srcBytes: number;
}

/** A reply that is one fenced block is unwrapped; the prompts ask for no fence, and a stripped one is recorded, never hidden. */
export function stripFence(text: string): { text: string; stripped: boolean } {
  const m = /^\s*(`{3,})[\w+-]*\n([\s\S]*?)\n\1\s*$/.exec(text);
  return m ? { text: m[2], stripped: true } : { text, stripped: false };
}

export const PRELOADED_CSS = join(BENCH, 'arms', 'preloaded.css');
export const preloadedPage = (fragment: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page</title><style>${readFileSync(PRELOADED_CSS, 'utf8')}</style></head><body>${fragment}</body></html>`;

export async function measure(arm: Arm, src: string): Promise<Measure> {
  const m: Measure = { valid: true, problems: [], warnings: 0, buildOk: false, pageBytes: null, srcBytes: Buffer.byteLength(src) };
  const fail = (p: string) => {
    m.valid = false;
    m.problems.push(p);
  };
  if (src.trim() === '') {
    fail('empty reply');
    return m;
  }
  switch (arm.letter) {
    case 'C': {
      const doc = parse(src);
      const errors = doc.diagnostics.filter((d) => d.severity === 'error');
      m.warnings = doc.diagnostics.length - errors.length;
      for (const d of errors.slice(0, 5)) fail(`${d.line}:${d.col} ${d.code} ${d.message}`);
      try {
        const { render } = await import('@lede-lang/html');
        m.pageBytes = Buffer.byteLength(await render(doc));
        m.buildOk = true;
      } catch (e) {
        fail(`render threw: ${(e as Error).message}`);
      }
      break;
    }
    case 'B':
      if (!/^\s*<!doctype html/i.test(src)) fail('no <!doctype html>');
      if (!/<\/html>\s*$/i.test(src)) fail('does not end with </html>');
      m.buildOk = m.valid;
      m.pageBytes = m.srcBytes;
      break;
    case 'D': {
      for (const [re, why] of [
        [/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i, 'writes a document wrapper'],
        [/<style[\s>]|<link[\s>]/i, 'writes its own style or link'],
        [/<script[\s>]/i, 'writes a script'],
      ] as const)
        if (re.test(src)) fail(why);
      if (!/<main\s[^>]*class=["']?[^"'>]*\bpage\b/i.test(src)) fail('no <main class="page"> wrapper');
      m.buildOk = m.valid;
      m.pageBytes = m.valid ? Buffer.byteLength(preloadedPage(src)) : null;
      break;
    }
    case 'E': {
      const r = validateJsonUi(src);
      for (const e of r.errors.slice(0, 5)) fail(e);
      m.buildOk = r.ok;
      break;
    }
    default:
      m.buildOk = true;
      m.pageBytes = m.srcBytes;
  }
  return m;
}
