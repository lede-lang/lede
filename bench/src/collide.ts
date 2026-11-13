// The collision count for a new line form (D80, the gate of RFC lede-lang/lede#34): which lines of the tracked `.lede` files a new
// rule would read differently from how the compiler reads them now. Zero is the expectation; every line is printed so a count that
// is not zero can be explained.
//   node bench/src/collide.ts [file.lede ...]        (default: every tracked .lede file, from `git ls-files`)
// The pipe-row rules (spec §4.11, §4.14):
//   row    `NAME: a | b`   a line that begins with the name of a data set declared above it and holds a pipe separator
//   colon  `: a | b`       a line that begins with a colon and a space or ends there (a row of an open table; prose otherwise)
//   head   `table = a | b` an inline table whose header has a pipe separator outside double quotes (read as a pipe header now)
// Lines inside a code fence are not Lede lines and are skipped. Exits 1 when any line collides.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeOutsideQuotes, splitPipes } from '../../packages/core/src/lex.ts';

const ROOT = join(import.meta.dirname, '..', '..');

export type Rule = 'row' | 'colon' | 'head';
export interface Hit {
  file: string;
  line: number;
  rule: Rule;
  text: string;
}

const DATA_DECL = /^data\s+([A-Za-z_][\w-]*)\s*(?:\+=|=|<)/;
const NAME_LINE = /^([A-Za-z][\w-]*):\s*(.*)$/;
const FENCE = /^(`{3,})/;
/** The text after the `=` of an inline table line (`table [options] = ...`), or null when the line is not one. */
function inlineBody(s: string): string | null {
  if (!/^table\s/.test(s)) return null;
  const rest = s.slice(5).trim();
  const eq = /(^|\s)=(\s|$)/.exec(rest);
  return eq ? rest.slice(eq.index + eq[0].length) : null;
}

/** The collisions in one file's text, in line order. */
export function collisions(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  const data = new Set<string>();
  let fence = 0;
  text.split('\n').forEach((raw, i) => {
    const s = raw.replace(/\r$/, '').trim();
    if (fence) {
      if (/^`{3,}$/.test(s) && s.length >= fence) fence = 0;
      return;
    }
    const open = FENCE.exec(s);
    if (open) {
      fence = open[1].length;
      return;
    }
    const hit = (rule: Rule) => hits.push({ file, line: i + 1, rule, text: s });
    const decl = DATA_DECL.exec(s);
    if (decl) data.add(decl[1]);
    if (/^:(\s|$)/.test(s)) hit('colon');
    const name = NAME_LINE.exec(s);
    if (name && data.has(name[1]) && splitPipes(name[2]).length > 1) hit('row');
    const body = inlineBody(s);
    if (body !== null && pipeOutsideQuotes(body) >= 0 && splitPipes(body).length > 1) hit('head');
  });
  return hits;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const given = process.argv.slice(2);
  const files = given.length
    ? given
    : execFileSync('git', ['ls-files', '*.lede'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const hits = files.flatMap((f) => collisions(f, readFileSync(given.length ? f : join(ROOT, f), 'utf8')));
  for (const h of hits) console.log(`${h.file}:${h.line}: ${h.rule}: ${h.text}`);
  const by = (rule: Rule) => hits.filter((h) => h.rule === rule).length;
  console.log(`${files.length} files; row ${by('row')}, colon ${by('colon')}, head ${by('head')}`);
  process.exitCode = hits.length ? 1 : 0;
}
