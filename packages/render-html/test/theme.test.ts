// Motion guard (internal spec, lede-lang/meta): the compiler's CSS holds no `transition`, `animation` or `scroll-behavior` outside
// an `@media (prefers-reduced-motion:no-preference){...}` block. There is none at all in the base stylesheet today; this test pins
// that nothing is added unguarded, so that smooth scrolling and layer switches are written against it (WCAG 2.3.3, 2.2.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { css } from '../src/theme.ts';

const GUARD = /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)\s*\{/g;
const MOTION = /transition|animation|scroll-behavior/;

/** `src` with every `@media (prefers-reduced-motion:no-preference){...}` block removed; the braces are counted, so nesting is safe. */
function withoutGuardedMotion(src: string): string {
  let out = '';
  let from = 0;
  for (const m of src.matchAll(GUARD)) {
    if (m.index < from) continue; // inside a block already removed
    out += src.slice(from, m.index);
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    assert.equal(depth, 0, 'unbalanced braces after a prefers-reduced-motion block');
    from = i;
  }
  return out + src.slice(from);
}

const SETTINGS: Array<[string, Parameters<typeof css>[0]]> = [
  ['css({})', {}],
  ["css({theme:'dark'})", { theme: 'dark' }],
  ["css({theme:'light'})", { theme: 'light' }],
  ['css({wide:true})', { wide: true }],
];

for (const [name, opts] of SETTINGS) {
  test(`${name} has no transition, animation or scroll-behavior outside prefers-reduced-motion:no-preference`, () => {
    const sheet = css(opts);
    assert.ok(sheet.length > 1000, 'the stylesheet is not empty');
    const rest = withoutGuardedMotion(sheet);
    const hit = MOTION.exec(rest);
    assert.equal(hit, null, hit ? `unguarded motion near: ${rest.slice(Math.max(0, hit.index - 80), hit.index + 80)}` : '');
  });
}

test('the guard scan removes a guarded block, nested braces included, and keeps what follows it', () => {
  const guarded = '@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}.a{transition:color .1s}}';
  assert.equal(withoutGuardedMotion(`a{color:red}${guarded}b{color:blue}`), 'a{color:red}b{color:blue}');
  assert.equal(withoutGuardedMotion(`@media (prefers-reduced-motion: no-preference) {\n${guarded}\n}\nc{}`), '\nc{}');
  assert.equal(withoutGuardedMotion('a{}'), 'a{}');
});

test('the guard scan leaves unguarded motion, and a reduce block is not a guard', () => {
  for (const decl of ['a{transition:color .1s}', 'a{animation:spin 1s}', 'html{scroll-behavior:smooth}']) {
    assert.match(withoutGuardedMotion(`${decl}@media (prefers-reduced-motion:no-preference){b{transition:none}}`), MOTION, decl);
    assert.match(withoutGuardedMotion(`@media (prefers-reduced-motion:reduce){${decl}}`), MOTION, decl);
  }
});
