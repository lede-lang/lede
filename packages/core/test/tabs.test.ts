// A page of tabs (spec §4.21, D85): the `tab` line and what `resolveTabs` adds once the parts are read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LedeStream, TAB_MAX, parse, resolveTabs, tabsOf, type LedeDocument, type TabBlock } from '../src/index.ts';

const codes = (doc: LedeDocument) => doc.diagnostics.map((d) => `${d.line}:${d.code}`);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Resolves `doc`'s tabs from an in-memory folder; a name missing from it cannot be read, one starting `../` is outside. */
function resolveFrom(doc: LedeDocument, files: Record<string, string>) {
  return resolveTabs(doc, {
    read: (t: TabBlock) => {
      if (t.path.startsWith('../')) throw Object.assign(new Error('outside'), { reason: 'outside' });
      const src = files[t.path];
      if (src === undefined) throw Object.assign(new Error(`${t.path}: no such file`), { reason: 'missing' });
      return { src, doc: parse(src) };
    },
    sha256,
  });
}

test('a tab line takes an optional label, a .lede path and an optional pin', () => {
  const doc = parse('tab Costs and *risks* < parts/costs.lede\ntab < risks.lede #ABCDEF012345\n');
  assert.deepEqual(tabsOf(doc), [
    { type: 'tab', label: 'Costs and *risks*', path: 'parts/costs.lede', pin: null, line: 1 },
    { type: 'tab', label: null, path: 'risks.lede', pin: 'abcdef012345', line: 2 },
  ]);
  assert.deepEqual(doc.diagnostics, []);
});

test('a line that only starts with tab stays prose', () => {
  for (const line of [
    'tab the Costs sheet over',
    'tab',
    'tab < notes.md',
    'tab Costs < costs.lede and more',
    'tab Costs < costs.lede #abc',
    'tabs < x.lede',
  ]) {
    const doc = parse(`${line}\n`);
    assert.equal(doc.blocks[0]?.type, 'paragraph', line);
    assert.deepEqual(doc.diagnostics, [], line);
  }
});

test('after the first tab line only tabs and @ lines may come; blocks before it are the lead', () => {
  const doc = parse('@title Review\n\nLead.\n\n## Lead heading\n\ntab A < a.lede\n@subtitle Late\n\ntab B < b.lede\n\nStray.\n\n- item\n');
  assert.deepEqual(codes(doc), ['12:tab-trailing', '14:tab-trailing']);
  assert.equal(doc.meta.subtitle, 'Late');
});

test('a tab line ends an open grid or cards run', () => {
  const doc = parse('grid 2\n\nOne.\n\ntab A < a.lede\n');
  assert.deepEqual(
    doc.blocks.map((b) => b.type),
    ['grid', 'tab'],
  );
  assert.deepEqual(codes(doc), ['1:grid-unfilled']);
});

test('a path named twice is E tab-duplicate, and a tab past the limit is E tab-count', () => {
  const dup = parse('tab A < a.lede\ntab Again < ./a.lede\n');
  assert.deepEqual(codes(dup), ['2:tab-duplicate']);
  assert.equal(tabsOf(dup).length, 1);
  const many = parse(Array.from({ length: TAB_MAX + 1 }, (_, i) => `tab < p${i}.lede`).join('\n'));
  assert.deepEqual(codes(many), [`${TAB_MAX + 1}:tab-count`]);
  assert.deepEqual(many.diagnostics[0].detail, { count: TAB_MAX + 1, max: TAB_MAX });
});

test('a tab line streams as its own block', () => {
  const s = new LedeStream();
  const out = [...s.write('@title T\n'), ...s.write('tab A < a.lede\n'), ...s.write('tab < b.lede\n')];
  assert.deepEqual(
    out.map((b) => b.type),
    ['tab', 'tab'],
  );
  assert.deepEqual(s.end().blocks, parse('@title T\ntab A < a.lede\ntab < b.lede\n').blocks);
});

test('the label is the line, else the part title, else its first # heading, else the file name', () => {
  const doc = parse('tab Given < a.lede\ntab < b.lede\ntab < c.lede\ntab < sub/d-e.lede\n');
  const parts = resolveFrom(doc, {
    'a.lede': '@title A',
    'b.lede': '@title Bee\n# Heading',
    'c.lede': 'Lead.\n# Sea',
    'sub/d-e.lede': 'x',
  });
  assert.deepEqual(
    parts.map((p) => p.label),
    ['Given', 'Bee', 'Sea', 'd-e'],
  );
  assert.deepEqual(
    parts.map((p) => p.sha),
    ['@title A', '@title Bee\n# Heading', 'Lead.\n# Sea', 'x'].map((s) => sha256(s).slice(0, 12)),
  );
});

test('a part that cannot be read is E tab-path with its kind, and is left out', () => {
  const doc = parse('tab < ../up.lede\ntab < gone.lede\ntab < ok.lede\n');
  const parts = resolveFrom(doc, { 'ok.lede': 'Ok.' });
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.line, d.code, d.detail]),
    [
      [1, 'tab-path', { path: '../up.lede', kind: 'outside' }],
      [2, 'tab-path', { path: 'gone.lede', kind: 'missing' }],
    ],
  );
  assert.deepEqual(
    parts.map((p) => p.tab.path),
    ['ok.lede'],
  );
});

test('a pin the part no longer matches is E tab-stale; a matching prefix of any length passes', () => {
  const src = '# Costs\n';
  const full = sha256(src);
  const ok = parse(`tab < a.lede #${full.slice(0, 12)}\ntab < b.lede #${full.toUpperCase()}\n`);
  resolveFrom(ok, { 'a.lede': src, 'b.lede': src });
  assert.deepEqual(ok.diagnostics, []);
  const stale = parse('tab < a.lede #000000000000\n');
  resolveFrom(stale, { 'a.lede': src });
  assert.deepEqual(
    stale.diagnostics.map((d) => [d.code, d.detail]),
    [['tab-stale', { path: 'a.lede', pinned: '000000000000', actual: full.slice(0, 12) }]],
  );
});

test("a part's own tab lines, page-level keys and clashing question names are reported on the part", () => {
  const doc = parse('ask who | Who?\ntab < a.lede\ntab < b.lede\n');
  const parts = resolveFrom(doc, {
    'a.lede': '@title A\n@accent #1d4ed8\n  @fonts book\n```\n@theme dark\n```\n@width wide\nask plan | Plan?\n',
    'b.lede': 'ask plan | Again?\nask who | Who else?\ntab < c.lede\n',
  });
  assert.deepEqual(
    parts[0].doc.diagnostics.filter((d) => d.code.startsWith('tab-')).map((d) => [d.line, d.col, d.code, d.detail]),
    [
      [2, 1, 'tab-part-meta', { key: 'accent', part: 'a.lede' }],
      [3, 3, 'tab-part-meta', { key: 'fonts', part: 'a.lede' }],
    ],
  );
  assert.deepEqual(
    parts[1].doc.diagnostics.filter((d) => d.code.startsWith('tab-')).map((d) => [d.line, d.code, d.detail]),
    [
      [3, 'tab-nested', { path: 'c.lede' }],
      [1, 'tab-field-clash', { name: 'plan', other: 'a.lede' }],
      [2, 'tab-field-clash', { name: 'who', other: 'the manifest' }],
    ],
  );
});
