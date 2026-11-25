// The exfiltration demo (demos/exfil) in a real browser: its results must match demos/exfil/expected.json. Skips without Chromium, and
// fails instead when CI or LEDE_REQUIRE_CHROME is set, as the other browser checks do (chrome.ts in packages/render-html/test).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveChrome } from '../../../bench/src/shot.ts';
import { CASES, expected, runDemo, table } from '../../../demos/exfil/run.ts';

const required = Boolean(process.env.CI || process.env.LEDE_REQUIRE_CHROME);
const exe = resolveChrome();

if (!exe && !required) test('exfiltration demo matches its expected table', { skip: 'no Chromium found: set CHROME' }, () => {});
else
  test('exfiltration demo matches its expected table', { timeout: 180_000 }, async () => {
    assert.ok(exe, 'no Chromium found, and CI or LEDE_REQUIRE_CHROME is set: set CHROME');
    const rs = await runDemo(exe);
    const want = expected();
    assert.deepEqual(Object.keys(want).toSorted(), CASES.map((c) => c.id).toSorted());
    assert.deepEqual(Object.fromEntries(rs.map((r) => [r.id, r.leaked])), want, table(rs, want));
  });
