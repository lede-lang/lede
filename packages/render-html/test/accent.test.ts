// D49: the contrast check in core reads the theme's surfaces from its own copy; keep it equal to theme.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_SURFACES } from '@lede-lang/core';
import { css } from '../src/index.ts';

const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):(#[0-9a-f]+)/gi)].map((m) => [m[1], m[2]]));

test("core's theme surfaces match the renderer's light and dark tokens", () => {
  for (const theme of ['light', 'dark'] as const) {
    const root = /:root\{([^}]*)\}/.exec(css({ theme }))![1];
    const t = tokens(root);
    for (const [name, hex] of Object.entries(THEME_SURFACES[theme])) assert.equal(t[name], hex, `${theme} --${name}`);
  }
});

test('only CSS hex forms reach the stylesheet as the accent', () => {
  assert.match(css({ accent: '#b4372f' }), /--accent:#b4372f;--accent-ink:#b4372f;/);
  assert.match(css({ accent: '#a00f' }), /--accent:#a00f;/);
  for (const bad of ['#12345', '#1234567', 'red', '#fff;}body{background:red}', '#fff}</style><script>'])
    assert.doesNotMatch(css({ accent: bad }), /--accent:[^;]*;--accent-ink/, bad);
});

test('an accent that fails AA text contrast on the theme it lands on is not painted (D77)', () => {
  const painted = (o: Parameters<typeof css>[0]) => /--accent:[^;]*;--accent-ink/.test(css(o));
  assert.equal(painted({ accent: '#ffd700' }), false, 'pale yellow on the light theme');
  assert.equal(painted({ accent: '#abcd' }), false, 'a translucent accent is composited first');
  assert.equal(painted({ accent: '#b4372f' }), true);
  assert.equal(painted({ accent: '#003366', theme: 'dark' }), false, 'dark navy on the dark theme');
  assert.equal(painted({ accent: '#ffd700', theme: 'dark' }), true, 'pale yellow reads on the dark theme');
  assert.equal(painted({ accent: '#ffd700', theme: 'light' }), false);
  assert.match(css({ accent: '#ffd700' }), /--accent:#2357c6;/, 'the house accent stays');
});
