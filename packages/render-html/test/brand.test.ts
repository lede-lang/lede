// Brand tokens in the renderer (D80, F10): the stylesheet is written from core's palette table, a validated theme replaces the house
// palette in every block that carries one, and a page without a theme is the house page, byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIXED_TOKENS, PALETTES, PALETTE_TOKENS, parse, parseTheme, type ThemeTokens } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';
import { css } from '../src/theme.ts';
import { drive } from '../../../bench/src/incremental-model.ts';

/** The two token blocks as the stylesheet wrote them before the table moved to core: the pin that moving it changed no byte. */
const OLD_LIGHT = `
  --bg:#fbfbfa; --surface:#ffffff; --fg:#16181d; --fg2:#4d515c; --muted:#6b707c; --line:#dcdde1; --line2:#c4c6cc;
  --accent:#2357c6; --accent-tint:#e9effb; --accent-line:#bccbec; --accent-ink:#1d4aa8; --good:#1c7a4a; --good-bg:#e6f4ec; --bad:#b4372f; --bad-bg:#fbeceb; --bad-line:#e9a9a3; --warn:#8a5a00; --warn-bg:#fff6e0; --warn-line:#e8c26b; --info-bg:#f1f2f4;
  --c1:#2a78d6; --c2:#eb6834; --c3:#1baf7a; --c4:#eda100; --c5:#e87ba4; --c6:#008300; --c7:#6250d6; --c8:#e34948; --cm:#b4b7bf;
  --h1:#cde2fb; --h2:#9ec5f4; --h3:#6da7ec; --h4:#5598e7; --h5:#3987e5;
  color-scheme:light;`;
const OLD_DARK = `
  --bg:#131416; --surface:#1b1c1f; --fg:#eceef1; --fg2:#b9bcc4; --muted:#9a9ea8; --line:#2e3035; --line2:#41444b;
  --accent:#7aa7ff; --accent-tint:#1b2944; --accent-line:#2f4670; --accent-ink:#9dbdff; --good:#5cc48d; --good-bg:#15291e; --bad:#f07a70; --bad-bg:#2e1715; --bad-line:#6e2f2a; --warn:#f0c062; --warn-bg:#2a2210; --warn-line:#6b5420; --info-bg:#24262b;
  --c1:#3987e5; --c2:#d95926; --c3:#199e70; --c4:#c98500; --c5:#d55181; --c6:#008300; --c7:#9085e9; --c8:#e66767; --cm:#4b4e56;
  --h1:#0d366b; --h2:#104281; --h3:#184f95; --h4:#1c5cab; --h5:#256abf;
  color-scheme:dark;`;

test('the house stylesheet is written from the palette table and is the same bytes as before', () => {
  assert.ok(css({ theme: 'light' }).includes(`:root{${OLD_LIGHT}}`));
  assert.ok(css({ theme: 'dark' }).includes(`:root{${OLD_DARK}}`));
  const both = css({});
  assert.ok(
    both.startsWith(
      `:root{${OLD_LIGHT}}\n@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${OLD_DARK}}}\n:root[data-theme="dark"]{${OLD_DARK}}`,
    ),
  );
  assert.ok(both.includes(`:root:root{${OLD_LIGHT}}`), 'print takes the light tokens');
  // Every value of the table is in the sheet after its own name, and the source of theme.ts holds none of them.
  for (const theme of ['light', 'dark'] as const) {
    const block = theme === 'light' ? OLD_LIGHT : OLD_DARK;
    for (const [k, v] of [...Object.entries(PALETTES.paper[theme]), ...Object.entries(FIXED_TOKENS[theme])])
      assert.ok(block.includes(`--${k}:${v};`), `${theme} --${k}`);
  }
  const source = readFileSync(new URL('../src/theme.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /--bg:#|--accent-tint:#|--h1:#/);
  for (const v of [
    PALETTES.paper.light.bg,
    PALETTES.paper.dark.surface,
    FIXED_TOKENS.light.c4,
    FIXED_TOKENS.dark.h5,
    PALETTES.paper.light['accent-ink'],
  ])
    assert.ok(!source.includes(v), `theme.ts holds no second copy of ${v}`);
});

const TOKENS = JSON.stringify({
  accent: '#e0451f',
  light: { bg: '#fff8f0', muted: '#a0968a' },
  dark: { bg: '#1a1210', 'accent-tint': '#2a1a14' },
  series: ['#e0451f', '#0b6e99', '#f2c14e'],
});
const theme: ThemeTokens = parseTheme(TOKENS).theme;
const PAGE = '@title Brand\n@accent #2357c6\n# Brand\n\nA [link](https://example.com).\n';

/** The declarations `--NAME:VALUE` of the text, by name, last one wins. */
const decls = (block: string): Record<string, string> =>
  Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));

test('a theme replaces the palette and the chart colours in every block, and the page accent is not used', async () => {
  const html = await render(parse(PAGE, { themed: true }), { theme });
  const blocks = [...html.matchAll(/:root[^{]*\{([^}]*)\}/g)].map((m) => decls(m[1])).filter((b) => b.bg !== undefined);
  assert.equal(blocks.length, 4, 'light, dark by preference, dark by attribute, print');
  const [lt, dk, dk2, pr] = blocks;
  for (const k of PALETTE_TOKENS) {
    assert.equal(lt[k], theme.light[k], `light --${k}`);
    assert.equal(dk[k], theme.dark[k], `dark --${k}`);
    assert.equal(dk2[k], theme.dark[k], `dark by attribute --${k}`);
    assert.equal(pr[k], theme.light[k], `print --${k}`);
  }
  assert.deepEqual([lt.c1, lt.c2, lt.c3, lt.c4], [...theme.series!.light, FIXED_TOKENS.light.c4]);
  assert.deepEqual([dk.c1, dk.c2, dk.c3, dk.c4], [...theme.series!.dark, FIXED_TOKENS.dark.c4]);
  assert.equal(lt.good, FIXED_TOKENS.light.good, 'status colours stay the house ones');
  assert.equal(lt.h5, FIXED_TOKENS.light.h5);
  assert.ok(!html.includes('#2357c6'), 'the page accent, and the house accent it would have replaced, are not in the page');
  // The house page for the same document, without the theme, keeps the writer's accent.
  const house = await render(parse(PAGE));
  assert.match(house, /--accent:#2357c6;--accent-ink:#2357c6;/);
});

test('--artifact keeps the <style> of the full page, theme and all', async () => {
  const style = (h: string) => /<style>[\s\S]*?<\/style>/.exec(h)![0];
  const doc = () => parse(PAGE, { themed: true });
  const full = await render(doc(), { theme });
  const artifact = await render(doc(), { theme, artifact: true });
  assert.equal(style(artifact), style(full));
  assert.ok(style(full).includes(`--bg:${theme.light.bg};`));
  assert.ok(!artifact.includes('<meta'), 'still the artifact shape');
  // And a fragment has no style at all, as before.
  assert.ok(!(await render(doc(), { theme, fragment: true })).includes('<style>'));
});

test('compile warns that the theme overrides @accent, and a page without a theme is untouched by it', async () => {
  const themed = await compile(PAGE, { theme });
  assert.deepEqual(
    themed.doc.diagnostics.map((d) => [d.code, d.line]),
    [['theme-override', 2]],
  );
  const plain = await compile(PAGE);
  assert.deepEqual(plain.doc.diagnostics, []);
  assert.equal(plain.html, await render(parse(PAGE)), 'compile without a theme is parse and render');
});

test('the main is the same with and without a theme: only the stylesheet moves', async () => {
  const src = ['@title Same', '# Same', '', 'kpi A | 1 | +1', '', 'data t = a,b; x,1; y,2', 'chart bar t x=a y=b', '', 'table t', ''].join(
    '\n',
  );
  const [a, b] = await Promise.all([render(parse(src), { fragment: true }), render(parse(src), { fragment: true, theme })]);
  assert.equal(a, b);
});

test('a theme that holds anything but #rrggbb is refused where it is written, and nothing is written', () => {
  const hostile = [
    'red',
    '#fff;}body{background:url(//xss.example/a.png)}',
    '#fff}</style><script>alert(1)</script>',
    '#FFFFFF',
    '#fff',
    'var(--bg)',
    '',
  ];
  for (const v of hostile) {
    for (const key of ['bg', 'accent-ink', 'muted']) {
      const bad = { ...theme, light: { ...theme.light, [key]: v } };
      assert.throws(() => css({ tokens: bad }), TypeError, `${key} ${v}`);
    }
    const series = { ...theme, series: { light: [v], dark: ['#000000'] } };
    assert.throws(() => css({ tokens: series }), TypeError, `series ${v}`);
  }
  // A missing token is as bad.
  const { bg: _bg, ...rest } = theme.light;
  assert.throws(() => css({ tokens: { ...theme, light: rest as ThemeTokens['light'] } }), TypeError);
  assert.doesNotThrow(() => css({ tokens: theme }));
});

test('the incremental renderer draws the themed stylesheet the whole-page render draws', async () => {
  const src = '@title Brand\n@accent #2357c6\n# Brand\n\nask a | Who?\n\nexport json\n';
  const whole = /<style>([\s\S]*?)<\/style>/.exec(await render(parse(src, { themed: true }), { theme }))![1];
  for (const chunk of [1, 7, 64]) {
    const d = await drive(src, { chunk, parse: { themed: true }, theme });
    assert.equal(d.model.css, whole, `chunks of ${chunk}`);
  }
  assert.ok(whole.includes(`--bg:${theme.light.bg};`));
});

test('a theme, the dashboard rules and the decision card rules arrive in one stylesheet, whole or streamed', async () => {
  const src =
    '@title Brand\n@width wide\n# Brand\n\ndecision q "Which queue?" status=settled\nq: option a "A" | cheap | chosen\nq: option b "B" | dear | rejected\n';
  const whole = /<style>([\s\S]*?)<\/style>/.exec(await render(parse(src, { themed: true }), { theme }))![1];
  assert.ok(whole.includes('.doc.dash .lgrid'), 'the dashboard rules');
  assert.ok(whole.includes('.decision{'), 'the decision card rules');
  assert.ok(whole.includes(`--bg:${theme.light.bg};`), 'the brand palette');
  assert.ok(whole.includes('--col:64rem'), 'the wide column');
  for (const chunk of [1, 9, 64]) {
    const d = await drive(src, { chunk, parse: { themed: true }, theme });
    assert.equal(d.model.css, whole, `chunks of ${chunk}`);
  }
  assert.equal(css({ dash: true, decisions: true, tokens: theme }), whole);
});
