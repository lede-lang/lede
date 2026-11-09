// count-text.ts --budgets: the parts that need no API (file walking, the hash, the table, the budgets.json round trip, the exit codes)
// and the whole run against a counter that stands in for count_tokens. The three-model count itself is not tested here.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WRITER_MODELS,
  formatTable,
  largest,
  parseBudgets,
  referenceFiles,
  runBudgets,
  serializeBudgets,
  sha256Hex,
  type Budgets,
  type Counter,
  type Counts,
} from '../src/count-text.ts';

const SCRIPT = join(import.meta.dirname, '..', 'src', 'count-text.ts');
const REPO = join(import.meta.dirname, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'lede-count-text-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let roots = 0;

const reserved = (budget: number) => ({ budget, count: 0, counts: {}, sha256: '', measured: '' });
const BUDGETS: Budgets = { 'meta.md': reserved(250), 'pages.md': reserved(450) };

/** A repository root holding SKILL.md, budgets.json and the given reference files. */
function root(files: Record<string, string>, budgets: Budgets | string = BUDGETS): string {
  const dir = join(tmp, String(roots++));
  mkdirSync(join(dir, 'skill', 'lede', 'reference'), { recursive: true });
  writeFileSync(join(dir, 'skill', 'lede', 'SKILL.md'), '# Lede\nthe whole skill\n');
  writeFileSync(join(dir, 'skill', 'lede', 'reference', 'budgets.json'), typeof budgets === 'string' ? budgets : serializeBudgets(budgets));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'skill', 'lede', 'reference', name), text);
  return dir;
}
const budgetsOf = (dir: string) => join(dir, 'skill', 'lede', 'reference', 'budgets.json');

/** Characters per token differ by model, so the three counts differ and the largest is not always the same one. */
const PER_TOKEN = { 'claude-haiku-5-5': 3, 'claude-sonnet-5-5': 4, 'claude-opus-5-5': 5 } as const;
const counter: Counter & { calls: number } = Object.assign(
  async (model: keyof typeof PER_TOKEN, text: string) => {
    counter.calls++;
    return Math.ceil(text.length / PER_TOKEN[model]);
  },
  { calls: 0 },
);

async function run(dir: string, count: Counter = counter) {
  let out = '';
  let err = '';
  const status = await runBudgets({
    root: dir,
    count,
    today: '2026-11-06',
    out: (t) => (out += t),
    err: (t) => (err += t),
  });
  return { status, out, err };
}

test('sha256Hex is the hex digest of the bytes, whether given as text or as bytes', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('café →'), sha256Hex(Buffer.from('café →', 'utf8')));
});

test('referenceFiles lists the .md files directly in the folder, sorted, and nothing else', () => {
  const dir = join(tmp, 'walk');
  mkdirSync(join(dir, 'nested'), { recursive: true });
  mkdirSync(join(dir, 'folder.md'));
  for (const f of ['pages.md', 'meta.md', 'budgets.json', 'notes.txt', join('nested', 'deep.md')]) writeFileSync(join(dir, f), 'x\n');
  assert.deepEqual(referenceFiles(dir), ['meta.md', 'pages.md']);
  assert.deepEqual(referenceFiles(join(tmp, 'walk', 'nested')), ['deep.md']);
});

test('largest takes the maximum of the three, and the table names its columns and marks a file over its budget', () => {
  const counts = { 'claude-haiku-5-5': 180, 'claude-sonnet-5-5': 201, 'claude-opus-5-5': 190 };
  assert.equal(largest(counts), 201);
  const table = formatTable([
    { file: 'meta.md', counts, count: 201, budget: 250 },
    { file: 'pages.md', counts: { ...counts, 'claude-opus-5-5': 460 }, count: 460, budget: 450 },
    { file: 'skill/lede/SKILL.md', counts, count: 201, budget: null },
  ]);
  const lines = table.split('\n');
  assert.deepEqual(lines[0].split(/\s+/), ['file', 'haiku', 'sonnet', 'opus', 'count', 'budget', 'over?']);
  assert.deepEqual(lines[1].split(/\s+/), ['meta.md', '180', '201', '190', '201', '250', 'ok']);
  assert.deepEqual(lines[2].split(/\s+/), ['pages.md', '180', '201', '460', '460', '450', 'OVER']);
  assert.deepEqual(lines[3].split(/\s+/), ['skill/lede/SKILL.md', '180', '201', '190', '201', '-', '-']);
  assert.equal(new Set(lines.map((l) => l.length)).size, 1, 'every line is as wide as the others');
});

test('budgets.json parses and serializes to the same bytes, and the one in the repository is in that form', () => {
  const measured: Budgets = {
    ...BUDGETS,
    'shell.md': {
      budget: 700,
      count: 640,
      counts: { 'claude-opus-5-5': 610, 'claude-haiku-5-5': 640, 'claude-sonnet-5-5': 600 },
      sha256: 'a'.repeat(64),
      measured: '2026-11-06',
    },
    'diagrams.md': { budget: 250, count: null, counts: {}, sha256: 'b'.repeat(64), measured: '' },
  };
  const text = serializeBudgets(measured);
  assert.match(
    text,
    /"counts": \{ "claude-haiku-5-5": 640, "claude-sonnet-5-5": 600, "claude-opus-5-5": 610 \}/,
    'models in a fixed order',
  );
  assert.match(text, /"count": null/);
  assert.equal(serializeBudgets(parseBudgets(text)), text);
  const committed = readFileSync(join(REPO, 'skill', 'lede', 'reference', 'budgets.json'), 'utf8');
  assert.equal(serializeBudgets(parseBudgets(committed)), committed, 'run `--budgets` or serializeBudgets, do not hand-format it');
});

test('parseBudgets names the entry and the field that is wrong', () => {
  const entry = (patch: Record<string, unknown>) => JSON.stringify({ 'meta.md': { ...reserved(250), ...patch } });
  assert.throws(() => parseBudgets('[]'), /not an object/);
  assert.throws(() => parseBudgets(entry({ budget: 0 })), /meta\.md: budget is not a positive integer/);
  assert.throws(() => parseBudgets(entry({ count: 'many' })), /meta\.md: count is not null or a whole number/);
  assert.throws(() => parseBudgets(entry({ counts: { 'claude-nova-1': 5 } })), /counts has "claude-nova-1": 5/);
  assert.throws(() => parseBudgets(entry({ sha256: 7 })), /sha256 and measured are strings/);
  assert.throws(() => parseBudgets('{'), SyntaxError);
});

test('--budgets records the largest count, the three counts, the hash and the date, keeps the budget, and prints the table', async () => {
  const text = '# Lede reference: page metadata\n'.repeat(10);
  const dir = root({ 'meta.md': text });
  const before = readFileSync(budgetsOf(dir), 'utf8');
  counter.calls = 0;
  const r = await run(dir);
  assert.equal(r.status, 0, r.err);
  assert.equal(counter.calls, 6, 'three models for the file and three for SKILL.md');
  const entry = parseBudgets(readFileSync(budgetsOf(dir), 'utf8'))['meta.md'];
  const counts: Counts = {
    'claude-haiku-5-5': Math.ceil(text.length / 3),
    'claude-sonnet-5-5': Math.ceil(text.length / 4),
    'claude-opus-5-5': Math.ceil(text.length / 5),
  };
  assert.deepEqual(entry, { budget: 250, count: counts['claude-haiku-5-5'], counts, sha256: sha256Hex(text), measured: '2026-11-06' });
  assert.equal(entry.count, largest(counts));
  assert.deepEqual(
    parseBudgets(readFileSync(budgetsOf(dir), 'utf8'))['pages.md'],
    reserved(450),
    'an entry with no file is left as it was',
  );
  assert.notEqual(readFileSync(budgetsOf(dir), 'utf8'), before);
  const lines = r.out.trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[1].split(/\s+/), ['meta.md', ...WRITER_MODELS.map((m) => String(counts[m])), String(entry.count), '250', 'ok']);
  assert.match(lines[2], /^skill\/lede\/SKILL\.md\s+\d+\s+\d+\s+\d+\s+\d+\s+-\s+-$/);
});

test('--budgets on an empty folder prints the SKILL.md row and leaves budgets.json as it was', async () => {
  const dir = root({});
  const before = readFileSync(budgetsOf(dir), 'utf8');
  counter.calls = 0;
  const r = await run(dir);
  assert.equal(r.status, 0, r.err);
  assert.equal(counter.calls, 3);
  assert.equal(readFileSync(budgetsOf(dir), 'utf8'), before);
  assert.equal(r.out.trimEnd().split('\n').length, 2, 'the header and the SKILL.md row');
  assert.match(r.out, /skill\/lede\/SKILL\.md/);
});

test('a count over the budget exits 1 and is still recorded', async () => {
  const dir = root({ 'meta.md': 'x'.repeat(2000) }, { 'meta.md': reserved(100) });
  const r = await run(dir);
  assert.equal(r.status, 1);
  assert.match(r.out, /\bOVER$/m);
  assert.equal(parseBudgets(readFileSync(budgetsOf(dir), 'utf8'))['meta.md'].count, 667);
});

test('a file with no entry exits 2 before anything is counted or written', async () => {
  const dir = root({ 'meta.md': 'a\n', 'extra.md': 'b\n' });
  const before = readFileSync(budgetsOf(dir), 'utf8');
  counter.calls = 0;
  const r = await run(dir);
  assert.equal(r.status, 2);
  assert.match(r.err, /^extra\.md: no entry in budgets\.json/);
  assert.equal(counter.calls, 0);
  assert.equal(readFileSync(budgetsOf(dir), 'utf8'), before);
});

test('an unreadable budgets.json exits 2, and an API refusal exits 1 with nothing written', async () => {
  const broken = await run(root({ 'meta.md': 'a\n' }, '{ not json'));
  assert.equal(broken.status, 2);
  assert.match(broken.err, /budgets\.json/);
  const dir = root({ 'meta.md': 'a\n' });
  const before = readFileSync(budgetsOf(dir), 'utf8');
  const refused = await run(dir, () => Promise.reject(new Error('credit balance is too low')));
  assert.equal(refused.status, 1);
  assert.match(refused.err, /count_tokens failed: credit balance is too low/);
  assert.equal(readFileSync(budgetsOf(dir), 'utf8'), before);
});

test('without a key every mode exits 2 and says which variables to set', () => {
  const env = { PATH: process.env.PATH ?? '' };
  for (const args of [['--budgets'], [join(REPO, 'skill', 'lede', 'SKILL.md')]]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /ANTHROPIC_API_KEY/);
    assert.equal(r.stdout, '');
  }
  const extra = spawnSync(process.execPath, [SCRIPT, '--budgets', 'x.md'], { encoding: 'utf8', env });
  assert.equal(extra.status, 2);
  assert.match(extra.stderr, /usage:/);
});
