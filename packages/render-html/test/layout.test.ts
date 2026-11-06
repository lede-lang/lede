// Browser-measured acceptance checks (Req 2.1, 2.4, 2.5, 2.6, 3.1, 3.2, 4.1, 5.2, 5.4, 8.3), run over
// every examples/parity fixture at 1280px light and 400px dark by bench/src/layout-check.ts.
// Skipped, with a message, when no Chromium resolves (set CHROME to one); fails instead when CI or LEDE_REQUIRE_CHROME is set (chrome.ts).
import assert from 'node:assert/strict';
import { checkFixtures, type Finding } from '../../../bench/src/layout-check.ts';
import { browserTest, type Browser } from './chrome.ts';

let all: Promise<Finding[]> | undefined;
const findings = (browser: Browser) => (all ??= checkFixtures(undefined, browser));

const reqs: [string, string][] = [
  ['2.1', 'no block is cut off, spills past its column or scrolls sideways, in grids, tables and diagrams'],
  ['2.4', 'kpi values stay on one line at both widths'],
  ['2.5', 'inline code of 32 characters or fewer never wraps inside the token'],
  ['2.6', 'no fixture scrolls horizontally at 1280px or 400px'],
  ['3.1', 'chart tick labels never overlap, as measured in the browser'],
  ['3.2', 'chart text is at least 12px on desktop and 11px on phones after scaling'],
  ['4.1', 'flow diagram text is at least 11px at 400px and is not clipped by its figure'],
  ['5.2', 'sequence diagrams fit 400px: text at least 11px, nothing clipped'],
  ['5.4', 'desktop sequence diagrams use at least 13px for participants and 12px for messages'],
  ['8.3', 'zero contrast violations, both themes, both widths'],
];
for (const [req, what] of reqs) {
  browserTest(
    `Req ${req} (browser) ${what}`,
    async (browser) => {
      const mine = (await findings(browser)).filter((f) => f.req === req);
      assert.deepEqual(
        mine.map((f) => `${f.fixture} @${f.width} ${f.scheme}: ${f.msg}`),
        [],
      );
    },
    300_000,
  );
}
