// Scores a probe round for a reference file (internal spec lede-reference-files, lede-lang/meta):
//   node bench/src/check-probe.ts <stem> [--prompt C-lede-0.6.md] [--dir <probe directory>] [--reference <file>]
//   node bench/src/check-probe.ts <stem> --briefs [--dir <probe directory>]
// <stem> names the file under test (meta, pages, shell, diagrams, ...): the briefs are bench/probe/<stem>/briefs.json, the pages are
// bench/probe/<stem>/<haiku|sonnet|opus>/<id>.lede, written once by isolated writers and saved as written, and the words the file
// teaches come from the `<!-- teaches: ... -->` comment on the last line of skill/lede/reference/<stem>.md.
// For every page it parses the text as written (first try: valid means zero errors), then repairs a copy with the call
// `lede check --fix` makes (`fix` from @lede-lang/core) and parses again (after fix), then lists the warnings whose code starts
// `unknown-meta` or `accent-`, or is `meta-value` (the meta keys only warn, so a round for meta.md gates on them: such a page is a
// miss; for any other file they are reported and not gated), and which of the taught words a page uses (reported, not gated).
// A page that is missing, or a file the briefs do not name, fails the round. Pass: every page valid after fix and, for meta, no
// gated warning. It prints one line per tier, lists every page that was not clean first try with its diagnostics, writes
// <probe directory>/result.json (the same input gives the same bytes) and exits 0 on a pass, 1 on a miss, 2 when the round cannot be
// scored (no briefs, a malformed briefs file, no teaches comment).
// --briefs checks only the structure of briefs.json and prints counts and the rule that failed, never a brief: twelve entries
// {id, category, brief} with ids <stem>-01 to <stem>-12, one paragraph each, and no technology word (check-tasks.ts's list). Run it
// before the briefs are hashed; the orchestrator does not read them (D34). Exit 1 on any failure.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fix, KEYWORDS, parse, type Diagnostic } from '@lede-lang/core';
import { sha256Hex } from './count-text.ts';
import { TECHNOLOGY } from './task-vocab.ts';

export const TIERS = ['haiku', 'sonnet', 'opus'] as const;
export type Tier = (typeof TIERS)[number];
/** Briefs per file. */
export const BRIEFS = 12;

const ROOT = join(import.meta.dirname, '..');
const REPO = join(ROOT, '..');
const USAGE = `usage: node bench/src/check-probe.ts <stem> [--prompt C-lede-0.N.md] [--dir <probe directory>] [--reference <file>]
       node bench/src/check-probe.ts <stem> --briefs [--dir <probe directory>]`;

// ------------------------------------------------------------------------------------------------------------------ pure parts

/** A warning that fails a `meta.md` round: an unknown key, an accent that is not a colour or does not read as text. */
export const gatedCode = (code: string): boolean => code.startsWith('unknown-meta') || code.startsWith('accent-') || code === 'meta-value';

/** The words in the `<!-- teaches: a, b, c -->` comment on the last line of a reference file, or null when it has none. */
export function teachesOf(text: string): string[] | null {
  const m = /^<!-- teaches: (.+) -->$/.exec(text.replace(/\n$/, '').split('\n').at(-1) ?? '');
  const words = m ? m[1].split(',').map((w) => w.trim()) : [];
  return words.length > 0 && words.every((w) => w !== '') ? words : null;
}

/** The lines of a page outside its code fences, trimmed: a fenced `fold` is code, not a use of the word. */
function pageLines(src: string): string[] {
  const out: string[] = [];
  let ticks = 0;
  for (const line of src.split('\n')) {
    const fence = /^\s*(`{3,})/.exec(line);
    if (ticks > 0) {
      if (fence && fence[1].length >= ticks && /^\s*`+\s*$/.test(line)) ticks = 0;
    } else if (fence) ticks = fence[1].length;
    else out.push(line.trim());
  }
  return out;
}

/**
 * Which of the taught words a page uses. `@key` is a line that starts with it; `at` is a line that starts with `at` and a number;
 * any other word is a line that starts with it, or a token after a keyword line's own keyword (`chart donut ...`), or, for a word
 * ending in `=`, a token that starts with it (`kpi ... spark=...`).
 */
export function usedWords(src: string, teaches: string[]): string[] {
  const lines = pageLines(src).map((line) => ({ line, tokens: line.split(/\s+/) }));
  const uses = (word: string, { line, tokens: [first, ...rest] }: (typeof lines)[number]): boolean => {
    if (word.startsWith('@')) return line === word || line.startsWith(`${word} `);
    if (word === 'at') return first === 'at' && /^\d+$/.test(rest[0] ?? '');
    if (first === word) return true;
    return (KEYWORDS as readonly string[]).includes(first) && rest.some((t) => t === word || (word.endsWith('=') && t.startsWith(word)));
  };
  return teaches.filter((w) => lines.some((l) => uses(w, l)));
}

export interface PageScore {
  /** Zero errors as written. */
  firstTry: boolean;
  /** Zero errors after the repair `lede check --fix` makes. */
  afterFix: boolean;
  /** The errors as written. */
  errors: Diagnostic[];
  /** The errors left after the repair. */
  remaining: Diagnostic[];
  /** How many repairs `--fix` made. */
  fixes: number;
  /** The gated warnings of the repaired page. */
  gated: Diagnostic[];
  /** The taught words the page uses. */
  used: string[];
}

/** Scores one page's text. */
export function scorePage(src: string, teaches: string[]): PageScore {
  const errors = parse(src).diagnostics.filter((d) => d.severity === 'error');
  // `fix` re-parses after every pass, so its `remaining` is exactly what parsing `repaired.src` gives (the as-written diagnostics when
  // no repair was made); every severity is in it, not only the errors.
  const repaired = fix(src);
  const after = repaired.remaining;
  const remaining = after.filter((d) => d.severity === 'error');
  return {
    firstTry: errors.length === 0,
    afterFix: remaining.length === 0,
    errors,
    remaining,
    fixes: repaired.applied.length,
    gated: after.filter((d) => d.severity === 'warning' && gatedCode(d.code)),
    used: usedWords(src, teaches),
  };
}

/** What is wrong with the structure of a briefs file, as rules and positions, never as a brief's text. */
export function briefProblems(data: unknown, stem: string): string[] {
  if (!Array.isArray(data)) return ['(set): the file is not a JSON array'];
  const problems: string[] = [];
  if (data.length !== BRIEFS) problems.push(`(set): ${data.length} entries, not ${BRIEFS}`);
  const ids = new Set<string>();
  const categories = new Set<string>();
  for (const [i, raw] of data.entries()) {
    const at = `entry ${i + 1}`;
    const e = raw as Record<string, unknown> | null;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) {
      problems.push(`${at}: not an object`);
      continue;
    }
    const extra = Object.keys(e).filter((k) => !['id', 'category', 'brief'].includes(k));
    if (extra.length > 0) problems.push(`${at}: fields beyond id, category and brief`);
    const want = `${stem}-${String(i + 1).padStart(2, '0')}`;
    if (e.id !== want) problems.push(`${at}: id is not ${want}`);
    else ids.add(want);
    if (typeof e.category !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.category)) problems.push(`${at}: category is not a slug`);
    else if (categories.has(e.category)) problems.push(`${at}: category repeats an earlier one`);
    else categories.add(e.category);
    if (typeof e.brief !== 'string' || e.brief.trim() === '') problems.push(`${at}: brief missing`);
    else {
      if (e.brief.length < 300 || e.brief.length > 3000)
        problems.push(`${at}: brief length ${e.brief.length} is outside 300 to 3000 characters`);
      if (/\n/.test(e.brief.trim())) problems.push(`${at}: brief is not one paragraph`);
      if (TECHNOLOGY.test(e.brief)) problems.push(`${at}: a technology word in the brief`);
    }
  }
  return problems;
}

/** One page of the round. */
export interface PageRow {
  tier: Tier;
  id: string;
  present: boolean;
  firstTry: boolean;
  afterFix: boolean;
  /** Codes of the gated warnings, for any file; they fail the round only for meta. */
  metaWarnings: string[];
  fixes: number;
  used: string[];
  errors: { line: number; col: number; code: string; message: string }[];
  remaining: { line: number; col: number; code: string; message: string }[];
}

export interface TierResult {
  pages: number;
  firstTry: number;
  afterFix: number;
  /** Pages with a gated warning. */
  metaWarningPages: number;
  /** Pages that use at least one taught word. */
  used: number;
  usedBy: Record<string, number>;
}

export interface Result {
  stem: string;
  reference: string;
  prompt: string | null;
  briefs: { sha256: string; count: number };
  teaches: string[];
  /** Whether a gated warning fails the round (meta only). */
  gateMeta: boolean;
  expected: number;
  tiers: Record<Tier, TierResult>;
  total: TierResult;
  /** Page files in a tier directory that no brief names. */
  unexpected: string[];
  pass: boolean;
  pages: PageRow[];
}

const slim = (ds: Diagnostic[]) => ds.map(({ line, col, code, message }) => ({ line, col, code, message }));

function tally(rows: PageRow[], teaches: string[]): TierResult {
  return {
    pages: rows.filter((r) => r.present).length,
    firstTry: rows.filter((r) => r.firstTry).length,
    afterFix: rows.filter((r) => r.afterFix).length,
    metaWarningPages: rows.filter((r) => r.metaWarnings.length > 0).length,
    used: rows.filter((r) => r.used.length > 0).length,
    usedBy: Object.fromEntries(teaches.map((w) => [w, rows.filter((r) => r.used.includes(w)).length])),
  };
}

/** The result of a round from its rows: the counts per tier and in all, and whether it passed. */
export function summarize(
  info: Pick<Result, 'stem' | 'reference' | 'prompt' | 'briefs' | 'teaches' | 'unexpected'>,
  rows: PageRow[],
  expected: number,
): Result {
  const gateMeta = info.stem === 'meta';
  const total = tally(rows, info.teaches);
  return {
    ...info,
    gateMeta,
    expected,
    tiers: Object.fromEntries(
      TIERS.map((t) => [
        t,
        tally(
          rows.filter((r) => r.tier === t),
          info.teaches,
        ),
      ]),
    ) as Record<Tier, TierResult>,
    total,
    pass:
      total.afterFix === expected &&
      rows.length === expected &&
      info.unexpected.length === 0 &&
      (!gateMeta || total.metaWarningPages === 0),
    pages: rows,
  };
}

/** The table and the pages that were not clean, as the text the script prints. */
export function formatReport(r: Result): string {
  const num = (n: number | string, w: number) => String(n).padStart(w);
  const lines = [
    `probe ${r.stem}: ${r.expected / TIERS.length} briefs x ${TIERS.length} tiers = ${r.expected} pages${r.prompt ? ` (prompt ${r.prompt})` : ''}`,
    `briefs.json sha256 ${r.briefs.sha256}`,
    `${r.reference} teaches ${r.teaches.join(', ')}`,
    '',
    ['tier  ', 'pages', 'first-try', 'after-fix', 'meta-warn', 'used'].join('  '),
  ];
  for (const [name, t] of [...TIERS.map((x) => [x, r.tiers[x]] as const), ['all', r.total] as const])
    lines.push(
      [name.padEnd(6), num(t.pages, 5), num(t.firstTry, 9), num(t.afterFix, 9), num(t.metaWarningPages, 9), num(t.used, 4)].join('  '),
    );
  lines.push('', `used by word: ${r.teaches.map((w) => `${w} ${r.total.usedBy[w]}`).join(', ')}`);
  for (const p of r.pages) {
    const name = `${p.tier}/${p.id}`;
    if (!p.present) lines.push(`MISSING ${name}`);
    else if (!p.firstTry) {
      lines.push(`${p.afterFix ? 'fixed' : 'INVALID'} ${name}: ${p.errors.length} error(s) first try, ${p.remaining.length} after fix`);
      for (const d of p.afterFix ? p.errors : p.remaining) lines.push(`  ${d.line}:${d.col} [${d.code}] ${d.message}`);
    }
    if (p.metaWarnings.length > 0) lines.push(`${r.gateMeta ? 'GATED' : 'meta warning'} ${name}: ${p.metaWarnings.join(', ')}`);
  }
  for (const f of r.unexpected) lines.push(`UNEXPECTED ${f}`);
  const pages = `${r.total.afterFix} of ${r.expected} valid after fix`;
  lines.push(
    r.pass
      ? `pass: ${pages}${r.gateMeta ? ', no gated meta warning' : ''}`
      : `MISS: ${pages}${r.gateMeta ? `, ${r.total.metaWarningPages} page(s) with a gated meta warning` : ''}${r.unexpected.length ? `, ${r.unexpected.length} unexpected file(s)` : ''}`,
  );
  return `${lines.join('\n')}\n`;
}

// --------------------------------------------------------------------------------------------------------------------- the run

export interface ProbeRun {
  stem: string;
  /** bench/probe/<stem> unless given. */
  dir: string;
  /** skill/lede/reference/<stem>.md unless given. */
  reference: string;
  /** The frozen prompt the writers read, recorded in result.json as given. */
  prompt: string | null;
  out: (text: string) => void;
  err: (text: string) => void;
}

/** Reads briefs.json; null (after printing why) when it is missing or not JSON. */
function readBriefs(run: ProbeRun): { bytes: Buffer; data: unknown } | null {
  const path = join(run.dir, 'briefs.json');
  try {
    const bytes = readFileSync(path);
    return { bytes, data: JSON.parse(bytes.toString('utf8')) as unknown };
  } catch (e) {
    run.err(`${path}: ${e instanceof Error ? e.message : String(e)}\n`);
    return null;
  }
}

/** `--briefs`: counts and failed rules for briefs.json, never a brief. Returns the exit status. */
export function runBriefs(run: ProbeRun): number {
  const briefs = readBriefs(run);
  if (briefs === null) return 2;
  const problems = briefProblems(briefs.data, run.stem);
  const n = Array.isArray(briefs.data) ? briefs.data.length : 0;
  run.out(`briefs ${join(run.dir, 'briefs.json')}: ${n} of ${BRIEFS} entries\n`);
  for (const p of problems) run.out(`FAIL ${p}\n`);
  run.out(problems.length > 0 ? `${problems.length} failures\n` : `sha256 ${sha256Hex(briefs.bytes)}\nok\n`);
  return problems.length > 0 ? 1 : 0;
}

/** Scores the round in `run.dir`, prints the report, writes result.json and returns the exit status. */
export function runProbe(run: ProbeRun): number {
  const briefs = readBriefs(run);
  if (briefs === null) return 2;
  const problems = briefProblems(briefs.data, run.stem);
  if (problems.length > 0) {
    for (const p of problems) run.err(`FAIL ${p}\n`);
    run.err(`${run.dir}/briefs.json cannot be scored\n`);
    return 2;
  }
  let teaches: string[] | null;
  try {
    teaches = teachesOf(readFileSync(run.reference, 'utf8'));
  } catch (e) {
    run.err(`${run.reference}: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  if (teaches === null) {
    run.err(`${run.reference}: the last line is not "<!-- teaches: a, b, c -->"\n`);
    return 2;
  }
  const ids = (briefs.data as { id: string }[]).map((b) => b.id);
  const rows: PageRow[] = [];
  const unexpected: string[] = [];
  for (const tier of TIERS) {
    const dir = join(run.dir, tier);
    for (const id of ids) {
      const path = join(dir, `${id}.lede`);
      if (!existsSync(path)) {
        rows.push({
          tier,
          id,
          present: false,
          firstTry: false,
          afterFix: false,
          metaWarnings: [],
          fixes: 0,
          used: [],
          errors: [],
          remaining: [],
        });
        continue;
      }
      const s = scorePage(readFileSync(path, 'utf8'), teaches);
      rows.push({
        tier,
        id,
        present: true,
        firstTry: s.firstTry,
        afterFix: s.afterFix,
        metaWarnings: s.gated.map((d) => d.code),
        fixes: s.fixes,
        used: s.used,
        errors: slim(s.errors),
        remaining: slim(s.remaining),
      });
    }
    if (existsSync(dir)) for (const f of readdirSync(dir)) if (!ids.some((id) => f === `${id}.lede`)) unexpected.push(`${tier}/${f}`);
  }
  const reference = join('skill', 'lede', 'reference', `${run.stem}.md`);
  const result = summarize(
    {
      stem: run.stem,
      reference,
      prompt: run.prompt,
      briefs: { sha256: sha256Hex(briefs.bytes), count: ids.length },
      teaches,
      unexpected: unexpected.toSorted(),
    },
    rows,
    ids.length * TIERS.length,
  );
  writeFileSync(join(run.dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  run.out(formatReport(result));
  return result.pass ? 0 : 1;
}

export function main(argv: string[]): number {
  const args: string[] = [];
  const opt: Record<string, string> = {};
  let briefsOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--briefs') briefsOnly = true;
    else if (['--prompt', '--dir', '--reference'].includes(argv[i])) opt[argv[i]] = argv[++i] ?? '';
    else args.push(argv[i]);
  }
  const stem = args[0];
  const bad = (msg: string) => {
    process.stderr.write(`${msg}\n`);
    return 2;
  };
  if (args.length !== 1 || !/^[a-z][a-z0-9-]*$/.test(stem) || Object.values(opt).includes('')) return bad(USAGE);
  const run: ProbeRun = {
    stem,
    dir: opt['--dir'] ?? join(ROOT, 'probe', stem),
    reference: opt['--reference'] ?? join(REPO, 'skill', 'lede', 'reference', `${stem}.md`),
    prompt: opt['--prompt'] ?? null,
    out: (t) => process.stdout.write(t),
    err: (t) => process.stderr.write(t),
  };
  return briefsOnly ? runBriefs(run) : runProbe(run);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
