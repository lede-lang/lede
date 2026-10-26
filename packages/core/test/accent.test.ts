// D49: `@accent` takes a CSS hex color and needs WCAG AA text contrast on the theme it lands on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LedeStream, parse } from '../src/index.ts';
import { accentContrast, contrastRatio, parseHex } from '../src/contrast.ts';

const codes = (src: string) => parse(src).diagnostics.map((d) => d.code);
const accentDiag = (src: string) => parse(src).diagnostics.find((d) => d.code === 'accent-contrast');

test('contrast ratio follows WCAG 2.x relative luminance', () => {
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contrastRatio([255, 255, 255], [0, 0, 0]), 21);
  assert.equal(contrastRatio([119, 119, 119], [119, 119, 119]), 1);
  // #767676 on white is the classic 4.54:1 boundary grey.
  assert.equal(Math.floor(contrastRatio(parseHex('#767676')!, [255, 255, 255]) * 100) / 100, 4.54);
});

test('parseHex accepts the four CSS hex forms only', () => {
  assert.deepEqual(parseHex('#abc'), [170, 187, 204, 1]);
  assert.deepEqual(parseHex('#AABBCC'), [170, 187, 204, 1]);
  assert.deepEqual(parseHex('#abcd'), [170, 187, 204, 221 / 255]);
  assert.deepEqual(parseHex('#aabbcc80'), [170, 187, 204, 128 / 255]);
  for (const bad of ['#12345', '#1234567', '#ab', 'red', 'abc', '#ggg', '#fff;}', '']) assert.equal(parseHex(bad), null, bad);
});

test('the house accents pass their own theme', () => {
  assert.ok(accentContrast('#2357c6', 'light')!.ratio >= 4.5);
  assert.ok(accentContrast('#7aa7ff', 'dark')!.ratio >= 4.5);
  assert.deepEqual(codes('@accent #2357c6\n# T'), []);
  assert.deepEqual(codes('@accent #7aa7ff\n@theme dark\n# T'), []);
});

test('a value that is not a hex color is a warning, not silently ignored', () => {
  for (const v of ['red', '#12345', '#1234567', 'rgb(0,0,0)', '#fff;}body{color:red}', '']) {
    const d = parse(`@accent ${v}\n# T`).diagnostics;
    assert.deepEqual(
      d.map((x) => [x.severity, x.code, x.line, x.col]),
      [['warning', 'accent-value', 1, 1]],
      v,
    );
  }
});

test('a low-contrast accent on the light theme warns with machine-readable detail', () => {
  const d = accentDiag('# T\n\n@accent #ffd700\n');
  assert.ok(d);
  assert.equal(d.severity, 'warning');
  assert.equal(d.line, 3);
  assert.deepEqual(d.detail, { accent: '#ffd700', theme: 'light', ratio: 1.21, required: 4.5, against: 'accent-tint' });
  assert.match(d.message, /darker/);
  assert.match(d.message, /borders and bars need 3:1/);
});

test('between 3:1 and 4.5:1 only the text bar is named', () => {
  // #3d9a5c: 3.04:1 on the light note tint.
  const d = accentDiag('@accent #3d9a5c\n# T');
  assert.ok(d);
  assert.equal(d.detail!.ratio, 3.04);
  assert.doesNotMatch(d.message, /borders/);
});

test('with no @theme the accent is checked on light only; @theme dark checks it on dark', () => {
  // A light-mode red reads fine on light surfaces; dark mode keeps the house accent unless @theme dark.
  assert.equal(accentDiag('@accent #b4372f\n# T'), undefined);
  const dark = accentDiag('@accent #b4372f\n@theme dark\n# T');
  assert.ok(dark);
  assert.equal(dark.detail!.theme, 'dark');
  assert.match(dark.message, /lighter/);
  // A pale accent passes dark and fails light.
  assert.ok(accentDiag('@accent #9dbdff\n# T'));
  assert.equal(accentDiag('@accent #9dbdff\n@theme dark\n# T'), undefined);
});

test('the check uses the final @accent and @theme, whatever their order', () => {
  assert.equal(accentDiag('@theme dark\n@accent #b4372f\n# T')!.line, 2);
  assert.equal(accentDiag('@accent #b4372f\n# T\n\nText.\n\n@theme dark\n')!.line, 1);
  // A later valid accent replaces an earlier one; a later invalid one leaves the house accent.
  assert.equal(accentDiag('@accent #ffd700\n@accent #2357c6\n# T'), undefined);
  assert.deepEqual(codes('@accent #ffd700\n@accent red\n# T'), ['accent-value']);
});

test('a translucent accent is composited over each surface', () => {
  const solid = accentContrast('#2357c6', 'light')!.ratio;
  const half = accentContrast('#2357c680', 'light')!.ratio;
  assert.ok(half < solid);
  assert.ok(accentDiag('@accent #2357c680\n# T'));
});

test('streaming: each snapshot reflects the @theme read so far', () => {
  const s = new LedeStream();
  s.write('@accent #b4372f\n# Title\n\nSome text.\n');
  assert.equal(s.snapshot().diagnostics.filter((d) => d.code === 'accent-contrast').length, 0);
  s.write('@theme dark\n');
  const mid = s.snapshot().diagnostics.filter((d) => d.code === 'accent-contrast');
  assert.equal(mid.length, 1);
  assert.equal(mid[0].line, 1);
  const end = s.end().diagnostics.filter((d) => d.code === 'accent-contrast');
  assert.deepEqual(end, mid);
});
