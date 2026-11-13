// The collision predicate for pipe rows (D80, bench/src/collide.ts): what it counts and what it leaves alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collisions } from '../src/collide.ts';

const lines = (src: string) => collisions('x.lede', src).map((h) => `${h.rule}@${h.line}`);

test('a data row, a colon line and a pipe header are counted, each once', () => {
  assert.deepEqual(lines('data costs = a,b\ncosts: x | y\n'), ['row@2']);
  assert.deepEqual(lines(': stray\n'), ['colon@1']);
  assert.deepEqual(lines('table = A | B\ntable title="T" heat = A | B\n'), ['head@1', 'head@2']);
});

test('lines the new rules read as they were read before are not counted', () => {
  // Not a data name, declared only after the line, no separator, or a pipe with no space round it.
  assert.deepEqual(lines('note: see | below\ncosts: a | b\ndata costs = x,y\ncosts: one\ncosts: a|b\n'), []);
  // A quoted pipe in an old-form header, a `:` inside a word, and an old-form table are untouched.
  assert.deepEqual(lines('table = "a | b",c; 1,2\ntable = a,b; 1,2\n:smile:\n'), []);
  // Lines inside a fence are not Lede lines.
  assert.deepEqual(lines('data costs = x,y\n```\ncosts: a | b\n: row\ntable = A | B\n```\n'), []);
});
