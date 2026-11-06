// Counts the tokens of a text file, or of the slice of it that starts at one heading, with the count_tokens endpoint on
// claude-sonnet-5-5 (the writer tier the skill is most often loaded by), and prints one integer (internal spec, lede-lang/meta).
//   ANTHROPIC_API_KEY=... node bench/src/count-text.ts <file> [--from "## Heading"] [--to "## Heading"]
//   ANTHROPIC_API_KEY=... node bench/src/count-text.ts --budgets
// An `ant auth login` token also works (ANTHROPIC_AUTH_TOKEN=$(ant auth print-credentials --access-token)); either way the org
// needs credit. Without --from or --to the whole file is counted, as recount.ts counts the references. --from starts the slice at
// the line that is exactly that heading (at the top of the file when it is left out) and ends it at the line that is exactly
// --to when it is given (that line is left out), else at the next heading of the same or a higher level, else at the end of the
// file. Lines inside code fences are never headings.
// count_tokens wraps the text in a user message, which adds a fixed number of tokens; counting "a", assumed to be one token on
// every tokenizer, measures that overhead, which is subtracted exactly as recount.ts does. Exit 2 on a usage error, a heading
// that is not in the file, or no credentials; 1 when the API refuses the count.
// --budgets (the reference files, internal spec lede-reference-files): counts every *.md in skill/lede/reference/ on each of the
// three writer models (claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5, each less its own overhead), takes the largest as
// the file's `count`, and rewrites that file's entry in skill/lede/reference/budgets.json with `count`, `counts`, `sha256` (of
// the file's bytes) and `measured` (today), keeping `budget`. It prints `file, haiku, sonnet, opus, count, budget, over?` and the
// whole skill/lede/SKILL.md on the same columns, and exits 1 if any count is over its budget, 2 without credentials, with a
// file that has no entry in budgets.json, or on a budgets.json it cannot read. The entry of a file not in the folder is left
// as it is, and with an empty folder budgets.json is not touched.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { countTokens, overheadOf } from './count-tokens.ts';

const MODEL = 'claude-sonnet-5-5';
const USAGE =
  'usage: node bench/src/count-text.ts <file> [--from "## Heading"] [--to "## Heading"]\n       node bench/src/count-text.ts --budgets';
const NO_KEY = 'set ANTHROPIC_API_KEY, or ANTHROPIC_AUTH_TOKEN=$(ant auth print-credentials --access-token)';

const level = (line: string) => /^(#{1,6})\s/.exec(line)?.[1].length ?? 0;

/**
 * The lines from `from` up to, not including, `to` (else the next heading of the same or a higher level, else the end), as the
 * text of a file: lines joined by newlines with one at the end. Returns a message when a heading is not found.
 */
export function slice(text: string, from?: string, to?: string): string | { error: string } {
  const lines = text.split('\n');
  // A line inside a code fence is code, whatever it starts with.
  let fence = '';
  const outside = lines.map((l) => {
    const m = /^\s*(```+|~~~+)/.exec(l);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = '';
      return false;
    }
    return !fence;
  });
  const start = from === undefined ? 0 : lines.findIndex((l, i) => outside[i] && l.trimEnd() === from.trimEnd());
  if (start < 0) return { error: `no line "${from}" in the file` };
  let end = lines.length;
  if (to !== undefined) {
    const at = lines.findIndex((l, i) => (from === undefined || i > start) && outside[i] && l.trimEnd() === to.trimEnd());
    if (at < 0) return { error: `no line "${to}"${from === undefined ? '' : ` after "${from}"`}` };
    end = at;
  } else {
    const own = level(from ?? '');
    for (let i = start + 1; i < lines.length; i++)
      if (outside[i] && level(lines[i]) > 0 && (own === 0 || level(lines[i]) <= own)) {
        end = i;
        break;
      }
  }
  return `${lines.slice(start, end).join('\n').replace(/\n+$/, '')}\n`;
}

// ------------------------------------------------------------------------------------------------------------------ --budgets

/** The three tokenizers a reference file is budgeted on: the models a writer runs on (D33, D36), each with its own count. */
export const WRITER_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] as const;
export type WriterModel = (typeof WRITER_MODELS)[number];
export type Counts = Record<WriterModel, number>;
/** The tokens of `text` on one model, less that model's wrapper overhead. */
export type Counter = (model: WriterModel, text: string) => Promise<number>;

const REPO = join(import.meta.dirname, '..', '..');
const REFERENCE_DIR = join('skill', 'lede', 'reference');
const SKILL = join('skill', 'lede', 'SKILL.md');

/**
 * One file's line in budgets.json. `count` is the largest of `counts`. Three states: a budget reserved for a file that does
 * not exist yet (count 0, no counts, empty sha256 and measured), a file that exists and has not been counted (count null, the
 * sha256 of its bytes, no counts, empty measured), and a measured file (all five fields set).
 */
export interface BudgetEntry {
  budget: number;
  count: number | null;
  counts: Partial<Counts>;
  sha256: string;
  measured: string;
}
export type Budgets = Record<string, BudgetEntry>;

/** The hex SHA-256 of a file's bytes, which is what budgets.json records for the text that was counted. */
export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** The names of the `*.md` files directly in `dir`, sorted. */
export const referenceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .toSorted();

/** `text` counted on every writer model, one call each. */
export async function countOnEach(count: Counter, text: string): Promise<Counts> {
  const each = await Promise.all(WRITER_MODELS.map(async (model) => [model, await count(model, text)] as const));
  return Object.fromEntries(each) as Counts;
}

/** The number a budget holds against: the largest of the three, so it holds for every writer tier. */
export const largest = (counts: Counts): number => Math.max(...WRITER_MODELS.map((m) => counts[m]));

/** Reads budgets.json; throws a message naming the first thing wrong with it. */
export function parseBudgets(text: string): Budgets {
  const data: unknown = JSON.parse(text);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('budgets.json is not an object');
  const budgets: Budgets = {};
  for (const [file, raw] of Object.entries(data)) {
    const e = raw as Partial<BudgetEntry> | null;
    const bad = (what: string) => new Error(`budgets.json: ${file}: ${what}`);
    if (typeof e !== 'object' || e === null) throw bad('not an object');
    if (!Number.isInteger(e.budget) || (e.budget ?? 0) <= 0) throw bad('budget is not a positive integer');
    if (e.count !== null && !(Number.isInteger(e.count) && (e.count ?? -1) >= 0)) throw bad('count is not null or a whole number');
    if (typeof e.counts !== 'object' || e.counts === null || Array.isArray(e.counts)) throw bad('counts is not an object');
    for (const [model, n] of Object.entries(e.counts))
      if (!WRITER_MODELS.includes(model as WriterModel) || !Number.isInteger(n)) throw bad(`counts has "${model}": ${String(n)}`);
    if (typeof e.sha256 !== 'string' || typeof e.measured !== 'string') throw bad('sha256 and measured are strings');
    budgets[file] = e as BudgetEntry;
  }
  return budgets;
}

/** budgets.json as the script writes it: one entry per line, models in the order of WRITER_MODELS, a final newline. */
export function serializeBudgets(budgets: Budgets): string {
  const rows = Object.entries(budgets).map(([file, e]) => {
    const counts = WRITER_MODELS.filter((m) => e.counts[m] !== undefined).map((m) => `"${m}": ${e.counts[m]}`);
    const inner = counts.length > 0 ? `{ ${counts.join(', ')} }` : '{}';
    const fields = [`"budget": ${e.budget}`, `"count": ${e.count}`, `"counts": ${inner}`];
    fields.push(`"sha256": ${JSON.stringify(e.sha256)}`, `"measured": ${JSON.stringify(e.measured)}`);
    return `  ${JSON.stringify(file)}: { ${fields.join(', ')} }`;
  });
  return `{\n${rows.join(',\n')}\n}\n`;
}

/** One line of the table: a reference file (with its budget) or the whole SKILL.md (budget null). */
export interface TableRow {
  file: string;
  counts: Counts;
  count: number;
  budget: number | null;
}

/** `file, haiku, sonnet, opus, count, budget, over?` as aligned text: names to the left, numbers to the right. */
export function formatTable(rows: TableRow[]): string {
  const cells = rows.map((r) => [
    r.file,
    String(r.counts['claude-haiku-5-5']),
    String(r.counts['claude-sonnet-5-5']),
    String(r.counts['claude-opus-5-5']),
    String(r.count),
    r.budget === null ? '-' : String(r.budget),
    r.budget === null ? '-' : r.count > r.budget ? 'OVER' : 'ok',
  ]);
  const table = [['file', 'haiku', 'sonnet', 'opus', 'count', 'budget', 'over?'], ...cells];
  const width = table[0].map((_, c) => Math.max(...table.map((r) => r[c].length)));
  return table.map((r) => r.map((cell, c) => (c === 0 ? cell.padEnd(width[c]) : cell.padStart(width[c]))).join('  ')).join('\n');
}

/** Where `--budgets` reads and writes, and how it counts; main fills these in, a test fills in its own. */
export interface BudgetsRun {
  root: string;
  count: Counter;
  /** The ISO date written as `measured`. */
  today: string;
  out: (text: string) => void;
  err: (text: string) => void;
}

/**
 * Counts every reference file and the whole SKILL.md, rewrites the measured entries of budgets.json, prints the table and
 * returns the exit status: 0, 1 when a count is over its budget or the API refuses, 2 when budgets.json cannot be read or a file
 * has no entry in it.
 */
export async function runBudgets(run: BudgetsRun): Promise<number> {
  const dir = join(run.root, REFERENCE_DIR);
  const path = join(dir, 'budgets.json');
  let budgets: Budgets;
  let files: string[];
  try {
    budgets = parseBudgets(readFileSync(path, 'utf8'));
    files = referenceFiles(dir);
  } catch (e) {
    run.err(`${path}: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  const unbudgeted = files.filter((f) => !(f in budgets));
  if (unbudgeted.length > 0) {
    run.err(`${unbudgeted.join(', ')}: no entry in budgets.json; state the budget there before the file is counted\n`);
    return 2;
  }
  const bytes = files.map((f) => readFileSync(join(dir, f)));
  const skill = readFileSync(join(run.root, SKILL), 'utf8');
  let counted: Counts[];
  try {
    counted = await Promise.all([...bytes.map((b) => countOnEach(run.count, b.toString('utf8'))), countOnEach(run.count, skill)]);
  } catch (e) {
    run.err(`count_tokens failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  const rows: TableRow[] = files.map((file, i) => {
    const counts = counted[i];
    const count = largest(counts);
    budgets[file] = { budget: budgets[file].budget, count, counts, sha256: sha256Hex(bytes[i]), measured: run.today };
    return { file, counts, count, budget: budgets[file].budget };
  });
  rows.push({ file: SKILL, counts: counted[files.length], count: largest(counted[files.length]), budget: null });
  if (files.length > 0) writeFileSync(path, serializeBudgets(budgets));
  run.out(`${formatTable(rows)}\n`);
  return rows.some((r) => r.budget !== null && r.count > r.budget) ? 1 : 0;
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const hasKey = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  if (argv.includes('--budgets')) {
    if (argv.length !== 1) {
      process.stderr.write(`${USAGE}\n`);
      return 2;
    }
    if (!hasKey) {
      process.stderr.write(`${NO_KEY}\n`);
      return 2;
    }
    const client = new Anthropic();
    try {
      const overhead = Object.fromEntries(await Promise.all(WRITER_MODELS.map(async (m) => [m, await overheadOf(client, m)] as const)));
      return await runBudgets({
        root: REPO,
        count: (model, text) => countTokens(client, model, text, overhead[model]),
        today: new Date().toISOString().slice(0, 10),
        out: (text) => process.stdout.write(text),
        err: (text) => process.stderr.write(text),
      });
    } catch (e) {
      process.stderr.write(`count_tokens failed: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
  }
  const args: string[] = [];
  let from: string | undefined;
  let to: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') from = argv[++i];
    else if (argv[i] === '--to') to = argv[++i];
    else args.push(argv[i]);
  }
  const bad = (msg: string) => {
    process.stderr.write(`${msg}\n`);
    return 2;
  };
  if (args.length !== 1 || (argv.includes('--from') && !from) || (argv.includes('--to') && !to)) return bad(USAGE);
  let text: string;
  try {
    text = readFileSync(args[0], 'utf8');
  } catch (e) {
    return bad(`${args[0]}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (from !== undefined || to !== undefined) {
    const part = slice(text, from, to);
    if (typeof part !== 'string') return bad(`${args[0]}: ${part.error}`);
    text = part;
  }
  if (!hasKey) return bad(NO_KEY);

  const client = new Anthropic();
  try {
    process.stdout.write(`${await countTokens(client, MODEL, text)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`count_tokens failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main(process.argv.slice(2));
