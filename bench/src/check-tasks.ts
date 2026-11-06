// Structure check for a set of fresh held-out tasks, run before they are sealed (internal spec, lede-lang/meta):
//   node bench/src/check-tasks.ts 131 185 [--dir <tasks directory>]
// Checks the files <min>-*.json to <max>-*.json: 55 files with contiguous ids, five per category of the eleven, every field the
// task format has, `needs` inside the closed vocabulary, and no technology word in a brief. It prints counts, and for a failure
// the file name and the rule that failed, never a brief or anything else a task says: the people who run it do not read the
// tasks until the held-out round. Exit status 1 on any failure.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, NEEDS } from './task-vocab.ts';

const ROOT = join(import.meta.dirname, '..');
const PER_CATEGORY = 5;
const FILES = CATEGORIES.length * PER_CATEGORY;
const TECHNOLOGY = /\b(Lede|HTML|CSS|Markdown|Mermaid|React|SVG|JavaScript)\b/;

const args = process.argv.slice(2);
const at = args.indexOf('--dir');
const dir = at >= 0 ? args[at + 1] : join(ROOT, 'tasks');
const [min, max] = args.filter((a, i) => a !== '--dir' && (at < 0 || i !== at + 1)).map(Number);
if (!Number.isInteger(min) || !Number.isInteger(max) || dir === undefined)
  throw new Error('usage: check-tasks.ts <min-id> <max-id> [--dir <tasks directory>]');

const failures: string[] = [];
const fail = (where: string, rule: string) => failures.push(`FAIL ${where}: ${rule}`);

const isStrings = (v: unknown, nonEmpty: boolean): v is string[] =>
  Array.isArray(v) && (!nonEmpty || v.length > 0) && v.every((s) => typeof s === 'string' && s.trim() !== '');
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const prefix = (name: string) => /^(\d+)-/.exec(name)?.[1];
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && prefix(f) !== undefined && Number(prefix(f)) >= min && Number(prefix(f)) <= max)
  .sort((a, b) => Number(prefix(a)) - Number(prefix(b)));

if (max - min + 1 !== FILES) fail('(set)', `the id range holds ${max - min + 1} ids, not ${FILES}`);
if (files.length !== FILES) fail('(set)', `${files.length} files, not ${FILES}`);
const seen = new Map<number, number>();
for (const f of files) seen.set(Number(prefix(f)), (seen.get(Number(prefix(f))) ?? 0) + 1);
const missing: number[] = [];
for (let id = min; id <= max; id++) if (!seen.has(id)) missing.push(id);
if (missing.length > 0) fail('(set)', `no file for ids ${missing.join(', ')}`);
for (const [id, n] of seen) if (n > 1) fail('(set)', `${n} files for id ${id}`);

const perCategory = new Map<string, number>();
let fieldsOk = 0;
let needsOk = 0;
let wordsOk = 0;
for (const f of files) {
  let t: Record<string, unknown>;
  try {
    t = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
  } catch {
    fail(f, 'not valid JSON');
    continue;
  }
  const problems: string[] = [];
  const checklist = (t.checklist ?? {}) as Record<string, unknown>;
  const edit = (t.edit ?? {}) as Record<string, unknown>;
  if (!isText(t.id)) problems.push('field id missing');
  else if (prefix(t.id) !== prefix(f)) problems.push('id does not start with the number in the file name');
  if (!isText(t.category)) problems.push('field category missing');
  if (!isText(t.title)) problems.push('field title missing');
  if (!isText(t.brief)) problems.push('field brief missing');
  if (!isStrings(checklist.sections, true)) problems.push('field checklist.sections missing or empty');
  if (!isStrings(checklist.visible, true)) problems.push('field checklist.visible missing or empty');
  if (!isStrings(checklist.values, true)) problems.push('field checklist.values missing or empty');
  if (!isStrings(t.needs, true)) problems.push('field needs missing or empty');
  if (!isText(edit.request)) problems.push('field edit.request missing');
  for (const k of ['expect_visible', 'expect_values', 'expect_absent'])
    if (!isStrings(edit[k], false)) problems.push(`field edit.${k} missing`);
  if (['expect_visible', 'expect_values', 'expect_absent'].every((k) => Array.isArray(edit[k]) && edit[k].length === 0))
    problems.push('edit expects nothing');
  for (const p of problems) fail(f, p);
  if (problems.length === 0) fieldsOk++;

  if (typeof t.category === 'string') {
    if (CATEGORIES.includes(t.category as (typeof CATEGORIES)[number])) perCategory.set(t.category, (perCategory.get(t.category) ?? 0) + 1);
    else fail(f, 'category is not one of the eleven');
  }
  if (Array.isArray(t.needs)) {
    if (t.needs.every((n) => NEEDS.includes(n as (typeof NEEDS)[number]))) needsOk++;
    else fail(f, 'needs outside the closed vocabulary');
  }
  if (typeof t.brief === 'string') {
    if (TECHNOLOGY.test(t.brief)) fail(f, 'a technology word in the brief');
    else wordsOk++;
  }
}
for (const c of CATEGORIES)
  if ((perCategory.get(c) ?? 0) !== PER_CATEGORY) fail('(set)', `category ${c} has ${perCategory.get(c) ?? 0} tasks, not ${PER_CATEGORY}`);

console.log(`files ${files.length} of ${FILES} (ids ${min}-${max})`);
console.log(`categories: ${CATEGORIES.map((c) => `${c} ${perCategory.get(c) ?? 0}`).join(', ')}`);
console.log(`all fields present: ${fieldsOk} of ${files.length}`);
console.log(`needs within the closed set (${NEEDS.join(' ')}): ${needsOk} of ${files.length}`);
console.log(`no technology word in the brief: ${wordsOk} of ${files.length}`);
if (failures.length > 0) {
  for (const line of failures) console.log(line);
  console.log(`${failures.length} failures`);
  process.exitCode = 1;
} else console.log('ok');
