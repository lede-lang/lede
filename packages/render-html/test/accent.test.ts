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
  assert.match(css({ accent: '#abcd' }), /--accent:#abcd;/);
  for (const bad of ['#12345', '#1234567', 'red', '#fff;}body{background:red}', '#fff}</style><script>'])
    assert.doesNotMatch(css({ accent: bad }), /--accent:[^;]*;--accent-ink/, bad);
});
