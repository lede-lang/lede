// Two renderer defects a writer run found on real pages: a code span that wraps between the two dashes of a flag, and a
// blocked edge whose cross sits on a bend of the route, next to another edge's arrowhead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@lede-lang/core';
import { render } from '../src/index.ts';
import { crossPoint } from '../src/diagram.ts';

const html = (src: string) => render(parse(src), { fragment: true });
const spans = (out: string) => [...out.matchAll(/<code class="brk">(.*?)<\/code>/g)].map((m) => m[1]);

test('a long code span breaks after / . _ and inside a hyphenated word, never after a hyphen that opens a flag', async () => {
  const cmd = 'git fetch --depth 1 origin tag vX.Y.Z';
  const long = 'pnpm install --frozen-lockfile --ignore-scripts && pnpm exec tsc -n --noEmit';
  const found = spans(await html(`Run \`${cmd}\`, then \`${long}\`.\n`));
  assert.equal(found.length, 2, 'both are longer than 32 characters, so both may break');
  for (const [i, text] of [cmd, long].entries()) {
    assert.equal(found[i].replaceAll('<wbr>', ''), text.replaceAll('&', '&amp;'), 'the text is unchanged');
    assert.doesNotMatch(found[i], /-<wbr>-/, 'no break between the two dashes');
    assert.doesNotMatch(found[i], /(^|\s|-)-<wbr>/, 'no break right after a hyphen that opens a flag');
  }
  assert.match(found[0], /vX\.<wbr>Y\.<wbr>Z/, 'dots still break');
  assert.match(found[1], /frozen-<wbr>lockfile/, 'a hyphen inside a word still breaks');
});

test('crossPoint is the middle of the longest straight stretch, and the midpoint of a straight edge', () => {
  assert.deepEqual(
    crossPoint([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]),
    { x: 50, y: 0 },
  );
  // A short stub, a long run, a drop and a stub, the way a routed edge goes round a group.
  const route = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 38 },
    { x: 370, y: 38 },
    { x: 370, y: 350 },
    { x: 410, y: 350 },
  ];
  assert.deepEqual(crossPoint(route), { x: 205, y: 38 });
  assert.deepEqual(
    crossPoint([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]),
    { x: 25, y: 0 },
    'equal stretches: the first one',
  );
});

// The aspects page from the dogfood run: the blocked edge goes round the first group before it drops to the second.
const ASPECTS = `diagram reach dir=LR title="What reaches the 31 Lambdas"
reach: props "Props and feature flag" "logGroup, useCdkManagedLogGroup"
reach: aspects "Two Aspects at stack scope" "one creates missing groups, one sets retention" focus
reach: auto "Auto-delete handler" fn "built by CDK, never declared" focus
reach: api "29 API handlers" fn "declared in your code"
reach: cog "Cognito trigger" fn "declared in your code"
reach: group generated "CDK added it for you" auto
reach: group declared "You wrote a constructor call" api, cog
reach: props -> declared : 30 of 31
reach: props -x- generated : no props object
reach: aspects -> declared : sets retention
reach: aspects -> generated : creates group
`;

test('the cross of a blocked edge is not drawn on a bend of its route', async () => {
  const out = await html(ASPECTS);
  const desktop = /<div class="dg-h">([\s\S]*?)<\/div><div class="dg-v"/.exec(out)?.[1] ?? out;
  const cross = /<g class="blk"><circle cx="([\d.]+)" cy="([\d.]+)"/.exec(desktop);
  assert.ok(cross, 'a cross is drawn');
  const [cx, cy] = [Number(cross[1]), Number(cross[2])];
  const path = /<path class="edge[^"]*\bblocked\b[^"]*" d="([^"]+)"/.exec(desktop)?.[1] ?? '';
  // roundedPath writes each bend of the route as the control point of a Q.
  const bends = [...path.matchAll(/Q([\d.]+),([\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  assert.ok(bends.length >= 2, 'the route has bends');
  for (const b of bends) assert.ok(Math.hypot(b.x - cx, b.y - cy) > 20, `the cross at ${cx},${cy} is on the bend at ${b.x},${b.y}`);
});
