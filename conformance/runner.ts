// Points the conformance suite at any Lede implementation.
//   node conformance/runner.ts --cmd "<command>" [--filter TEXT] [--timeout MS] [--json]
// Protocol (what the reference CLI already does): for each file in cases/, run `<command> ast <file>` and read the document as JSON
// on stdout; for each file in errors/, run `<command> check --json <file>` and read `{ "<file>": [diagnostic, ...] }` on stdout (a
// page of tabs adds an entry per part after the file's own, D85; only the first entry is compared).
// <file> is an absolute path, shell-quoted and appended to the command; the working directory is yours. Exit codes are
// ignored. Contract: a case's `meta`, `blocks` and `data` match exactly, and its diagnostics, like every error case's, match on
// severity, code, line and col, in order. `message` and `detail` are implementation detail and are never compared.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
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

function run(cmd: string, args: string, file: string, timeout: number): unknown {
  const r = spawnSync(`${cmd} ${args} ${quote(file)}`, { shell: true, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(r.error.message.includes('ETIMEDOUT') ? `timed out after ${timeout} ms` : r.error.message);
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

function checkCase(cmd: string, dir: Kind, f: string, timeout: number): void {
  const file = join(here, dir, f);
  const expected: unknown = JSON.parse(readFileSync(expectedPath(dir, f), 'utf8'));
  if (dir === 'cases') {
    const got = run(cmd, 'ast', file, timeout);
    assert.ok(isObj(got) && isObj(expected), 'the AST is not a JSON object');
    const { diagnostics: wantDiags, ...want } = expected;
    const { diagnostics: gotDiags, ...rest } = got;
    assert.deepEqual(rest, want);
    assert.deepEqual(diagsOf(gotDiags), diagsOf(wantDiags));
  } else {
    const got = run(cmd, 'check --json', file, timeout);
    assert.ok(isObj(got), 'check --json did not print an object keyed by file');
    const values = Object.values(got);
    assert.ok(values.length >= 1, 'expected an entry keyed by the file');
    assert.deepEqual(diagsOf(values[0]), diagsOf(expected));
  }
}

export function runSuite(cmd: string, opts: { filter?: string | undefined; timeout?: number } = {}): Report {
  const results: CaseResult[] = [];
  for (const dir of ['cases', 'errors'] as Kind[]) {
    for (const f of listCases(dir)) {
      const name = `${dir}/${f}`;
      if (opts.filter && !name.includes(opts.filter)) continue;
      try {
        checkCase(cmd, dir, f, opts.timeout ?? 20000);
        results.push({ name, pass: true });
      } catch (e) {
        results.push({ name, pass: false, reason: (e as Error).message.split('\n')[0] ?? 'failed' });
      }
    }
  }
  const passed = results.filter((r) => r.pass).length;
  const percent = results.length === 0 ? 0 : Math.round((passed / results.length) * 1000) / 10;
  return { command: cmd, total: results.length, passed, percent, results };
}

function main(argv: string[]): number {
  const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const cmd = opt('--cmd');
  if (!cmd) {
    process.stderr.write('usage: node conformance/runner.ts --cmd "<command>" [--filter TEXT] [--timeout MS] [--json]\n');
    return 2;
  }
  const timeout = Number(opt('--timeout') ?? 20000);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    process.stderr.write('--timeout takes a whole number of milliseconds\n');
    return 2;
  }
  const report = runSuite(cmd, { filter: opt('--filter'), timeout });
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    for (const r of report.results) process.stdout.write(`${r.pass ? 'pass' : 'FAIL'}  ${r.name}${r.reason ? `  ${r.reason}` : ''}\n`);
    process.stdout.write(`\n${report.passed}/${report.total} passed (${report.percent}%)\n`);
  }
  return report.total > 0 && report.passed === report.total ? 0 : 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
