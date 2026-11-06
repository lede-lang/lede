// W `heading-skip` (internal spec, lede-lang/meta; spec §4.4): a heading more than one level deeper than the heading before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fix, LedeStream, parse } from '../src/index.ts';

const skips = (src: string) => parse(src).diagnostics.filter((d) => d.code === 'heading-skip');
const codes = (src: string) => parse(src).diagnostics.map((d) => d.code);

test('# then ### is a warning with detail {from, to}, on the line of the deeper heading', () => {
  const d = skips('# A\n\n### B\n');
  assert.equal(d.length, 1);
  assert.equal(d[0].severity, 'warning');
  assert.equal(d[0].line, 3);
  assert.equal(d[0].col, 1);
  assert.deepEqual(d[0].detail, { from: 1, to: 3 });
  assert.match(d[0].message, /heading jumps from # to ###; use ##, one level deeper than the heading above$/);
  assert.deepEqual(codes('# A\n\n### B\n'), ['heading-skip']);
});

test('# then ## then ### is quiet: each heading is one level deeper at most', () => {
  assert.deepEqual(codes('# A\n\n## B\n\n### C\n'), []);
});

test('a heading shallower than the one before it is quiet, whatever the distance', () => {
  assert.deepEqual(codes('### A\n\n# B\n'), []);
  assert.deepEqual(codes('# A\n\n## B\n\n### C\n\n# D\n\n## E\n'), []);
  // The same level again is quiet too.
  assert.deepEqual(codes('## A\n\n## B\n\n### C\n\n### D\n'), []);
});

test('the first heading of a document never warns, however deep', () => {
  assert.deepEqual(codes('### A\n'), []);
  assert.deepEqual(codes('Some text.\n\n### A\n\n### B\n'), []);
  // Front matter and other lines before it do not count as headings.
  assert.deepEqual(codes('@title T\n@subtitle S\n\n### A\n'), []);
});

test('### lines inside a fence are not headings: nothing between two headings changes the comparison', () => {
  assert.deepEqual(codes('# A\n\n```md\n### not a heading\n#### nor this\n```\n\n## B\n'), []);
  // And a fence does not hide a real skip on either side.
  assert.deepEqual(
    skips('# A\n\n```\n## inside\n```\n\n### B\n').map((d) => [d.line, d.detail]),
    [[7, { from: 1, to: 3 }]],
  );
  // A raw html fence and an unclosed fence hold their lines too.
  assert.deepEqual(codes('# A\n\n```=html\n<h3>x</h3>\n### y\n```\n\n## B\n'), []);
  assert.deepEqual(codes('## A\n\n```\n### x\n'), ['unclosed-fence']);
});

test('#### after ## compares at the written level 4: it warns, and heading-depth warns as well', () => {
  const d = parse('# A\n\n## B\n\n#### C\n').diagnostics;
  assert.deepEqual(
    d.map((x) => [x.code, x.line]),
    [
      ['heading-skip', 5],
      ['heading-depth', 5],
    ],
  );
  assert.deepEqual(d[0].detail, { from: 2, to: 4 });
  assert.match(d[0].message, /from ## to ####; use ###,/);
});

test('the next heading is compared with the last one as written, the clamped #### included', () => {
  // ## then #### skips; #### then ### is shallower, so it is quiet; ### then ##### skips from 3 to 5.
  assert.deepEqual(
    skips('## A\n\n#### B\n\n### C\n\n##### D\n').map((d) => d.detail),
    [
      { from: 2, to: 4 },
      { from: 3, to: 5 },
    ],
  );
  // After a skip the skipping heading is the one compared against, so ### then #### does not warn again.
  assert.deepEqual(
    skips('# A\n\n### B\n\n#### C\n').map((d) => d.detail),
    [{ from: 1, to: 3 }],
  );
});

test('an empty heading still counts as a heading', () => {
  assert.deepEqual(codes('# A\n\n###\n'), ['heading-skip', 'empty-heading']);
});

test('cards: ### one level under ## is quiet, one level under # is a skip', () => {
  assert.deepEqual(codes('## Options\n\ncards\n### One\nText.\n### Two\nText.\n'), []);
  assert.deepEqual(
    skips('# Title\n\ncards\n### One\nText.\n### Two\nText.\n').map((d) => [d.line, d.detail]),
    [[4, { from: 1, to: 3 }]],
  );
});

test('@title does not shift the outline: the headings are compared as written', () => {
  assert.deepEqual(codes('@title T\n\n## A\n\n### B\n'), []);
  assert.deepEqual(
    skips('@title T\n\n# A\n\n### B\n').map((d) => d.detail),
    [{ from: 1, to: 3 }],
  );
});

test('a skip is raised in a document that arrives a character at a time, as in one piece', () => {
  const src = '# A\n\nText.\n\n### B\n\n## C\n\n#### D\n';
  const s = new LedeStream();
  const seen: number[] = [];
  for (const ch of src) {
    s.write(ch);
    // The skip is on the doc as soon as the heading line is whole, and never twice.
    seen.push(s.doc.diagnostics.filter((d) => d.code === 'heading-skip').length);
  }
  assert.deepEqual(seen.slice(0, 4), [0, 0, 0, 0]);
  const at = src.indexOf('### B\n');
  assert.equal(seen[at + 4], 0, 'the line is not whole before its newline');
  assert.equal(seen[at + 5], 1, 'the newline completes it');
  const doc = s.end();
  assert.deepEqual(doc.diagnostics, parse(src).diagnostics);
  assert.deepEqual(
    doc.diagnostics.filter((d) => d.code === 'heading-skip').map((d) => d.detail),
    [
      { from: 1, to: 3 },
      { from: 2, to: 4 },
    ],
  );
  // snapshot() re-parses the lines so far, and reaches the same verdict.
  assert.deepEqual(
    s.snapshot().diagnostics.map((d) => d.code),
    parse(src).diagnostics.map((d) => d.code),
  );
});

test('fix() leaves heading-skip alone (no single right level) and still shortens a #### beside it', () => {
  const plain = '# A\n\n### B\n';
  const r = fix(plain);
  assert.equal(r.src, plain);
  assert.deepEqual(r.applied, []);
  assert.deepEqual(
    r.remaining.map((d) => d.code),
    ['heading-skip'],
  );

  const deep = fix('# A\n\n#### B\n');
  assert.equal(deep.src, '# A\n\n### B\n');
  assert.deepEqual(
    deep.applied.map((a) => a.code),
    ['heading-depth'],
  );
  assert.deepEqual(
    deep.remaining.map((d) => [d.code, d.detail]),
    [['heading-skip', { from: 1, to: 3 }]],
  );

  // The shortening can also make the skip go away: ## then #### becomes ## then ###.
  const gone = fix('## A\n\n#### B\n');
  assert.equal(gone.src, '## A\n\n### B\n');
  assert.deepEqual(gone.remaining, []);
});
