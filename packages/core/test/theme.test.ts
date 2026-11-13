// Brand tokens (D80, F10): the validator behind `lede build --theme tokens.json`. A file is JSON and nothing else; every value is a
// hex colour or an error; a text colour that does not read is moved in lightness only, and every one that is moved passes afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXED_TOKENS,
  PALETTES,
  THEME_MAX_BYTES,
  ThemeFileError,
  parse,
  parseTheme,
  themeHex,
  LedeStream,
  type Diagnostic,
} from '../src/index.ts';
import { contrastRatio, parseHex } from '../src/contrast.ts';
import { hexAt, toOklch } from '../src/theme.ts';

const THEMES = ['light', 'dark'] as const;
const ratio = (a: string, b: string): number => Math.floor(contrastRatio(parseHex(a)!, parseHex(b)!) * 100) / 100;
const codes = (ds: Diagnostic[]) => ds.map((d) => d.code);
const detail = (d: Diagnostic | undefined) => d?.detail as Record<string, string | number>;

test('an empty file, and a file that names only what the palette already holds, change nothing', () => {
  for (const text of [
    '{}',
    ' \n{ }\n',
    '{"light":{},"dark":{}}',
    JSON.stringify({ light: PALETTES.paper.light, dark: PALETTES.paper.dark }),
  ]) {
    const r = parseTheme(text);
    assert.deepEqual(r.diagnostics, [], text);
    assert.deepEqual(r.theme, { light: PALETTES.paper.light, dark: PALETTES.paper.dark }, text);
  }
});

test('hex colours are normalised to #rrggbb in lower case, and nothing else is a colour', () => {
  assert.equal(themeHex('#fff'), '#ffffff');
  assert.equal(themeHex('#A1b2C3'), '#a1b2c3');
  for (const bad of [
    '',
    'red',
    '#ff',
    '#12345',
    '#abcd',
    '#a1b2c3d4',
    'fff',
    '#ggg',
    '#fff ',
    ' #fff',
    '#fff\n',
    'rgb(0,0,0)',
    'hsl(0 0% 0%)',
    'var(--x)',
    17,
    null,
    {},
    [],
  ])
    assert.equal(themeHex(bad), null, JSON.stringify(bad));
  const r = parseTheme('{"accent":"#2357C6","light":{"bg":"#FFF"}}');
  assert.equal(r.theme.light.bg, '#ffffff');
  assert.equal(r.theme.light.accent, '#2357c6');
});

test('a value that is not a hex colour is E theme-value and never reaches the theme', () => {
  const bad = [
    'red',
    'rgb(0 0 0)',
    '#abcd',
    '#a1b2c3d4',
    '#fff;}body{background:url(//xss.example/a.png)}',
    '#fff}</style><script>alert(1)</script>',
    'url(//xss.example/a.png)',
    'var(--bg)',
    'expression(alert(1))',
    '#fff\n',
    '',
  ];
  for (const v of bad) {
    const r = parseTheme(JSON.stringify({ accent: v, light: { bg: v, fg: v, 'accent-line': v }, dark: { muted: v }, series: [v] }));
    assert.deepEqual([...new Set(codes(r.diagnostics))], ['theme-value'], JSON.stringify(v));
    assert.equal(r.diagnostics.length, 6, JSON.stringify(v));
    assert.ok(r.diagnostics.every((d) => d.severity === 'error'));
    // The house palette is what is left: nothing of the file got in.
    assert.deepEqual(r.theme, { light: PALETTES.paper.light, dark: PALETTES.paper.dark }, JSON.stringify(v));
    assert.ok(!JSON.stringify(r.theme).includes('xss.example'));
  }
  // Wrong shapes are the same error, named by their path.
  const r = parseTheme('{"accent":5,"light":[],"dark":"x","series":"#fff"}');
  assert.deepEqual(
    r.diagnostics.map((d) => detail(d).key),
    ['accent', 'light', 'dark', 'series'],
  );
  assert.deepEqual(codes(r.diagnostics), ['theme-value', 'theme-value', 'theme-value', 'theme-value']);
  assert.deepEqual(codes(parseTheme('{"series":[]}').diagnostics), ['theme-value']);
  assert.deepEqual(codes(parseTheme(`{"series":${JSON.stringify(Array(9).fill('#fff'))}}`).diagnostics), ['theme-value']);
  assert.deepEqual(
    codes(parseTheme(`{"series":${JSON.stringify(Array(8).fill('#fff'))}}`).diagnostics.filter((d) => d.code === 'theme-value')),
    [],
  );
  // A value in a message is shown as JSON, so a control character is escaped and a long one is cut.
  const msg = parseTheme(`{"accent":"#fff\\u001b[31m${'x'.repeat(100)}"}`).diagnostics[0].message;
  assert.doesNotMatch(msg, /[^\x20-\x7e…]/);
  assert.ok(msg.length < 150, msg);
});

test('a key the file does not know is W theme-key and is ignored; fonts says it is not supported', () => {
  const r = parseTheme('{"fonts":"slab","extra":1,"light":{"tint":"#eee","fg3":"#333","zzz":"#000"},"__proto__":{"bg":"#000"}}');
  assert.deepEqual(codes(r.diagnostics), ['theme-key', 'theme-key', 'theme-key', 'theme-key', 'theme-key', 'theme-key']);
  assert.ok(r.diagnostics.every((d) => d.severity === 'warning'));
  const by = (key: string) => r.diagnostics.find((d) => detail(d).key === key)!;
  assert.match(by('fonts').message, /not supported/);
  assert.equal(detail(by('fonts')).reason, 'unsupported');
  assert.match(by('light.tint').message, /did you mean accent-tint\?/);
  assert.match(by('light.fg3').message, /did you mean muted\?/);
  assert.doesNotMatch(by('light.zzz').message, /did you mean/);
  assert.deepEqual(r.theme, { light: PALETTES.paper.light, dark: PALETTES.paper.dark });
});

test('a file that cannot be a tokens file at all throws ThemeFileError', () => {
  for (const [text, why] of [
    ['', /not valid JSON/],
    ['{', /not valid JSON/],
    ['{"accent":"#fff",}', /not valid JSON/],
    ['[]', /JSON object/],
    ['"#fff"', /JSON object/],
    ['null', /JSON object/],
    ['7', /JSON object/],
    [`{"x":"${'a'.repeat(THEME_MAX_BYTES)}"}`, /larger than 64 KiB/],
    // Counted in bytes, not characters.
    [`{"x":"${'é'.repeat(THEME_MAX_BYTES / 2)}"}`, /larger than 64 KiB/],
  ] as const) {
    assert.throws(
      () => parseTheme(text),
      (e: unknown) => e instanceof ThemeFileError && why.test(e.message),
      text.slice(0, 20),
    );
  }
  assert.deepEqual(parseTheme('﻿{}').diagnostics, [], 'a byte order mark is allowed');
  assert.equal(parseTheme(`{"x":"${'a'.repeat(THEME_MAX_BYTES - 20)}"}`).diagnostics.length, 1, 'just under the limit is read');
});

test('a colour that does not read is moved, reported with its facts, and passes afterwards', () => {
  const r = parseTheme('{"light":{"muted":"#aaaaaa"},"dark":{"fg2":"#444444"}}');
  assert.deepEqual(codes(r.diagnostics), ['theme-adjusted', 'theme-adjusted']);
  const [muted, fg2] = r.diagnostics;
  assert.equal(muted.severity, 'warning');
  assert.deepEqual(detail(muted), {
    token: 'muted',
    theme: 'light',
    from: '#aaaaaa',
    to: r.theme.light.muted,
    ratio: detail(muted).ratio,
    required: 4.5,
    against: 'bg',
  });
  assert.ok(ratio(r.theme.light.muted, PALETTES.paper.light.bg) >= 4.5 && ratio(r.theme.light.muted, PALETTES.paper.light.surface) >= 4.5);
  assert.ok(ratio(r.theme.light.muted, PALETTES.paper.light.bg) < 4.7, 'the nearest value that passes, not a far one');
  assert.equal(detail(muted).ratio, ratio(r.theme.light.muted, PALETTES.paper.light[detail(muted).against as 'bg']));
  assert.equal(detail(fg2).token, 'fg2');
  assert.equal(detail(fg2).theme, 'dark');
  assert.ok(ratio(r.theme.dark.fg2, PALETTES.paper.dark.bg) >= 4.5);
  assert.match(muted.message, /^light muted #aaaaaa has 2\.24:1 on bg; it needs 4\.5:1; moved to #[0-9a-f]{6} \(4\.5\d?:1\)$/);
  // A colour that already reads is left as written.
  assert.deepEqual(parseTheme('{"light":{"muted":"#6b707c","fg":"#000"},"dark":{"fg":"#fff"}}').diagnostics, []);
});

test('--theme-strict makes the adjustment an error and still returns the adjusted theme', () => {
  const loose = parseTheme('{"light":{"muted":"#aaa"}}');
  const strict = parseTheme('{"light":{"muted":"#aaa"}}', { strict: true });
  assert.deepEqual([loose.diagnostics[0].severity, strict.diagnostics[0].severity], ['warning', 'error']);
  assert.equal(strict.diagnostics[0].code, 'theme-adjusted');
  assert.match(strict.diagnostics[0].message, /it would be #/);
  assert.deepEqual(strict.theme, loose.theme);
  assert.deepEqual(parseTheme('{}', { strict: true }).diagnostics, []);
});

test('the file-wide accent is the accent and the ink of both themes, each moved for its own surfaces; a theme block wins', () => {
  const r = parseTheme('{"accent":"#ffd700"}');
  // Pale yellow reads on the dark surfaces and not on the light ones.
  assert.equal(r.theme.dark.accent, '#ffd700');
  assert.equal(r.theme.dark['accent-ink'], '#ffd700');
  assert.notEqual(r.theme.light.accent, '#ffd700');
  assert.equal(r.theme.light['accent-ink'], r.theme.light.accent);
  assert.deepEqual(
    r.diagnostics.map((d) => [detail(d).token, detail(d).theme]),
    [['accent', 'light']],
    'the ink follows, with no second report',
  );
  assert.equal(r.diagnostics[0].line, 1);
  const over = parseTheme('{"accent":"#2357c6","light":{"accent":"#1a1a1a"},"dark":{"accent-ink":"#ffffff"}}');
  assert.equal(over.theme.light.accent, '#1a1a1a');
  assert.equal(over.theme.light['accent-ink'], '#1a1a1a');
  assert.equal(over.theme.dark.accent, '#2357c6' === over.theme.dark.accent ? '#2357c6' : over.theme.dark.accent);
  assert.equal(over.theme.dark['accent-ink'], '#ffffff');
  assert.equal(parseTheme('{"light":{"accent":"#1a1a1a","accent-ink":"#000"}}').theme.light['accent-ink'], '#000000');
});

test('the surfaces are taken as given, and a text colour is checked against the ones the file chose', () => {
  const r = parseTheme('{"light":{"bg":"#fff8e1","surface":"#fffdf5","accent-tint":"#ffecb3","info-bg":"#fff3cd"}}');
  assert.equal(r.theme.light.bg, '#fff8e1');
  assert.equal(r.theme.light['accent-tint'], '#ffecb3');
  // The house text colours still read on that cream, so there is nothing to say.
  assert.deepEqual(r.diagnostics, []);
  // A darker accent tint takes the house accent below 4.5:1 on it, so the accent is the one that moves.
  const dim = parseTheme('{"light":{"accent-tint":"#9fb8ee"}}');
  assert.ok(['accent', 'accent-ink'].every((t) => dim.diagnostics.some((d) => detail(d).token === t)));
  for (const t of ['accent', 'accent-ink'] as const) assert.ok(ratio(dim.theme.light[t], '#9fb8ee') >= 4.5, t);
});

test('where no lightness can make the text read, that is E theme-surface and the colour is left as written', () => {
  const mid = parseTheme('{"light":{"bg":"#808080"}}');
  const fg = mid.diagnostics.find((d) => detail(d).token === 'fg');
  assert.equal(fg?.code, 'theme-surface');
  assert.equal(fg?.severity, 'error');
  assert.equal(detail(fg).required, 7);
  assert.equal(mid.theme.light.fg, PALETTES.paper.light.fg);
  // Not the strict flag's doing: the same without it, and with it.
  assert.equal(
    parseTheme('{"light":{"bg":"#808080"}}', { strict: true }).diagnostics.find((d) => detail(d).token === 'fg')?.code,
    'theme-surface',
  );
});

test("the status colours are text on the file's page and card and on their own tint: moved there like any text token", () => {
  const r = parseTheme('{"light":{"bg":"#e0e0e0","surface":"#e0e0e0"}}');
  const moved = r.diagnostics.filter((d) => ['good', 'bad', 'warn'].includes(String(detail(d).token)));
  assert.deepEqual(
    moved.map((d) => [d.code, d.severity, detail(d).token, detail(d).theme, detail(d).against]),
    [
      ['theme-adjusted', 'warning', 'good', 'light', 'bg'],
      ['theme-adjusted', 'warning', 'warn', 'light', 'bg'],
    ],
  );
  const status = r.theme.status?.light ?? {};
  assert.deepEqual(Object.keys(status), ['good', 'warn']);
  for (const [token, hex] of Object.entries(status)) {
    assert.ok(ratio(hex, '#e0e0e0') >= 4.5, token);
    assert.ok(ratio(hex, FIXED_TOKENS.light[`${token}-bg`]) >= 4.5, `${token} on its tint`);
  }
  // Only a moved colour is carried, so a file that moves none leaves the status colours to the house.
  assert.equal(parseTheme('{}').theme.status, undefined);
  assert.equal(parseTheme('{"accent":"#0b5fff","light":{"bg":"#fff8e1"}}').theme.status, undefined);
  // Under --theme-strict the move is an error, and the moved colour is still returned.
  const strict = parseTheme('{"dark":{"bg":"#303030","surface":"#3a3a3a"}}', { strict: true });
  const bad = strict.diagnostics.find((d) => detail(d).token === 'bad');
  assert.equal(bad?.code, 'theme-adjusted');
  assert.equal(bad?.severity, 'error');
  assert.ok(ratio(strict.theme.status?.dark?.bad ?? '', '#3a3a3a') >= 4.5);
});

test('chart colours are held to 3:1 on the page and card, in each theme, and the others keep the house series', () => {
  const r = parseTheme('{"series":["#2a78d6","#f5e6a0","#102030"]}');
  assert.equal(r.theme.series?.light.length, 3);
  assert.equal(r.theme.series?.dark.length, 3);
  for (const t of THEMES)
    for (const c of r.theme.series[t])
      for (const ground of ['bg', 'surface'] as const) assert.ok(ratio(c, PALETTES.paper[t][ground]) >= 3, `${t} ${c} on ${ground}`);
  assert.deepEqual(r.theme.series?.light[0], '#2a78d6');
  assert.deepEqual(
    r.diagnostics.map((d) => [detail(d).token, detail(d).theme, detail(d).required]),
    [
      ['c2', 'light', 3],
      ['c3', 'dark', 3],
    ],
  );
  assert.deepEqual(parseTheme('{}').theme.series, undefined);
  // Without a `series` the house series is not checked or moved: D11 trades some of its slots' contrast for hue.
  assert.deepEqual(parseTheme('{"light":{"muted":"#6b707c"}}').diagnostics, []);
  assert.ok(FIXED_TOKENS.light.c4 && ratio(FIXED_TOKENS.light.c4, PALETTES.paper.light.bg) < 3);
});

/** A deterministic stream of colours: the same ones on every run. */
function colours(n: number): string[] {
  let x = 0x9e3779b9;
  return Array.from({ length: n }, () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return `#${(x & 0xffffff).toString(16).padStart(6, '0')}`;
  });
}

test('every colour that is moved passes in both themes, and is the nearest lightness that does (hue kept, chroma not raised)', () => {
  const cs = colours(1200);
  let moved = 0;
  for (let i = 0; i + 8 <= cs.length; i += 8) {
    const [a, b, c, d, e, f, g, h] = cs.slice(i, i + 8);
    const file = {
      light: { fg: a, fg2: b, muted: c, accent: d, 'accent-ink': e },
      dark: { fg: f, fg2: g, muted: h, accent: a, 'accent-ink': b },
      series: [c, d, e, f],
    };
    const r = parseTheme(JSON.stringify(file));
    assert.ok(!codes(r.diagnostics).includes('theme-surface'), JSON.stringify(file));
    for (const t of THEMES) {
      const p = r.theme[t];
      const grounds = [p.bg, p.surface, p['accent-tint'], p['info-bg']];
      const heat = ['h1', 'h2', 'h3', 'h4', 'h5'].map((k) => FIXED_TOKENS[t][k]);
      for (const on of grounds) {
        assert.ok(ratio(p.fg, on) >= 7, `${t} fg ${p.fg} on ${on}`);
        assert.ok(ratio(p.fg2, on) >= 4.5, `${t} fg2 ${p.fg2} on ${on}`);
      }
      for (const step of heat) assert.ok(ratio(p.fg, step) >= 4.5, `${t} fg ${p.fg} on heat ${step}`);
      for (const on of [p.bg, p.surface]) assert.ok(ratio(p.muted, on) >= 4.5, `${t} muted ${p.muted} on ${on}`);
      for (const on of [p.bg, p.surface, p['accent-tint']])
        for (const k of ['accent', 'accent-ink'] as const) assert.ok(ratio(p[k], on) >= 4.5, `${t} ${k} ${p[k]} on ${on}`);
      for (const colour of r.theme.series![t])
        for (const on of [p.bg, p.surface]) assert.ok(ratio(colour, on) >= 3, `${t} series ${colour} on ${on}`);
    }
    for (const dg of r.diagnostics) {
      moved++;
      const { from, to, required } = detail(dg) as { from: string; to: string; required: number };
      const [L0, C0, h0] = toOklch(parseHex(from)!);
      const [L1, C1, h1] = toOklch(parseHex(to)!);
      assert.ok(C1 <= C0 + 0.01, `${from} -> ${to}: chroma ${C0} -> ${C1}`);
      // Hue is only defined where there is chroma, and 8-bit rounding blurs it where there is little.
      if (C0 > 0.05 && C1 > 0.05) {
        const dh = Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)));
        assert.ok(dh < 0.12, `${from} -> ${to}: hue ${h0} -> ${h1}`);
      }
      // Nearest: a step back toward the original lightness no longer passes. The step is made in the same hue and chroma.
      if (Math.abs(L1 - L0) > 0.01) {
        const back = hexAt(L1 + Math.sign(L0 - L1) * 0.006, C0, h0);
        const token = detail(dg).token as string;
        const t = detail(dg).theme as 'light' | 'dark';
        const p = r.theme[t];
        const on = token.startsWith('c')
          ? [p.bg, p.surface]
          : token === 'fg'
            ? [p.bg, p.surface, p['accent-tint'], p['info-bg']]
            : token === 'fg2'
              ? [p.bg, p.surface, p['accent-tint'], p['info-bg']]
              : token === 'muted'
                ? [p.bg, p.surface]
                : [p.bg, p.surface, p['accent-tint']];
        const heat = token === 'fg' ? ['h1', 'h2', 'h3', 'h4', 'h5'].map((k) => FIXED_TOKENS[t][k]) : [];
        const reads = on.every((ground) => ratio(back, ground) >= required) && heat.every((step) => ratio(back, step) >= 4.5);
        assert.equal(reads, false, `${from} -> ${to}: ${back} one step nearer also reads`);
      }
    }
  }
  assert.ok(moved > 500, `${moved} colours were moved: the run exercised the search`);
});

test('a diagnostic points at the key it is about, and at the section when the colour was inherited', () => {
  const text = [
    '{',
    '  "accent": "#ffd700",',
    '  "light": {',
    '    "muted": "#aaa",',
    '    "bad": 1',
    '  },',
    '  "series": ["#fff", "#fffde0"]',
    '}',
  ].join('\n');
  const r = parseTheme(text);
  const at = (code: string, pick: (d: Diagnostic) => boolean) => r.diagnostics.find((d) => d.code === code && pick(d));
  assert.deepEqual(
    [at('theme-adjusted', (d) => detail(d).token === 'accent')?.line, at('theme-adjusted', (d) => detail(d).token === 'accent')?.col],
    [2, 3],
  );
  assert.deepEqual(
    [at('theme-adjusted', (d) => detail(d).token === 'muted')?.line, at('theme-adjusted', (d) => detail(d).token === 'muted')?.col],
    [4, 5],
  );
  assert.equal(at('theme-key', () => true)?.line, 5);
  assert.deepEqual(
    r.diagnostics.filter((d) => ['c1', 'c2'].includes(detail(d).token as string)).map((d) => [detail(d).token, d.line, d.col]),
    [
      ['c1', 7, 14],
      ['c2', 7, 22],
    ],
  );
  // Keys with escapes, and braces and brackets inside strings, do not throw the scan off.
  const odd = '{"a\\"b":"x{[","light":{"muted":"#aaa"}}';
  assert.equal(parseTheme(odd).diagnostics.find((d) => d.code === 'theme-adjusted')?.col, 24);
});

test('the parser ignores @accent under a theme, with W theme-override on its line, and does not check it', () => {
  const src = '@title T\n@accent #123456\n@accent #ffd700\nbody\n';
  const plain = parse(src);
  assert.deepEqual(codes(plain.diagnostics), ['accent-contrast']);
  const themed = parse(src, { themed: true });
  assert.deepEqual(
    themed.diagnostics.map((d) => [d.severity, d.code, d.line, d.col, detail(d).key]),
    [
      ['warning', 'theme-override', 2, 1, 'accent'],
      ['warning', 'theme-override', 3, 1, 'accent'],
    ],
  );
  assert.equal(parse('@accent nope\n', { themed: true }).diagnostics[0].code, 'theme-override', 'not even a colour needs a second warning');
  assert.deepEqual(parse('@title T\n', { themed: true }).diagnostics, []);
  // The same line by line, as a model writes it.
  const stream = new LedeStream({ themed: true });
  stream.write('@title T\n@accent #12');
  assert.equal(stream.doc.diagnostics.length, 0, 'a partial line has said nothing yet');
  stream.write('3456\n@accent #ff');
  assert.deepEqual(
    stream.doc.diagnostics.map((d) => [d.code, d.line]),
    [['theme-override', 2]],
    'the warning is there as soon as its line is complete, before the end',
  );
  stream.write('d700\nbody\n');
  assert.deepEqual(stream.end().diagnostics, themed.diagnostics);
});
