// check-tasks.ts on synthetic task directories: it passes a well-formed set of 55, names the file and the rule for each way a set
// can be wrong, and never prints a brief.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATEGORIES, NEEDS } from '../src/task-vocab.ts';

const SCRIPT = join(import.meta.dirname, '..', 'src', 'check-tasks.ts');
const SECRET = 'The harbour pilots rota for week 44, Marguerite Oyelaran asks';
const tmp = mkdtempSync(join(tmpdir(), 'lede-check-tasks-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let sets = 0;

type Task = Record<string, unknown>;
const valid = (i: number): Task => ({
  id: `${131 + i}-task-${i}`,
  category: CATEGORIES[Math.floor(i / 5)],
  title: `Task ${i}`,
  brief: `${SECRET} number ${i}.`,
  checklist: { sections: ['Plan'], visible: ['Rota'], values: ['44'] },
  needs: NEEDS.slice(0, 1 + (i % NEEDS.length)),
  edit: { request: 'Change 44 to 45.', expect_visible: [], expect_values: ['45'], expect_absent: ['44'] },
});

/** Writes a set of 55 tasks, lets `change` alter the list of [file name, task or raw text], and runs the check on it. */
function check(change: (files: [string, Task | string][]) => void = () => undefined) {
  const dir = join(tmp, String(sets++));
  const files: [string, Task | string][] = Array.from({ length: 55 }, (_, i) => [`${131 + i}-task-${i}.json`, valid(i)]);
  change(files);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of files) writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  const run = spawnSync(process.execPath, [SCRIPT, '131', '185', '--dir', dir], { encoding: 'utf8' });
  return { status: run.status, out: run.stdout, files: readdirSync(dir).length };
}

test('a well-formed set passes and prints counts only', () => {
  const r = check();
  assert.equal(r.status, 0);
  assert.match(r.out, /^files 55 of 55 \(ids 131-185\)$/m);
  assert.match(
    r.out,
    /categories: architecture 5, comparison 5, data 5, prose 5, runbook 5, status 5, specs-planning 5, code-review 5, design 5, reports 5, custom-editing 5/,
  );
  assert.match(r.out, /all fields present: 55 of 55/);
  assert.match(r.out, /needs within the closed set \(list table callout chart kpi diagram sequence\): 55 of 55/);
  assert.match(r.out, /no technology word in the brief: 55 of 55/);
  assert.match(r.out, /^ok$/m);
  assert.ok(!r.out.includes(SECRET) && !r.out.includes('harbour'));
});

test('a technology word in a brief fails with the file and the rule, not the brief or the word', () => {
  for (const word of ['Lede', 'HTML', 'CSS', 'Markdown', 'Mermaid', 'React', 'SVG', 'JavaScript']) {
    const r = check((files) => {
      (files[7][1] as Task).brief = `${SECRET} in ${word} please.`;
    });
    assert.equal(r.status, 1, word);
    assert.match(r.out, /^FAIL 138-task-7\.json: a technology word in the brief$/m, word);
    assert.ok(!r.out.includes(SECRET) && !r.out.includes(word), `${word} was printed`);
  }
  // whole words only: "Reaction" and "SVGish" are not the words
  assert.equal(check((files) => ((files[3][1] as Task).brief = 'A Reaction and an SVGish thing')).status, 0);
});

test('needs outside the closed vocabulary, an unknown or missing category', () => {
  let r = check((files) => ((files[2][1] as Task).needs = ['table', 'heatmap']));
  assert.match(r.out, /^FAIL 133-task-2\.json: needs outside the closed vocabulary$/m);
  assert.match(r.out, /needs within the closed set .*: 54 of 55/);
  r = check((files) => ((files[0][1] as Task).category = 'essay'));
  assert.match(r.out, /^FAIL 131-task-0\.json: category is not one of the eleven$/m);
  assert.match(r.out, /^FAIL \(set\): category architecture has 4 tasks, not 5$/m);
  assert.equal(r.status, 1);
});

test('five per category: a sixth in one category is a failure of the set', () => {
  const r = check((files) => ((files[54][1] as Task).category = 'architecture'));
  assert.match(r.out, /^FAIL \(set\): category architecture has 6 tasks, not 5$/m);
  assert.match(r.out, /^FAIL \(set\): category custom-editing has 4 tasks, not 5$/m);
});

test('fields: each missing one is named', () => {
  const drops: [string, (t: Task) => void, RegExp][] = [
    ['title', (t) => delete t.title, /field title missing/],
    ['brief', (t) => delete t.brief, /field brief missing/],
    ['checklist', (t) => delete t.checklist, /field checklist\.sections missing or empty/],
    ['values', (t) => ((t.checklist as Task).values = []), /field checklist\.values missing or empty/],
    ['needs', (t) => delete t.needs, /field needs missing or empty/],
    ['edit', (t) => delete t.edit, /field edit\.request missing/],
    ['expect', (t) => ((t.edit as Task).expect_absent = 'no'), /field edit\.expect_absent missing/],
  ];
  for (const [name, drop, rule] of drops) {
    const r = check((files) => drop(files[10][1] as Task));
    assert.equal(r.status, 1, name);
    assert.match(r.out, new RegExp(`^FAIL 141-task-10\\.json: ${rule.source}$`, 'm'), name);
  }
  const nothing = check(
    (files) => ((files[10][1] as Task).edit = { request: 'x', expect_visible: [], expect_values: [], expect_absent: [] }),
  );
  assert.match(nothing.out, /^FAIL 141-task-10\.json: edit expects nothing$/m);
});

test('ids: a missing file, a duplicate, an id that disagrees with its file name, and unreadable JSON', () => {
  let r = check((files) => files.splice(20, 1));
  assert.match(r.out, /^FAIL \(set\): 54 files, not 55$/m);
  assert.match(r.out, /^FAIL \(set\): no file for ids 151$/m);

  r = check((files) => files.splice(20, 3));
  assert.match(r.out, /^FAIL \(set\): no file for ids 151, 152, 153$/m);

  r = check((files) => files.push(['131-another.json', valid(0)]));
  assert.match(r.out, /^FAIL \(set\): 56 files, not 55$/m);
  assert.match(r.out, /^FAIL \(set\): 2 files for id 131$/m);

  r = check((files) => ((files[5][1] as Task).id = '999-task-5'));
  assert.match(r.out, /^FAIL 136-task-5\.json: id does not start with the number in the file name$/m);

  r = check((files) => (files[6][1] = `{ "brief": "${SECRET}", `));
  assert.match(r.out, /^FAIL 137-task-6\.json: not valid JSON$/m);
  assert.ok(!r.out.includes(SECRET));
});

test('only the id range is read: files outside it are ignored', () => {
  assert.equal(check((files) => files.push(['130-old.json', '{}'], ['186-new.json', '{}'])).status, 0);
});
