// The skill's reference files (skill/lede/reference/*.md), their budgets.json and the SKILL.md table that points to them
// (internal spec lede-reference-files, lede-lang/meta). Node only, no API: a token count comes from `count-text.ts --budgets`
// and is only compared here. The checks that need a count, a table or a frozen prompt that does not exist yet skip with a message
// and start to run when it does; the checks themselves are exercised on synthetic text so they are not untested until then.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { KEYWORDS, META_KEYS, parse } from '@lede-lang/core';
import { teachesOf } from '../../../bench/src/check-probe.ts';
import { type BudgetEntry, parseBudgets, referenceFiles, sha256Hex, WRITER_MODELS } from '../../../bench/src/count-text.ts';

const ROOT = new URL('../../../', import.meta.url).pathname;
const REFERENCE = join(ROOT, 'skill', 'lede', 'reference');
const SKILL = join(ROOT, 'skill', 'lede', 'SKILL.md');
const PROMPTS = join(ROOT, 'bench', 'prompts');
const CLI = join(ROOT, 'packages', 'cli', 'src', 'cli.ts');

const read = (path: string) => readFileSync(path, 'utf8');
const files = readdirSync(REFERENCE);
const mdFiles = referenceFiles(REFERENCE);

// ----------------------------------------------------------------------------------------------------------------- the checks

interface Fence {
  /** The text after the opening backticks: `lede`, `text` or empty. */
  info: string;
  /** The line of the opening backticks, from 1. */
  line: number;
  body: string;
}
interface Scan {
  fences: Fence[];
  /** Every line outside a fence (the fence marker lines are not prose either). */
  prose: { line: number; text: string }[];
  /** The line of a fence that never closes. */
  unclosed: number | null;
}

/**
 * Splits a file into fences and prose. A fence closes at a line of at least as many backticks as opened it, so a file can show a
 * three-backtick fence inside a four-backtick one (the longest run is the fence).
 */
function scan(text: string): Scan {
  const fences: Fence[] = [];
  const prose: Scan['prose'] = [];
  let open: { ticks: number; info: string; line: number; body: string[] } | null = null;
  for (const [i, text_] of text.split('\n').entries()) {
    const line = i + 1;
    if (open !== null) {
      const close = /^ {0,3}(`{3,})\s*$/.exec(text_);
      if (close && close[1].length >= open.ticks) {
        fences.push({ info: open.info, line: open.line, body: `${open.body.join('\n')}\n` });
        open = null;
      } else open.body.push(text_);
      continue;
    }
    const start = /^ {0,3}(`{3,})([^`]*)$/.exec(text_);
    if (start) open = { ticks: start[1].length, info: start[2].trim(), line, body: [] };
    else prose.push({ line, text: text_ });
  }
  return { fences, prose, unclosed: open === null ? null : open.line };
}

const TEACHES = /^<!-- teaches: (.+) -->$/;

/**
 * The editor words are keyword lines only with a name and a `|` after it, so `toggle the flag on Monday` stays prose, and `decision` only with
 * a name and a quoted question after it; `fold` and `swatch` are page words the parser does not list in KEYWORDS.
 */
const EDITOR_WORDS = ['param', 'toggle', 'bucket', 'template', 'preset'];
const PLAIN_WORDS = [...KEYWORDS.filter((k) => !EDITOR_WORDS.includes(k) && k !== 'decision'), 'fold', 'swatch'];

/** A line a Lede page would read as a block, which a `text` fence (an export, a non-Lede sample) must not hold. */
const KEYWORD_LINE = new RegExp(
  `^(?:(?:${PLAIN_WORDS.join('|')})(?=\\s|$)|at \\d|(?:${EDITOR_WORDS.join('|')})\\s+\\S+\\s*\\||decision\\s+[A-Za-z][\\w-]*\\s+")`,
);

/** What is wrong with a file's fences: unclosed ones, Lede fences that do not parse, `text` fences that hold a keyword line. */
function fenceProblems(text: string): string[] {
  const { fences, unclosed } = scan(text);
  const problems: string[] = [];
  if (unclosed !== null) problems.push(`line ${unclosed}: the fence never closes`);
  for (const f of fences) {
    if (f.info === 'text') {
      for (const [i, l] of f.body.split('\n').entries())
        if (KEYWORD_LINE.test(l)) problems.push(`line ${f.line + 1 + i}: a text fence holds the keyword line "${l}"`);
      continue;
    }
    for (const d of parse(f.body).diagnostics)
      if (d.severity === 'error' || d.code === 'unknown-meta')
        problems.push(`fence at line ${f.line}, its line ${d.line}: ${d.severity} [${d.code}] ${d.message}`);
  }
  return problems;
}

let flagsOfHelp: Set<string> | undefined;

/** The `--flag`s `lede --help` prints; the CLI runs once for the whole file. */
function helpFlags(): Set<string> {
  if (flagsOfHelp === undefined) {
    const run = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    flagsOfHelp = new Set(run.stdout.match(/--[a-z][a-z-]*/g));
  }
  return flagsOfHelp;
}

/** What is wrong with a file's prose: renderer internals, a key that is not a meta key, a flag the CLI does not have. */
function proseProblems(text: string, flags: Set<string>): string[] {
  const lines = text.replace(/\n$/, '').split('\n');
  const problems: string[] = [];
  for (const { line, text: t } of scan(text).prose) {
    const where = `line ${line}`;
    // The teaches comment is the last line and the only place a `<` may appear outside a fence.
    const isComment = line === lines.length && TEACHES.test(t);
    if (!isComment && t.includes('<')) problems.push(`${where}: "<" outside a fence`);
    if (t.includes('class=')) problems.push(`${where}: "class=" outside a fence`);
    if (t.startsWith('--') && !flags.has(/^--[a-z][a-z-]*/.exec(t)?.[0] ?? ''))
      problems.push(`${where}: a line starting with "--" that is no flag`);
    for (const flag of t.match(/--[a-z][a-z-]*/g) ?? [])
      if (!flags.has(flag)) problems.push(`${where}: ${flag} is not a flag in \`lede --help\``);
    for (const m of t.matchAll(/`@(\w+)`/g)) if (!META_KEYS.includes(m[1])) problems.push(`${where}: \`@${m[1]}\` is not in META_KEYS`);
    if (isComment)
      for (const m of t.matchAll(/@(\w+)/g)) if (!META_KEYS.includes(m[1])) problems.push(`${where}: teaches @${m[1]}, not in META_KEYS`);
  }
  return problems;
}

/** What is wrong with the shape of a file: title, scope line, no front matter, the teaches comment as the one last line. */
function shapeProblems(text: string): string[] {
  const problems: string[] = [];
  const lines = text.split('\n');
  if (!/^# Lede reference: \S/.test(lines[0])) problems.push('the first line is not "# Lede reference: <topic>"');
  if (!lines[1] || /^(#|\||---)/.test(lines[1])) problems.push('the second line is not the scope sentence');
  if (!text.endsWith('-->\n') || text.endsWith('\n\n')) problems.push('the file does not end with the teaches comment and one newline');
  // teachesOf is null for a last line that is not the comment and for one with an empty word; the two are told apart here.
  if (teachesOf(text) === null)
    problems.push(
      TEACHES.test(text.replace(/\n$/, '').split('\n').at(-1) ?? '')
        ? 'the teaches comment has an empty word'
        : 'the last line is not "<!-- teaches: a, b, c -->"',
    );
  if ((text.match(/<!-- teaches:/g) ?? []).length > 1) problems.push('more than one teaches comment');
  return problems;
}

// One file's line in budgets.json (BudgetEntry): three states (see count-text.ts), or invalid with the reason.
type State = { state: 'reserved' | 'unmeasured' | 'measured' } | { state: 'invalid'; why: string };

function classify(e: BudgetEntry): State {
  const no = (why: string): State => ({ state: 'invalid', why });
  const bare = Object.keys(e.counts).length === 0;
  if (!Number.isInteger(e.budget) || e.budget <= 0) return no('budget is not a positive integer');
  if (e.count === 0)
    return bare && e.sha256 === '' && e.measured === '' ? { state: 'reserved' } : no('count 0 (reserved) with counts, a hash or a date');
  if (e.count === null) {
    if (!/^[0-9a-f]{64}$/.test(e.sha256)) return no('count null (not counted) without the sha256 of the file');
    return bare && e.measured === '' ? { state: 'unmeasured' } : no('count null (not counted) with counts or a date');
  }
  if (!Number.isInteger(e.count) || e.count < 0) return no('count is not null or a whole number');
  if (!/^[0-9a-f]{64}$/.test(e.sha256)) return no('a measured entry without the sha256 of the file');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.measured)) return no('a measured entry without an ISO date');
  const keys = Object.keys(e.counts).toSorted();
  if (keys.join() !== WRITER_MODELS.toSorted().join())
    return no(`counts is keyed by ${keys.join(', ') || 'nothing'}, not the three writer models`);
  const counts = WRITER_MODELS.map((m) => e.counts[m] ?? 0);
  if (!counts.every((n) => Number.isInteger(n) && n > 0)) return no('a count in counts is not a positive whole number');
  if (e.count !== Math.max(...counts)) return no(`count ${e.count} is not the largest of counts (${Math.max(...counts)})`);
  return { state: 'measured' };
}

/** What is wrong with one file's entry given the file's bytes (null: the file is absent). */
function budgetProblems(entry: BudgetEntry | undefined, bytes: Buffer | null): string[] {
  if (!entry) return bytes ? ['the file has no entry in budgets.json'] : [];
  const s = classify(entry);
  if (s.state === 'invalid') return [s.why];
  if (bytes === null) return s.state === 'reserved' ? [] : ['an entry that is not reserved belongs to a file that is gone'];
  if (s.state === 'reserved') return ['the file exists but its entry is still a reserved budget; count it with `count-text.ts --budgets`'];
  const problems: string[] = [];
  if (sha256Hex(bytes) !== entry.sha256)
    problems.push(`sha256 ${sha256Hex(bytes)} is not the recorded ${entry.sha256}: the file changed without a recount`);
  if (s.state === 'measured' && (entry.count ?? 0) > entry.budget) problems.push(`count ${entry.count} is over the budget ${entry.budget}`);
  return problems;
}

interface Table {
  header: string[];
  rows: string[][];
}

/** The `## Reference files` section's table, or null when SKILL.md has no such section. */
function referenceTable(skill: string): Table | null {
  const prose = scan(skill).prose;
  const at = prose.findIndex((p) => p.text.trimEnd() === '## Reference files');
  if (at < 0) return null;
  const end = prose.findIndex((p, i) => i > at && p.text.startsWith('## '));
  const lines = prose.slice(at + 1, end < 0 ? undefined : end).filter((p) => p.text.startsWith('|'));
  const cells = lines.map((p) =>
    p.text
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim()),
  );
  return { header: cells[0] ?? [], rows: cells.slice(2) };
}

/** The headings of SKILL.md that place the section: the order Setup, Reference files, Publishing as a Claude Artifact. */
function headingOrder(skill: string): string[] {
  const wanted = new Set(['## Setup', '## Reference files', '## Publishing as a Claude Artifact']);
  return scan(skill)
    .prose.map((p) => p.text.trimEnd())
    .filter((t) => wanted.has(t));
}

const FIXED_PHRASES = ['status page', 'runbook', 'trend', 'exact values', 'headline', 'options', 'dated actions', 'spans'];
const KEYWORDS_NINE = ['data', 'chart', 'table', 'kpi', 'diagram', 'image', 'grid', 'cards', 'step'];

/**
 * The phrases from the fixed list that a trigger cell contains. A word is whole when no letter, digit, underscore or hyphen
 * touches it, so "step-by-step" is one word and does not hold `step`.
 */
function forbiddenIn(trigger: string): string[] {
  return [...FIXED_PHRASES, ...KEYWORDS_NINE].filter((p) =>
    new RegExp(`(?<![\\w-])${p.replace(/ /g, '\\s+')}(?![\\w-])`, 'i').test(trigger),
  );
}

/**
 * What is wrong with a frozen prompt file `C-lede-0.N.md` (N >= 6): the bytes of `C-lede-0.5.md` come first, then one newline and
 * the reference-files block. With `current`, every file the block lists must equal the current file byte for byte.
 */
function promptProblems(base: Buffer, prompt: Buffer, current: Record<string, string> | null): string[] {
  if (!prompt.subarray(0, base.length).equals(base)) return ['it does not begin with the bytes of C-lede-0.5.md'];
  const rest = prompt.subarray(base.length).toString('utf8');
  const block = /^\n<lede-reference-files>\n([\s\S]*)<\/lede-reference-files>\n?$/.exec(rest);
  if (!block) return ['after the 0.5 bytes it does not hold one newline and a <lede-reference-files> block'];
  if (current === null) return [];
  const parts = block[1].split(/^## reference\/(.+\.md)\n/m);
  const problems: string[] = [];
  if (parts[0] !== '' || parts.length < 3) problems.push('the block does not start with "## reference/<name>.md"');
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const name = parts[i];
    if (current[name] === undefined) problems.push(`${name} is listed but is not in the reference folder`);
    else if (parts[i + 1] !== current[name])
      problems.push(`${name} differs from the current file; write a new prompt file and run a new round`);
  }
  return problems;
}

// -------------------------------------------------------------------------------------------------- the files and the table

test('the folder holds only .md files and budgets.json, and each .md starts with its title and scope line', () => {
  assert.ok(files.includes('budgets.json'), 'budgets.json');
  assert.deepEqual(
    files.filter((f) => f !== 'budgets.json' && !f.endsWith('.md')),
    [],
  );
  for (const f of mdFiles) assert.deepEqual(shapeProblems(read(join(REFERENCE, f))), [], f);
});

test('budgets.json: every file has an entry, a reserved entry has no file, the hash matches the file and a measured count holds', (t) => {
  const budgets = parseBudgets(read(join(REFERENCE, 'budgets.json')));
  const names = new Set([...Object.keys(budgets), ...mdFiles]);
  const unmeasured: string[] = [];
  for (const name of [...names].toSorted()) {
    const bytes = mdFiles.includes(name) ? readFileSync(join(REFERENCE, name)) : null;
    assert.deepEqual(budgetProblems(budgets[name], bytes), [], name);
    if (bytes && classify(budgets[name]).state === 'unmeasured') unmeasured.push(name);
  }
  if (unmeasured.length > 0)
    t.diagnostic(
      `not counted, so the count and the budget are unchecked: ${unmeasured.join(', ')} (node bench/src/count-text.ts --budgets)`,
    );
});

test('the Reference files section sits after Setup and before Publishing as a Claude Artifact', (t) => {
  const skill = read(SKILL);
  if (referenceTable(skill) === null) return t.skip('SKILL.md has no "## Reference files" section yet (wave B, after the D67 verdict)');
  const order = headingOrder(skill);
  const want = ['## Setup', '## Reference files', '## Publishing as a Claude Artifact'];
  assert.deepEqual(
    order,
    want.filter((h) => order.includes(h)),
  );
  assert.ok(order.includes('## Setup'), 'the section follows ## Setup');
});

test('the table names exactly the files in the folder, each row has three cells and a reference/<file> in the first', (t) => {
  const table = referenceTable(read(SKILL));
  if (table === null) return t.skip('SKILL.md has no "## Reference files" section yet; the folder may hold files the table does not name');
  assert.deepEqual([table.header[0], table.header.length, table.header[2]], ['File', 3, 'Tokens']);
  for (const row of table.rows) assert.equal(row.length, 3, `a row with ${row.length} cells: ${row.join(' | ')}`);
  const named = table.rows.map(
    (r) => /^`reference\/([^`/]+\.md)`$/.exec(r[0])?.[1] ?? assert.fail(`the first cell is not \`reference/<file>\`: ${r[0]}`),
  );
  assert.deepEqual(named.toSorted(), mdFiles);
});

test("each Tokens cell is within 10 of the file's recorded count", (t) => {
  const table = referenceTable(read(SKILL));
  if (table === null) return t.skip('SKILL.md has no "## Reference files" section yet');
  const budgets = parseBudgets(read(join(REFERENCE, 'budgets.json')));
  const skipped: string[] = [];
  for (const row of table.rows) {
    const file = /^`reference\/([^`]+)`$/.exec(row[0])?.[1] ?? '';
    const entry = budgets[file];
    if (!entry || entry.count === null || entry.count === 0) {
      skipped.push(file);
      continue;
    }
    const tokens = Number(row[2]);
    assert.ok(Number.isInteger(tokens), `${file}: the Tokens cell "${row[2]}" is not a number`);
    assert.ok(Math.abs(tokens - entry.count) <= 10, `${file}: Tokens ${tokens} is not within 10 of the count ${entry.count}`);
  }
  if (skipped.length > 0) t.diagnostic(`no count yet, Tokens unchecked: ${skipped.join(', ')}`);
});

test('no trigger phrase holds a word from the fixed list or one of the nine keywords', (t) => {
  const table = referenceTable(read(SKILL));
  if (table === null) return t.skip('SKILL.md has no "## Reference files" section yet');
  for (const row of table.rows) assert.deepEqual(forbiddenIn(row[1] ?? ''), [], row[0]);
});

// ------------------------------------------------------------------------------------------- what each file teaches is true

for (const file of mdFiles) {
  const text = read(join(REFERENCE, file));

  test(`${file}: every fence that is not text parses with no error and no unknown meta key; text fences hold no keyword line`, () => {
    assert.deepEqual(fenceProblems(text), []);
  });

  test(`${file}: the keys it names and teaches are meta keys, and it names no renderer internals or unknown flags`, () => {
    assert.deepEqual(proseProblems(text, helpFlags()), []);
  });
}

// -------------------------------------------------------------------------------------------------------- the frozen prompts

test('C-lede-0.N.md (N >= 6) begins with the bytes of C-lede-0.5.md and holds the current files verbatim', (t) => {
  const numbers = readdirSync(PROMPTS)
    .map((f) => /^C-lede-0\.(\d+)\.md$/.exec(f)?.[1])
    .filter((n): n is string => n !== undefined && Number(n) >= 6)
    .map(Number)
    .toSorted((a, b) => a - b);
  if (numbers.length === 0) return t.skip('there is no bench/prompts/C-lede-0.6.md yet (wave B writes it after the D67 verdict)');
  const base = readFileSync(join(PROMPTS, 'C-lede-0.5.md'));
  const current = Object.fromEntries(mdFiles.map((f) => [f, read(join(REFERENCE, f))]));
  for (const n of numbers)
    assert.deepEqual(
      promptProblems(base, readFileSync(join(PROMPTS, `C-lede-0.${n}.md`)), n === numbers.at(-1) ? current : null),
      [],
      `C-lede-0.${n}.md`,
    );
});

// ------------------------------------------------------------------------------------------------ the checks, on synthetic text

const GOOD = [
  '# Lede reference: sample',
  'Scope sentence.',
  '',
  '| Key | Value | Effect |',
  '|---|---|---|',
  '| `@accent` | `#2357c6` | A colour. |',
  '',
  '```lede',
  '@title Sample',
  '# Hello',
  'kpi 12 | Open',
  '```',
  'Rules: use it sparingly (`--force` is a flag).',
  '<!-- teaches: @accent, @title -->',
  '',
].join('\n');

test('scan: the longest backtick run is the fence, so a four-backtick fence can hold a three-backtick one', () => {
  const nested = ['intro', '````lede', '```python', 'x = 1', '```', 'at 1 nit | note', '````', 'after', '```text', 'plain', '```'].join(
    '\n',
  );
  const s = scan(nested);
  assert.deepEqual(
    s.fences.map((f) => [f.info, f.line, f.body]),
    [
      ['lede', 2, '```python\nx = 1\n```\nat 1 nit | note\n'],
      ['text', 9, 'plain\n'],
    ],
  );
  assert.deepEqual(
    s.prose.map((p) => p.text),
    ['intro', 'after'],
  );
  assert.equal(s.unclosed, null);
  assert.equal(scan('a\n```lede\nb').unclosed, 2);
});

test('a well-formed file passes every file check', () => {
  assert.deepEqual(shapeProblems(GOOD), []);
  assert.deepEqual(fenceProblems(GOOD), []);
  assert.deepEqual(proseProblems(GOOD, new Set(['--force'])), []);
  assert.deepEqual(teachesOf(GOOD), ['@accent', '@title']);
});

test('fenceProblems: a Lede fence with an error, an unknown meta key or an unclosed fence, and a text fence with a keyword line', () => {
  assert.match(fenceProblems('```lede\nchart line nope\n```\n').join('\n'), /error \[/);
  assert.match(fenceProblems('```\n@toc off\n```\n').join('\n'), /unknown-meta/);
  assert.match(fenceProblems('```lede\n# Hi\n').join('\n'), /never closes/);
  assert.match(fenceProblems('```text\nkpi 1 | x\n```\n').join('\n'), /holds the keyword line "kpi 1 \| x"/);
  assert.match(fenceProblems('```text\nat 3 nit | x\n```\n').join('\n'), /keyword line/);
  assert.deepEqual(fenceProblems('```text\nat the start of the day\ntoggle the flag on Monday\n{"answers":[]}\n```\n'), []);
  assert.deepEqual(fenceProblems('```lede\ndata t = a,b; 1,2\ntable t\n```\n'), [], 'a fence stands alone');
});

test('proseProblems: renderer internals, an unknown meta key or flag, and a "<" anywhere but the teaches comment', () => {
  const flags = new Set(['--force']);
  const p = (body: string) => proseProblems(`# Lede reference: x\nScope.\n${body}\n<!-- teaches: @accent -->\n`, flags).join('\n');
  assert.match(p('Use <div> here.'), /"<" outside a fence/);
  assert.match(p('The class="note" box.'), /class=/);
  assert.match(p('--bad: red'), /starting with "--"/);
  assert.match(p('Pass `--shell` to build.'), /--shell is not a flag/);
  assert.match(p('Set `@toc` to off.'), /`@toc` is not in META_KEYS/);
  assert.equal(p('`@width wide` and `@key value` are not names of one key.'), '', 'only `@word` alone is checked');
  assert.match(proseProblems('# Lede reference: x\nScope.\n<!-- teaches: @toc -->\n', flags).join('\n'), /teaches @toc/);
  assert.match(
    proseProblems('# Lede reference: x\n<!-- a comment -->\nScope.\n<!-- teaches: @accent -->\n', flags).join('\n'),
    /"<" outside a fence/,
  );
  assert.equal(p('--force'), '');
});

test('shapeProblems: title, scope line, teaches comment as the single last line', () => {
  assert.deepEqual(shapeProblems(GOOD), []);
  assert.match(shapeProblems(GOOD.replace('# Lede reference: sample', '# Sample')).join(), /first line/);
  assert.match(shapeProblems(GOOD.replace('Scope sentence.', '| a |')).join(), /scope sentence/);
  assert.match(shapeProblems(GOOD.replace(/<!-- teaches.*\n/, '')).join(), /last line is not/);
  assert.match(shapeProblems(`${GOOD}\n`).join(), /does not end with the teaches comment/);
  assert.match(shapeProblems(GOOD.replace('Scope sentence.', '<!-- teaches: @date -->')).join(), /more than one/);
});

test('classify: reserved, not counted and measured entries are accepted; everything else says why not', () => {
  const sum = 'a'.repeat(64);
  const counts = { 'claude-haiku-5-5': 180, 'claude-sonnet-5-5': 201, 'claude-opus-5-5': 190 };
  const base: BudgetEntry = { budget: 250, count: 0, counts: {}, sha256: '', measured: '' };
  assert.equal(classify(base).state, 'reserved');
  assert.equal(classify({ ...base, count: null, sha256: sum }).state, 'unmeasured');
  assert.equal(classify({ ...base, count: 201, counts, sha256: sum, measured: '2026-11-06' }).state, 'measured');
  const why = (e: Partial<BudgetEntry>) => JSON.stringify(classify({ ...base, ...e }));
  assert.match(why({ count: null }), /without the sha256/);
  assert.match(why({ sha256: sum }), /reserved/);
  assert.match(why({ count: 201, counts, sha256: sum }), /ISO date/);
  assert.match(why({ count: 190, counts, sha256: sum, measured: '2026-11-06' }), /not the largest of counts \(201\)/);
  assert.match(
    why({ count: 201, counts: { 'claude-sonnet-5-5': 201 }, sha256: sum, measured: '2026-11-06' }),
    /not the three writer models/,
  );
  assert.match(why({ count: null, sha256: sum, counts }), /not counted/);
});

test('budgetProblems: a file needs an entry, a hash that matches and a count within budget; an unmeasured file skips only the count', () => {
  const bytes = Buffer.from('text\n');
  const counts = { 'claude-haiku-5-5': 180, 'claude-sonnet-5-5': 201, 'claude-opus-5-5': 190 };
  const reserved: BudgetEntry = { budget: 250, count: 0, counts: {}, sha256: '', measured: '' };
  const uncounted: BudgetEntry = { budget: 250, count: null, counts: {}, sha256: sha256Hex(bytes), measured: '' };
  const measured: BudgetEntry = { budget: 250, count: 201, counts, sha256: sha256Hex(bytes), measured: '2026-11-06' };
  assert.deepEqual(budgetProblems(reserved, null), [], 'a reserved entry for a file not written yet');
  assert.match(budgetProblems(reserved, bytes).join(), /still a reserved budget/);
  assert.match(budgetProblems(undefined, bytes).join(), /no entry/);
  assert.deepEqual(budgetProblems(undefined, null), []);
  assert.match(budgetProblems(measured, null).join(), /that is gone/);
  assert.deepEqual(budgetProblems(uncounted, bytes), []);
  assert.deepEqual(budgetProblems(measured, bytes), []);
  assert.match(budgetProblems(uncounted, Buffer.from('text!\n')).join(), /changed without a recount/);
  assert.match(budgetProblems(measured, Buffer.from('text!\n')).join(), /changed without a recount/);
  assert.match(budgetProblems({ ...measured, budget: 200 }, bytes).join(), /count 201 is over the budget 200/);
  assert.match(budgetProblems({ ...measured, count: 190 }, bytes).join(), /not the largest of counts/);
});

const SECTION = `# Lede

## Setup

install it

## Reference files

The reference above covers most pages. Read the named file first.

| File | Read it when the request asks for | Tokens |
|---|---|---|
| \`reference/meta.md\` | a brand or accent colour, a dark page, a one-line summary for link previews, a page in another language | 180 |
| \`reference/pages.md\` | a long report with an appendix to fold away, a code or diff review with notes on specific lines, a design-tokens or colour page | 410 |

## Publishing as a Claude Artifact

text
`;

test('referenceTable and headingOrder read the section from the design; the triggers in the design pass the fixed list', () => {
  const table = referenceTable(SECTION);
  assert.deepEqual(table?.header, ['File', 'Read it when the request asks for', 'Tokens']);
  assert.deepEqual(
    table?.rows.map((r) => r[0]),
    ['`reference/meta.md`', '`reference/pages.md`'],
  );
  assert.deepEqual(headingOrder(SECTION), ['## Setup', '## Reference files', '## Publishing as a Claude Artifact']);
  assert.equal(referenceTable('# Lede\n\n## Setup\n'), null);
  for (const row of table?.rows ?? []) assert.deepEqual(forbiddenIn(row[1]), [], row[0]);
  for (const trigger of [
    'a page the reader will decide, approve, triage, rank, tune, edit or fill in and send back',
    'an architecture page with views, overlays or a step-by-step build-up of one system',
  ])
    assert.deepEqual(forbiddenIn(trigger), [], trigger);
});

test('forbiddenIn: the eight phrases and the nine keywords, as whole words, in any case', () => {
  assert.deepEqual(forbiddenIn('a Status Page for the team'), ['status page']);
  assert.deepEqual(forbiddenIn('a runbook with the exact  values and a trend'), ['runbook', 'trend', 'exact values']);
  assert.deepEqual(forbiddenIn('a chart or a diagram of the cards, one step at a time'), ['chart', 'diagram', 'cards', 'step']);
  assert.deepEqual(forbiddenIn('the dated actions, spans, options and headline'), ['headline', 'options', 'dated actions', 'spans']);
  assert.deepEqual(
    forbiddenIn('a datasheet, trendy tabletop images and a grid-like card'),
    [],
    'a word inside another word, or a plural, is not the word',
  );
});

test('promptProblems: the 0.5 bytes first, then one newline and the block; a changed byte or file fails', () => {
  const base = Buffer.from('<lede-reference>\nthe reference\n</lede-reference>');
  const current = {
    'meta.md': '# Lede reference: m\nScope.\n<!-- teaches: @accent -->\n',
    'pages.md': '# Lede reference: p\nScope.\n<!-- teaches: fold -->\n',
  };
  const block = (listed: Record<string, string>) =>
    `\n<lede-reference-files>\n${Object.entries(listed)
      .map(([n, t]) => `## reference/${n}\n${t}`)
      .join('')}</lede-reference-files>\n`;
  const prompt = (listed: Record<string, string>) => Buffer.concat([base, Buffer.from(block(listed))]);
  assert.deepEqual(promptProblems(base, prompt({ 'meta.md': current['meta.md'] }), current), [], 'a file not yet shipped is not listed');
  assert.deepEqual(promptProblems(base, prompt(current), current), []);
  assert.deepEqual(promptProblems(base, prompt(current), null), []);
  const edited = Buffer.from(base);
  edited[3] ^= 1;
  assert.match(promptProblems(edited, prompt(current), null).join(), /does not begin with the bytes/);
  assert.match(
    promptProblems(base, Buffer.concat([base, Buffer.from('\n\n<lede-reference-files>\n</lede-reference-files>')]), null).join(),
    /one newline/,
  );
  assert.match(promptProblems(base, prompt({ 'meta.md': `${current['meta.md']}x\n` }), current).join(), /meta\.md differs/);
  assert.match(promptProblems(base, prompt({ 'gone.md': 'x\n' }), current).join(), /gone\.md is listed but is not in the reference folder/);
  assert.match(promptProblems(base, Buffer.concat([base, Buffer.from(block({}))]), current).join(), /does not start with/);
});
