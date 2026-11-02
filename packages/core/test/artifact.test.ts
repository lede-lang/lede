import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artifactDiagnostics, parse } from '../src/index.ts';

const SUFFIX = '; inline it as a data: URI or upload it as an asset and use the asset URL';
const check = (src: string) => artifactDiagnostics(parse(src));
const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

test('a relative image at the top level is a warning at its line, column 1, with the source in detail', () => {
  const found = check('# Hi\n\nimage fig.png "A figure"\n');
  assert.equal(found.length, 1);
  const [d] = found;
  assert.equal(d.severity, 'warning');
  assert.equal(d.code, 'artifact-image');
  assert.equal(d.line, 3);
  assert.equal(d.col, 1);
  assert.ok(d.message.endsWith(SUFFIX), d.message);
  assert.ok(d.message.includes('fig.png'), d.message);
  assert.deepEqual(d.detail, { src: 'fig.png', kind: 'local' });
});

test('an image inside a grid is found at its own line', () => {
  const found = check('# Hi\n\ngrid 2\nimage a.png "A"\nimage sub/b.png "B"\n');
  assert.deepEqual(
    found.map((d) => [d.line, d.col, d.detail]),
    [
      [4, 1, { src: 'a.png', kind: 'local' }],
      [5, 1, { src: 'sub/b.png', kind: 'local' }],
    ],
  );
  assert.ok(found.every((d) => d.code === 'artifact-image' && d.message.endsWith(SUFFIX)));
});

test('an image inside a cards section is found', () => {
  const found = check('# Hi\n\ncards\n### One\nimage c.png "C"\n### Two\nplain text\n');
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 5);
  assert.equal(found[0].col, 1);
  assert.deepEqual(found[0].detail, { src: 'c.png', kind: 'local' });
});

test('a data: image raises nothing', () => {
  assert.deepEqual(check(`# Hi\n\nimage ${GIF} "Pixel"\n`), []);
});

test('a remote image raises nothing here (the remote rule is the renderer`s, D20)', () => {
  assert.deepEqual(check('# Hi\n\nimage https://example.com/a.png "Remote"\n'), []);
});

test('a page with no image gives an empty array', () => {
  assert.deepEqual(check('# Hi\n\nSome text.\n\nkpi p99 | 182 ms | -38% | good\n'), []);
});

test('only the relative images of a mixed page are reported, in document order', () => {
  const found = check(`image a.png "A"\nimage ${GIF} "B"\nimage https://example.com/c.png "C"\nimage d.png "D"\n`);
  assert.deepEqual(
    found.map((d) => d.detail?.src),
    ['a.png', 'd.png'],
  );
});

test('the check does not change the document it reads', () => {
  const doc = parse('image fig.png "A figure"\n');
  const before = JSON.stringify(doc);
  artifactDiagnostics(doc);
  assert.equal(JSON.stringify(doc), before);
});
