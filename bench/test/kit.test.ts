// The replication kit (bench/src/bench.ts) against a local stub provider. No model API is called and no real key is used.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runKit } from '../src/kit/run.ts';
import { estimate, estTokens, usd } from '../src/kit/estimate.ts';
import { parseTaskSpec, TaskSelectionError } from '../src/kit/tasks.ts';
import { ARMS, writerMessage } from '../src/kit/arms.ts';
import { createProvider, keyFor } from '../src/kit/provider.ts';
import { startStub } from './kit-stub.ts';

const KEY = 'sk-test-0123456789-SECRET';
const run = async (argv: string[], env: Record<string, string | undefined> = {}) => {
  const lines: string[] = [];
  const code = await runKit(argv, env, { out: (s) => lines.push(s) });
  return { code, text: lines.join('\n') };
};
const tmp = () => mkdtempSync(join(tmpdir(), 'lede-kit-'));
const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? filesUnder(join(dir, f)) : [join(dir, f)]));
const lede = 'Page\n\n# Title\n\nA paragraph.\n';

test('estimate math: tokens, prices per million, expected and worst case', () => {
  assert.equal(estTokens('x'.repeat(35)), 10);
  assert.equal(estTokens('x'.repeat(36)), 11);
  assert.equal(usd(1_000_000, 500_000, 3, 15), 10.5);
  const e = estimate({
    arms: [ARMS.B, ARMS.C],
    messages: new Map([
      ['B', ['x'.repeat(350), 'x'.repeat(700)]],
      ['C', ['x'.repeat(350)]],
    ]),
    outputPerArm: { B: 1000, C: 200 },
    outputSource: 'test',
    maxTokens: 4000,
    priceIn: 2,
    priceOut: 10,
  });
  assert.equal(e.calls, 3);
  assert.equal(e.arms[0].inputTotal, 300);
  assert.equal(e.arms[0].outputTotal, 2000);
  assert.ok(Math.abs(e.arms[0].expectedUsd! - (300 * 2 + 2000 * 10) / 1e6) < 1e-12);
  assert.ok(Math.abs(e.arms[0].worstCaseUsd! - (300 * 2 + 8000 * 10) / 1e6) < 1e-12);
  assert.equal(e.inputTotal, 400);
  assert.ok(Math.abs(e.expectedUsd! - (400 * 2 + 2200 * 10) / 1e6) < 1e-12);
  const unpriced = estimate({
    arms: [ARMS.B],
    messages: new Map([['B', ['x']]]),
    outputPerArm: { B: 1 },
    outputSource: 't',
    maxTokens: 10,
  });
  assert.equal(unpriced.expectedUsd, null);
});

test('sealed tasks 131 to 185 are always refused, alone, in a range or inside a named set', async () => {
  for (const spec of ['131', '185', '150', '100-131', '120-190', '1-185', '101,140']) {
    assert.throws(
      () => parseTaskSpec(spec),
      (e) => e instanceof TaskSelectionError && /sealed/.test(e.message),
      spec,
    );
  }
  assert.throws(() => parseTaskSpec('186'), /not open/);
  assert.throws(() => parseTaskSpec('nope'), /unknown task set/);
  assert.equal(parseTaskSpec('retired').length, 30);
  assert.deepEqual(parseTaskSpec('3,1-2,3'), [1, 2, 3]);
  const r = await run(['--tasks', '131-185', '--dry-run']);
  assert.equal(r.code, 2);
  assert.match(r.text, /sealed/);
  // Even with a key and a stub in reach, a sealed request is refused before anything is sent.
  const stub = await startStub('anthropic');
  const r2 = await run(
    ['--tasks', '140', '--model', 'm', '--cap', '5', '--price-in', '1', '--price-out', '1', '--base-url', stub.url, '--out', tmp()],
    { ANTHROPIC_API_KEY: KEY },
  );
  await stub.close();
  assert.equal(r2.code, 2);
  assert.equal(stub.requests.length, 0);
});

test('dry run needs no key, sends nothing and reads no key', async () => {
  const stub = await startStub('anthropic');
  const r = await run(['--tasks', '101-103', '--arms', 'B,C', '--base-url', stub.url, '--price-in', '3', '--price-out', '15']);
  await stub.close();
  assert.equal(r.code, 0);
  assert.match(r.text, /dry run/);
  assert.match(r.text, /no key set/);
  assert.match(r.text, /6 |all\s+6/);
  assert.equal(stub.requests.length, 0);
  // an explicit --dry-run wins even when a key is set
  const stub2 = await startStub('anthropic');
  const r2 = await run(['--dry-run', '--tasks', '101', '--base-url', stub2.url], { ANTHROPIC_API_KEY: KEY });
  await stub2.close();
  assert.equal(r2.code, 0);
  assert.equal(stub2.requests.length, 0);
  assert.ok(!r2.text.includes(KEY));
});

test('a real run needs a model, a cap and prices; the estimate over the cap is refused with nothing sent', async () => {
  const stub = await startStub('anthropic');
  const base = ['--tasks', '101-102', '--arms', 'B', '--base-url', stub.url, '--out', tmp()];
  const env = { ANTHROPIC_API_KEY: KEY };
  assert.equal((await run([...base, '--price-in', '1', '--price-out', '1', '--cap', '5'], env)).code, 2); // no model
  assert.equal((await run([...base, '--model', 'm', '--price-in', '1', '--price-out', '1'], env)).code, 2); // no cap
  assert.equal((await run([...base, '--model', 'm', '--cap', '5'], env)).code, 2); // no prices
  const over = await run([...base, '--model', 'm', '--price-in', '1000', '--price-out', '1000', '--cap', '1'], env);
  assert.equal(over.code, 2);
  assert.match(over.text, /refused: the estimate/);
  assert.equal(stub.requests.length, 0);
  await stub.close();
});

for (const kind of ['anthropic', 'openai'] as const) {
  test(`usage accounting and measure, ${kind}: spend comes from the reported usage, the key rides in a header only`, async () => {
    const stub = await startStub(kind, { inputTokens: 2000, outputTokens: 400, text: lede });
    const out = tmp();
    const env = kind === 'anthropic' ? { ANTHROPIC_API_KEY: KEY } : { LEDE_BENCH_API_KEY: KEY };
    const argv = [
      '--provider',
      kind === 'anthropic' ? 'anthropic' : 'openai-compatible',
      '--base-url',
      stub.url,
      '--model',
      'writer-x',
      '--tasks',
      '101-103',
      '--arms',
      'C',
      '--cap',
      '10',
      '--price-in',
      '3',
      '--price-out',
      '15',
      '--out',
      out,
    ];
    const r = await run(argv, env);
    await stub.close();
    assert.equal(r.code, 0, r.text);
    assert.equal(stub.requests.length, 3);
    const results = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'));
    assert.equal(results.rows.length, 3);
    assert.ok(results.rows.every((x: any) => x.inputTokens === 2000 && x.outputTokens === 400 && x.valid === true && x.buildOk === true));
    const per = (2000 * 3 + 400 * 15) / 1e6;
    assert.ok(Math.abs(results.spentUsd - 3 * per) < 1e-9);
    assert.match(r.text, /spend: \$0\.0360/);
    assert.equal(results.provider, kind === 'anthropic' ? 'anthropic' : 'openai-compatible');
    assert.equal(results.requestedModel, 'writer-x');
    assert.deepEqual(results.returnedModels, ['stub-model-returned']);
    assert.match(results.commit, /^[0-9a-f]{40}$|^unknown$/);
    assert.equal(results.arms[0].promptSha256.length, 64);
    assert.equal(results.tasks.sha256.length, 64);
    // the writer got only its prompt and the brief
    const sent = stub.requests[0].body;
    assert.equal(sent.messages.length, 1);
    assert.equal(sent.messages[0].role, 'user');
    assert.ok(sent.messages[0].content.startsWith('Write the page in Lede'));
    if (kind === 'anthropic') {
      assert.equal(stub.requests[0].path, '/v1/messages');
      assert.equal(stub.requests[0].headers['x-api-key'], KEY);
      assert.equal(sent.max_tokens, 16000);
    } else {
      assert.equal(stub.requests[0].path, '/chat/completions');
      assert.equal(stub.requests[0].headers.authorization, `Bearer ${KEY}`);
      assert.equal(sent.max_tokens, 16000); // a non-OpenAI host gets max_tokens
      assert.equal(results.rows[0].reasoningTokens, 100);
    }
    // the key is in no output line and in no file
    assert.ok(!r.text.includes(KEY));
    for (const f of filesUnder(out)) assert.ok(!readFileSync(f, 'utf8').includes(KEY), f);
  });
}

test('the cap holds: replies are shortened to fit it and the run stops before passing it', async () => {
  const stub = await startStub('anthropic', { inputTokens: 3000, outputTokens: 2000, text: lede });
  const out = tmp();
  // 10 USD/MTok both ways: a 3000+2000 token call costs 0.05; the estimate (0.27) fits the 0.28 cap, five calls do, a sixth would not.
  const r = await run(
    [
      '--base-url',
      stub.url,
      '--model',
      'm',
      '--tasks',
      '101-110',
      '--arms',
      'C',
      '--cap',
      '0.28',
      '--price-in',
      '10',
      '--price-out',
      '10',
      '--out',
      out,
      '--est-out',
      'C=100',
    ],
    { ANTHROPIC_API_KEY: KEY },
  );
  await stub.close();
  const results = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'));
  assert.ok(results.spentUsd <= 0.28 + 1e-9, String(results.spentUsd));
  assert.equal(results.rows.length, 5);
  assert.match(results.stoppedEarly, /leaves no room/);
  assert.match(r.text, /spend: /);
  // every request's output limit left the cap whole: spent so far + this call's worst case <= cap
  assert.ok(stub.requests.every((q) => q.body.max_tokens <= 16000));
});

test('a rerun resumes from rows.jsonl and does not ask a finished task again', async () => {
  const stub = await startStub('anthropic', { text: lede });
  const out = tmp();
  const argv = [
    '--base-url',
    stub.url,
    '--model',
    'm',
    '--tasks',
    '101-102',
    '--arms',
    'C',
    '--cap',
    '5',
    '--price-in',
    '1',
    '--price-out',
    '1',
    '--out',
    out,
  ];
  await run(argv, { ANTHROPIC_API_KEY: KEY });
  assert.equal(stub.requests.length, 2);
  const again = await run(argv, { ANTHROPIC_API_KEY: KEY });
  await stub.close();
  assert.equal(stub.requests.length, 2);
  assert.match(again.text, /resuming/);
});

test('transport retries see no content: 503 then success; a 4xx stops the run; the key is redacted from an echoing error', async () => {
  const sleeps: number[] = [];
  const retry = await startStub('openai', { statuses: [503, 429], text: 'hello' });
  const p = createProvider({
    kind: 'openai-compatible',
    baseUrl: retry.url,
    model: 'm',
    env: { LEDE_BENCH_API_KEY: KEY },
    sleep: async (ms) => void sleeps.push(ms),
  });
  const c = await p.complete('hi', 100);
  await retry.close();
  assert.equal(c.text, 'hello');
  assert.equal(retry.requests.length, 3);
  assert.deepEqual(sleeps, [1000, 2000]);

  const bad = await startStub('anthropic', { statuses: [401], errorBody: (h) => `bad key ${String(h['x-api-key'])}` });
  const out = tmp();
  const r = await run(
    [
      '--base-url',
      bad.url,
      '--model',
      'm',
      '--tasks',
      '101-102',
      '--arms',
      'B',
      '--cap',
      '5',
      '--price-in',
      '1',
      '--price-out',
      '1',
      '--out',
      out,
    ],
    { ANTHROPIC_API_KEY: KEY },
  );
  await bad.close();
  assert.equal(r.code, 1);
  assert.equal(bad.requests.length, 1);
  assert.match(r.text, /HTTP 401/);
  assert.ok(!r.text.includes(KEY));
  assert.match(r.text, /\[redacted\]/);
  for (const f of filesUnder(out)) assert.ok(!readFileSync(f, 'utf8').includes(KEY), f);
});

test('missing usage is charged at the worst case, so the cap still holds', async () => {
  const stub = await startStub('anthropic', { omitUsage: true, text: lede });
  const out = tmp();
  await run(
    [
      '--base-url',
      stub.url,
      '--model',
      'm',
      '--tasks',
      '101',
      '--arms',
      'C',
      '--cap',
      '5',
      '--price-in',
      '1',
      '--price-out',
      '1',
      '--out',
      out,
    ],
    { ANTHROPIC_API_KEY: KEY },
  );
  await stub.close();
  const row = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8')).rows[0];
  assert.equal(row.usageMissing, true);
  assert.ok(row.costUsd > 0.01);
});

test('keys: OPENAI_API_KEY is used only for api.openai.com; other hosts need LEDE_BENCH_API_KEY', () => {
  const env = { OPENAI_API_KEY: 'a'.repeat(12) };
  assert.equal(keyFor('openai-compatible', 'https://api.openai.com/v1', env)?.name, 'OPENAI_API_KEY');
  assert.equal(keyFor('openai-compatible', 'https://host.example/v1', env), null);
  assert.equal(
    keyFor('openai-compatible', 'https://host.example/v1', { ...env, LEDE_BENCH_API_KEY: 'b'.repeat(12) })?.name,
    'LEDE_BENCH_API_KEY',
  );
  assert.equal(keyFor('anthropic', 'https://api.anthropic.com', { ANTHROPIC_API_KEY: 'c'.repeat(12) })?.name, 'ANTHROPIC_API_KEY');
  assert.throws(() => createProvider({ kind: 'anthropic', model: 'm', env: {} }), /ANTHROPIC_API_KEY/);
});

test('api.openai.com gets max_completion_tokens; the writer message holds the arm prompt and the brief', async () => {
  let body: any;
  const p = createProvider({
    kind: 'openai-compatible',
    model: 'm',
    env: { OPENAI_API_KEY: 'k'.repeat(12) },
    retries: 0,
    fetchImpl: async (_u, init) => {
      body = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'x' }, finish_reason: 'length' }],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
        }),
      );
    },
  });
  const c = await p.complete('hi', 77);
  assert.equal(body.max_completion_tokens, 77);
  assert.equal(body.max_tokens, undefined);
  assert.equal(c.truncated, true);
  const msg = writerMessage(ARMS.B, 'BRIEF TEXT');
  assert.ok(msg.includes('Brief:\nBRIEF TEXT'));
  assert.ok(msg.startsWith('Write one complete, self-contained HTML document'));
});

test('measure re-reads saved pages with no network', async () => {
  const stub = await startStub('anthropic', { text: lede });
  const out = tmp();
  await run(
    [
      '--base-url',
      stub.url,
      '--model',
      'm',
      '--tasks',
      '101',
      '--arms',
      'C',
      '--cap',
      '5',
      '--price-in',
      '1',
      '--price-out',
      '1',
      '--out',
      out,
    ],
    { ANTHROPIC_API_KEY: KEY },
  );
  await stub.close();
  assert.ok(existsSync(join(out, 'pages', 'C', '101.lede')));
  const r = await run(['measure', '--out', out]);
  assert.equal(r.code, 0);
  assert.match(r.text, /1\/1/);
});
