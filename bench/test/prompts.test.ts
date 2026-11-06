// The refinement test's prompt files against D67 in DECISIONS.md (where they disagree, D67 wins) and against the harness.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BENCH = join(import.meta.dirname, '..');
const prompt = (name: string) => readFileSync(join(BENCH, 'prompts', name), 'utf8');
const decisions = readFileSync(join(BENCH, '..', 'DECISIONS.md'), 'utf8');

test('the feedback line is the one D67 quotes, once, on one line', () => {
  const d67 = /^## D67\. .*?(?=^## D68\.)/ms.exec(decisions)?.[0].replace(/\s+/g, ' ') ?? assert.fail('no D67');
  const line = /both writers given one line: "(.*?)"; and Lede hinted/.exec(d67)?.[1] ?? assert.fail('D67 does not quote the line');
  assert.equal(prompt('refine-feedback.md'), `${line}\n`);
});

test('the revision wrapper holds the writer prompt, brief, page in a fence, feedback and the write-once instruction, in that order', () => {
  const wrapper = prompt('refine-revision.md');
  const at = [
    '{{WRITER_PROMPT}}',
    'Brief:\n{{BRIEF}}',
    'Your page as written:\n````\n{{PAGE}}\n````',
    'Feedback:\n{{FEEDBACK}}',
    'Read no file and run no command.',
  ].map((s) => wrapper.indexOf(s));
  assert.ok(
    at.every((i) => i >= 0),
    at.join(),
  );
  assert.deepEqual(
    at.toSorted((a, b) => a - b),
    at,
  );
  assert.match(wrapper, /Write the complete revised page, once\./);
  assert.equal(wrapper.split('{{').length - 1, 4);
});

test('judge-v2.md is judge.md plus the tie paragraph and the header-record rule', () => {
  const v1 = prompt('judge.md');
  const v2 = prompt('judge-v2.md');
  assert.ok(v2.startsWith(v1), 'judge.md is a prefix');
  const added = v2.slice(v1.length);
  assert.match(
    added,
    /^\nA tie is a real answer, not a failure to decide\. Answer TIE when both pages are complete, legible at both widths and free of defects \(overlapping or clipped labels, cut-off content, unreadable dark mode, a chart not drawn to scale\) and your preference would rest on style alone\. Some pairs should be ties; a judge who never ties is not using the scale\. Give the reason in one sentence that names the deciding element, or for a tie what both pages did well\.\n/,
  );
  assert.ok(added.includes('{"judge":"claude-sonnet-5-5","prompt":"judge-v2.md"}\n'));
  assert.ok(added.includes('`winner` is `LEFT`, `RIGHT` or `TIE`.'));
  assert.ok(v1.endsWith('Answer TIE only when you genuinely cannot prefer one.\n'));
});

test('the tasks writer prompt names the eleven categories, the closed vocabulary, and never the format it is not to know', () => {
  const writer = prompt('tasks-writer.md');
  for (const slug of [
    'architecture',
    'comparison',
    'data',
    'prose',
    'runbook',
    'status',
    'specs-planning',
    'code-review',
    'design',
    'reports',
    'custom-editing',
  ]) {
    assert.ok(writer.includes(`- \`${slug}\` (`), slug);
  }
  for (const need of ['list', 'table', 'callout', 'chart', 'kpi', 'diagram', 'sequence']) assert.ok(writer.includes(`\`${need}\` (`), need);
  assert.match(writer, /two to five of these words and nothing else/);
  assert.ok(!/lede/i.test(writer), 'the writer must never see the format name');
  assert.ok(!/\.lede|\.html|bench\/|renderer|spec\b/i.test(writer));
  assert.match(writer, /Output exactly 55 lines\./);
  assert.ok(writer.endsWith('Ten finished examples follow. They are pretty-printed to be read; yours are one line each.\n'));
});
