// The first-block rules and the edit counting in stream-edit-demo.ts. No browser, no API.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editSize, htmlFirstBlock, ledeFirstBlock, lineHunks, quantile } from '../src/stream-edit-demo.ts';

test('Lede: the first block arrives with the newline that ends its line, and a data set does not count', () => {
  const src = '# Title\n\nSome prose.\n';
  const at = ledeFirstBlock(src);
  assert.ok(at !== null && at <= src.length);
  assert.ok(src.slice(0, at).endsWith('\n'));
  assert.equal(ledeFirstBlock('# T'), null);
  const withData = 'data t = a,b; 1,2\n\n# Heading\n';
  const hit = ledeFirstBlock(withData);
  assert.ok(withData.slice(0, hit ?? 0).includes('# Heading'));
});

test('HTML: style, script and empty containers do not count; the first closed leaf with text does', () => {
  const head = '<!doctype html><html><head><style>h1{color:red}p{margin:0}</style></head>';
  const body = '<body><header><div class="x"></div></header><script>1</script><h1>Hi <b>there</b></h1><p>later</p></body></html>';
  const src = head + body;
  const at = htmlFirstBlock(src);
  assert.equal(src.slice(0, at ?? 0).endsWith('</h1>'), true);
  assert.equal(src.slice(0, at ?? 0).includes('<p>'), false);
});

test('HTML: hidden leaves, comments and empty leaves are skipped; an svg counts; no head falls back to the last style', () => {
  const a = '<style>x{}</style><!-- <h1>no</h1> --><p hidden>no</p><p> </p><h2>yes</h2>';
  assert.equal(a.slice(0, htmlFirstBlock(a) ?? 0).endsWith('<h2>yes</h2>'), true);
  const b = '<head></head><body><svg viewBox="0 0 1 1"><rect/></svg><h1>x</h1>';
  assert.equal(b.slice(0, htmlFirstBlock(b) ?? 0).endsWith('</svg>'), true);
  assert.equal(htmlFirstBlock('<head><style>p{}</style></head><body><p>open'), null);
});

test('lineHunks and editSize count a replacement, an insertion and a deletion', () => {
  assert.deepEqual(lineHunks('a\nb\nc', 'a\nb\nc'), []);
  const rep = editSize('a\nvalue 140\nc', 'a\nvalue 141\nc');
  assert.equal(rep.linesAdded, 1);
  assert.equal(rep.linesRemoved, 1);
  assert.equal(rep.changedLines, 2);
  assert.equal(rep.charsInserted, 1);
  assert.equal(rep.charsDeleted, 1);
  const ins = editSize('a\nc', 'a\nb\nc');
  assert.deepEqual([ins.linesAdded, ins.linesRemoved, ins.charsInserted], [1, 0, 1]);
  const del = editSize('a\nbb\nc', 'a\nc');
  assert.deepEqual([del.linesAdded, del.linesRemoved, del.charsDeleted], [0, 1, 2]);
  const two = editSize('1\nx\n2\ny\n3', '1\nX\n2\nY\n3');
  assert.equal(two.changedLines, 4);
});

test('quantile interpolates', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([5], 0.25), 5);
});
