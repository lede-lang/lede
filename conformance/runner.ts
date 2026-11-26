// Points the conformance suite at any Lede implementation.
//   node conformance/runner.ts --cmd "<command>" [--filter TEXT] [--timeout MS] [--jobs N] [--json]
// Protocol (what the reference CLI already does): for each file in cases/, run `<command> ast <file>` and read the document as JSON
// on stdout; for each file in errors/, run `<command> check --json <file>` and read `{ "<file>": [diagnostic, ...] }` on stdout (a
// page of tabs adds an entry per part after the file's own, D85; only the first entry is compared).
// <file> is an absolute path, shell-quoted and appended to the command; the working directory is yours. Exit codes are
// ignored. Contract: a case's `meta`, `blocks` and `data` match exactly, and its diagnostics, like every error case's, match on
// severity, code, line and col, in order. `message` and `detail` are implementation detail and are never compared.
import { exec } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { mapPool } from '../bench/src/pool.ts';
import { contractDiag, expectedPath, here, listCases, type Diag, type Kind } from './shared.ts';

export interface CaseResult {
  name: string;
  pass: boolean;
  reason?: string;
}

export interface Report {
  command: string;
  total: number;
  passed: number;
  percent: number;
  results: CaseResult[];
}

const quote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

async function run(cmd: string, args: string, file: string, timeout: number): Promise<unknown> {
  // Exit codes are ignored, so a non-zero exit is not a failure here; only a timeout or a command that cannot start is.
  const r = await new Promise<{ status: number; stdout: string; stderr: string }>((ok, fail) => {
    exec(`${cmd} ${args} ${quote(file)}`, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err?.killed) fail(new Error(`timed out after ${timeout} ms`));
      else if (err && typeof err.code !== 'number') fail(err);
      else ok({ status: typeof err?.code === 'number' ? err.code : 0, stdout, stderr });
    });
  });
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`stdout is not JSON (exit ${r.status}): ${r.stdout.slice(0, 80) || r.stderr.slice(0, 80)}`);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const diagsOf = (v: unknown): Diag[] => {
  if (!Array.isArray(v)) throw new Error('diagnostics are not an array');
  return v.map((d) => contractDiag(d as Diag));
};

async function checkCase(cmd: string, dir: Kind, f: string, timeout: number): Promise<void> {
  const file = join(here, dir, f);
  const expected: unknown = JSON.parse(readFileSync(expectedPath(dir, f), 'utf8'));
  if (dir === 'cases') {
    const got = await run(cmd, 'ast', file, timeout);
    assert.ok(isObj(got) && isObj(expected), 'the AST is not a JSON object');
    const { diagnostics: wantDiags, ...want } = expected;
    const { diagnostics: gotDiags, ...rest } = got;
    assert.deepEqual(rest, want);
    assert.deepEqual(diagsOf(gotDiags), diagsOf(wantDiags));
  } else {
    const got = await run(cmd, 'check --json', file, timeout);
    assert.ok(isObj(got), 'check --json did not print an object keyed by file');
    const values = Object.values(got);
    assert.ok(values.length >= 1, 'expected an entry keyed by the file');
    assert.deepEqual(diagsOf(values[0]), diagsOf(expected));
  }
}

/** `jobs` cases run at once (default 1); results keep the order of the cases. */
export async function runSuite(cmd: string, opts: { filter?: string | undefined; timeout?: number; jobs?: number } = {}): Promise<Report> {
  const todo = (['cases', 'errors'] as Kind[])
    .flatMap((dir) => listCases(dir).map((f) => ({ dir, f, name: `${dir}/${f}` })))
    .filter(({ name }) => !opts.filter || name.includes(opts.filter));
  const results = await mapPool(todo, opts.jobs ?? 1, async ({ dir, f, name }): Promise<CaseResult> => {
    try {
      await checkCase(cmd, dir, f, opts.timeout ?? 20000);
      return { name, pass: true };
    } catch (e) {
      return { name, pass: false, reason: (e as Error).message.split('\n')[0] ?? 'failed' };
    }
  });
  const passed = results.filter((r) => r.pass).length;
  const percent = results.length === 0 ? 0 : Math.round((passed / results.length) * 1000) / 10;
  return { command: cmd, total: results.length, passed, percent, results };
}

async function main(argv: string[]): Promise<number> {
  const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const cmd = opt('--cmd');
  if (!cmd) {
    process.stderr.write('usage: node conformance/runner.ts --cmd "<command>" [--filter TEXT] [--timeout MS] [--jobs N] [--json]\n');
    return 2;
  }
  const timeout = Number(opt('--timeout') ?? 20000);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    process.stderr.write('--timeout takes a whole number of milliseconds\n');
    return 2;
  }
  const jobs = Number(opt('--jobs') ?? 1);
  if (!Number.isInteger(jobs) || jobs <= 0) {
    process.stderr.write('--jobs takes a whole number of cases to run at once\n');
    return 2;
  }
  const report = await runSuite(cmd, { filter: opt('--filter'), timeout, jobs });
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    for (const r of report.results) process.stdout.write(`${r.pass ? 'pass' : 'FAIL'}  ${r.name}${r.reason ? `  ${r.reason}` : ''}\n`);
    process.stdout.write(`\n${report.passed}/${report.total} passed (${report.percent}%)\n`);
  }
  return report.total > 0 && report.passed === report.total ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
