// Regression found by the 390-page sweep (old vs new renderer): a table whose cells are dates got date chips,
// and the fit estimate undercounted their width, so the table overflowed its block by 13px at 400px.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { checkFixtures } from '../../../bench/src/layout-check.ts';
import { browserTest } from './chrome.ts';

browserTest('a table with a date column does not overflow at 400px', async (browser) => {
  const src = readFileSync(new URL('../../../examples/v04/date-table.lede', import.meta.url), 'utf8');
  const found = await checkFixtures(['date-table'], browser, () => src);
  assert.deepEqual(found, []);
});

// D38: three cards of prose stay in the 46rem text column, so a card is about 190px wide and an unbreakable
// link must wrap instead of running past its card.
browserTest('three prose cards in the text column do not overflow on a long link', async (browser) => {
  const src = readFileSync(new URL('../../../examples/v04/cards-prose.lede', import.meta.url), 'utf8');
  const found = await checkFixtures(['cards-prose'], browser, () => src);
  assert.deepEqual(found, []);
});

// The skill ships the frozen model reference verbatim; if one changes, the other must too.
test('skill/lede/SKILL.md carries the current (0.5) model reference verbatim', () => {
  const ref = readFileSync(new URL('../../../bench/prompts/C-lede-0.5.md', import.meta.url), 'utf8')
    .split('\n')
    .slice(3, 103)
    .join('\n');
  assert.ok(readFileSync(new URL('../../../skill/lede/SKILL.md', import.meta.url), 'utf8').includes(ref));
});
