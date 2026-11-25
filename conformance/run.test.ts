// Conformance: every cases/*.lede parses to cases/*.json exactly; every errors/*.lede
// yields exactly the diagnostics in errors/*.json (severity, code, line, col).
// Regenerate expectations after an intentional change with UPDATE=1 and review the diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@lede-lang/core';
import { contractDiag, expectedPath, here, listCases, type Kind } from './shared.ts';

const update = process.env.UPDATE === '1';

for (const dir of ['cases', 'errors'] as Kind[]) {
  for (const f of listCases(dir)) {
    test(`${dir}/${f}`, () => {
      const doc = parse(readFileSync(join(here, dir, f), 'utf8'), { loadFile: () => 'a,b\n1,2' });
      const got = dir === 'cases' ? doc : doc.diagnostics.map(contractDiag);
      const file = expectedPath(dir, f);
      if (update || !existsSync(file)) writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
      assert.deepEqual(got, JSON.parse(readFileSync(file, 'utf8')));
      if (dir === 'cases')
        assert.equal(doc.diagnostics.filter((d) => d.severity === 'error').length, 0, 'conformance cases must be error-free');
    });
  }
}
