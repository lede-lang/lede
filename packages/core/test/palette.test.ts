// The palette table (D74, built for D80): every palette holds the rules the renderer's design leans on, in both themes, so that a
// colour a page draws on a ground is readable before any browser sees it. The ratios are `contrastRatio`'s, rounded down to two
// decimals as `accentContrast` does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXED_TOKENS, PALETTES, PALETTE_NAMES, PALETTE_TOKENS, THEME_SURFACES, paletteSurfaces, parseTheme } from '../src/index.ts';
import { contrastRatio, parseHex } from '../src/contrast.ts';

const THEMES = ['light', 'dark'] as const;
const ratio = (a: string, b: string): number => Math.floor(contrastRatio(parseHex(a)!, parseHex(b)!) * 100) / 100;
const lum = (hex: string): number => {
  const [r, g, b] = parseHex(hex)!
    .slice(0, 3)
    .map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test('the table has five palettes of twelve opaque hex tokens in each theme', () => {
  assert.deepEqual(Object.keys(PALETTES), [...PALETTE_NAMES]);
  assert.deepEqual([...PALETTE_NAMES], ['paper', 'slate', 'sand', 'forest', 'plum']);
  for (const name of PALETTE_NAMES)
    for (const theme of THEMES) {
      assert.deepEqual(Object.keys(PALETTES[name][theme]), [...PALETTE_TOKENS], `${name} ${theme}`);
      for (const [k, v] of Object.entries(PALETTES[name][theme])) assert.match(v, /^#[0-9a-f]{6}$/, `${name} ${theme} ${k}`);
    }
  for (const theme of THEMES) for (const [k, v] of Object.entries(FIXED_TOKENS[theme])) assert.match(v, /^#[0-9a-f]{6}$/, `${theme} ${k}`);
});

test('paper is the house palette, and the surfaces accessor and the compatibility alias read it', () => {
  assert.deepEqual(paletteSurfaces('paper', 'light'), { bg: '#fbfbfa', surface: '#ffffff', 'accent-tint': '#e9effb' });
  assert.deepEqual(paletteSurfaces('paper', 'dark'), { bg: '#131416', surface: '#1b1c1f', 'accent-tint': '#1b2944' });
  assert.deepEqual(paletteSurfaces('sand', 'light'), { bg: '#faf6ee', surface: '#fffdf8', 'accent-tint': '#f7e8de' });
  for (const theme of THEMES) assert.deepEqual(THEME_SURFACES[theme], paletteSurfaces('paper', theme));
  // A missing or unknown name is the house palette, and a name that is a property of every object is no palette.
  for (const name of [undefined, '', 'Paper', 'neon', 'constructor', '__proto__', 'toString'])
    assert.deepEqual(paletteSurfaces(name, 'light'), paletteSurfaces('paper', 'light'), String(name));
});

for (const name of PALETTE_NAMES)
  for (const theme of THEMES) {
    test(`${name} ${theme}: every text colour reads on the grounds it sits on, and the grounds keep their band`, () => {
      const p = PALETTES[name][theme];
      const f = FIXED_TOKENS[theme];
      const grounds = [p.bg, p.surface, p['accent-tint'], p['info-bg']];
      const heat = [f.h1, f.h2, f.h3, f.h4, f.h5];
      const atLeast = (what: string, fg: string, bgs: string[], min: number) => {
        for (const bg of bgs) assert.ok(ratio(fg, bg) >= min, `${what}: ${fg} on ${bg} is ${ratio(fg, bg)}:1, needs ${min}:1`);
      };
      atLeast('fg', p.fg, grounds, 7);
      atLeast('fg on heat', p.fg, heat, 4.5);
      atLeast('fg2', p.fg2, grounds, 4.5);
      atLeast('muted', p.muted, [p.bg, p.surface], 4.5);
      atLeast('accent', p.accent, [p.bg, p.surface, p['accent-tint']], 4.5);
      atLeast('accent-ink', p['accent-ink'], [p.bg, p.surface, p['accent-tint']], 4.5);
      atLeast('good', f.good, [p.bg, p.surface], 4.5);
      atLeast('warn', f.warn, [p.bg, p.surface], 4.5);
      atLeast('bad', f.bad, [p.bg, p.surface], 4.5);
      atLeast('bg on accent (step numbers)', p.bg, [p.accent], 4.5);
      if (theme === 'light') {
        assert.ok(lum(p.bg) >= 0.85, `bg luminance ${lum(p.bg)}`);
        assert.ok(lum(p.surface) >= 0.85, `surface luminance ${lum(p.surface)}`);
      } else {
        assert.ok(lum(p.bg) <= 0.02, `bg luminance ${lum(p.bg)}`);
        assert.ok(lum(p.surface) <= 0.03, `surface luminance ${lum(p.surface)}`);
      }
    });
  }

test('the brand-token validator, which holds the same rules, leaves every palette as it is', () => {
  for (const name of PALETTE_NAMES) {
    const { theme, diagnostics } = parseTheme(JSON.stringify({ light: PALETTES[name].light, dark: PALETTES[name].dark }));
    assert.deepEqual(diagnostics, [], name);
    assert.deepEqual(theme.light, PALETTES[name].light, name);
    assert.deepEqual(theme.dark, PALETTES[name].dark, name);
  }
});
