// D80, F10: `--theme tokens.json` in build, watch and check. The operator names the file, so it is read from anywhere, as JSON only,
// at most 64 KiB; what is in it reaches the page only as validated hex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const run = (args: string[], cwd: string, input?: string) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', input });
const style = (html: string): string => /<style>[\s\S]*?<\/style>/.exec(html)![0];
const decls = (block: string): Record<string, string> =>
  Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));

const TOKENS = {
  accent: '#e0451f',
  light: { bg: '#fff8f0', muted: '#a0968a' },
  dark: { bg: '#1a1210' },
  series: ['#e0451f', '#0b6e99', '#f2c14e'],
};
const PAGE = '@title Brand\n@accent #2357c6\n# Brand\n\nA [link](https://example.com).\n';

function folder(tokens: unknown = TOKENS): string {
  const dir = mkdtempSync(join(tmpdir(), 'lede-theme-'));
  writeFileSync(join(dir, 'p.lede'), PAGE);
  writeFileSync(join(dir, 'tokens.json'), typeof tokens === 'string' ? tokens : JSON.stringify(tokens, null, 2));
  return dir;
}

test('build --theme writes the operator palette into the page, adjusted for contrast, and ignores the page accent', () => {
  const dir = folder();
  const r = run(['build', 'p.lede', '--theme', 'tokens.json', '-o', 'out.html'], dir);
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(join(dir, 'out.html'), 'utf8');
  const first = decls(/:root\{([^}]*)\}/.exec(style(html))![1]);
  assert.equal(first.bg, '#fff8f0');
  assert.notEqual(first.muted, '#a0968a', 'moved: it did not read');
  assert.match(first.muted, /^#[0-9a-f]{6}$/);
  assert.equal(first.accent, first['accent-ink']);
  assert.equal(first.c2, '#0b6e99');
  assert.ok(!html.includes('#2357c6'), 'the page accent is not used');
  // What the operator hears.
  assert.match(r.stderr, /tokens\.json:2:3: \S*warning\S* \[theme-adjusted\] light accent #e0451f has 3\.61:1 on accent-tint/);
  assert.match(r.stderr, /tokens\.json:5:5: \S*warning\S* \[theme-adjusted\] light muted #a0968a/);
  assert.match(r.stderr, /p\.lede:2:1: \S*warning\S* \[theme-override\] @accent is ignored/);
  // The `=` form is the same option, and the `=` and the space are one.
  assert.equal(run(['build', 'p.lede', '--theme=tokens.json'], dir).stdout, readFileSync(join(dir, 'out.html'), 'utf8'));
});

test('--artifact keeps the <style> of the full page, and a page without --theme is the house page', () => {
  const dir = folder();
  const full = run(['build', 'p.lede', '--theme', 'tokens.json'], dir).stdout;
  const art = run(['build', 'p.lede', '--theme', 'tokens.json', '--artifact'], dir).stdout;
  assert.equal(style(art), style(full));
  assert.ok(style(full).includes('--bg:#fff8f0;'));
  const house = run(['build', 'p.lede'], dir).stdout;
  assert.ok(house.includes('--accent:#2357c6;--accent-ink:#2357c6;'), 'the writer accent, as before');
  assert.ok(!house.includes('#fff8f0'));
  assert.equal(style(run(['build', 'p.lede', '--artifact'], dir).stdout), style(house));
});

test('the tokens file is not confined to the document tree: it is named by the operator', () => {
  const dir = folder();
  const elsewhere = mkdtempSync(join(tmpdir(), 'lede-brand-'));
  writeFileSync(join(elsewhere, 'brand.json'), JSON.stringify({ light: { bg: '#fffaf0' } }));
  symlinkSync(join(elsewhere, 'brand.json'), join(dir, 'link.json'));
  for (const path of [join(elsewhere, 'brand.json'), '../' + elsewhere.split('/').pop() + '/brand.json', 'link.json']) {
    const r = run(['build', 'p.lede', '--theme', path], dir);
    assert.equal(r.status, 0, `${path}: ${r.stderr}`);
    assert.ok(r.stdout.includes('--bg:#fffaf0;'), path);
  }
});

test('check reports the theme under its own file name, with positions, details and exit codes', () => {
  const dir = folder();
  const r = run(['check', 'p.lede', '--theme', 'tokens.json', '--json'], dir);
  assert.equal(r.status, 0, 'adjustments are warnings');
  const all = JSON.parse(r.stdout) as Record<
    string,
    { severity: string; code: string; line: number; col: number; detail?: Record<string, unknown> }[]
  >;
  assert.deepEqual(Object.keys(all), ['tokens.json', 'p.lede']);
  const moved = all['tokens.json'].find((d) => d.detail?.token === 'muted')!;
  assert.deepEqual(
    { sev: moved.severity, code: moved.code, line: moved.line, col: moved.col, ...moved.detail },
    {
      sev: 'warning',
      code: 'theme-adjusted',
      line: 5,
      col: 5,
      token: 'muted',
      theme: 'light',
      from: '#a0968a',
      to: moved.detail!.to,
      ratio: moved.detail!.ratio,
      required: 4.5,
      against: 'bg',
    },
  );
  assert.deepEqual(
    all['p.lede'].map((d) => [d.code, d.line, d.detail]),
    [['theme-override', 2, { key: 'accent' }]],
  );
  // Without --json: the counts, never ok.
  const text = run(['check', 'p.lede', '--theme', 'tokens.json'], dir);
  assert.match(text.stderr.trimEnd().split('\n').at(-1)!, /^5 warning\(s\)$/);
  assert.equal(run(['check', 'p.lede'], dir).stderr.trimEnd().split('\n').at(-1), 'ok');
});

test('--theme-strict makes a moved colour an error: check exits 1, build refuses and --force writes', () => {
  const dir = folder();
  const c = run(['check', 'p.lede', '--theme', 'tokens.json', '--theme-strict'], dir);
  assert.equal(c.status, 1);
  assert.match(c.stderr, /\S*error\S* \[theme-adjusted\] light accent #e0451f .* it would be #[0-9a-f]{6}/);
  const b = run(['build', 'p.lede', '--theme', 'tokens.json', '--theme-strict', '-o', 'out.html'], dir);
  assert.equal(b.status, 1);
  assert.match(b.stderr, /4 error\(s\); not written/);
  assert.throws(() => readFileSync(join(dir, 'out.html')));
  assert.equal(run(['build', 'p.lede', '--theme', 'tokens.json', '--theme-strict', '--force', '-o', 'out.html'], dir).status, 0);
  assert.ok(readFileSync(join(dir, 'out.html'), 'utf8').includes('--bg:#fff8f0;'));
  // A file that needs no moving is clean under strict.
  const ok = folder({ light: { bg: '#fffaf0' } });
  assert.equal(run(['check', 'p.lede', '--theme', 'tokens.json', '--theme-strict'], ok).status, 0);
});

test('a value that is not a hex colour is E theme-value: build refuses, and nothing of it is in the page even with --force', () => {
  const attack = '#fff;}body{background:url(//xss.example/a.png)}</style><script>alert(1)</script>';
  const dir = folder({ accent: attack, light: { bg: 'red', fg: '#abcd' }, dark: { surface: '#fff}' }, series: ['url(x)'] });
  const r = run(['build', 'p.lede', '--theme', 'tokens.json', '-o', 'out.html'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /tokens\.json:\d+:\d+: \S*error\S* \[theme-value\] accent must be a hex colour/);
  assert.match(r.stderr, /\[theme-value\] light\.bg must be a hex colour/);
  assert.match(r.stderr, /5 error\(s\); not written/);
  const forced = run(['build', 'p.lede', '--theme', 'tokens.json', '--force'], dir);
  assert.equal(forced.status, 0);
  assert.doesNotMatch(forced.stdout, /xss\.example|<script|alert\(1\)|url\(x\)|body\{background:url/);
  assert.equal(style(forced.stdout).match(/<\/style>/g)?.length, 1);
  assert.deepEqual(
    Object.entries(decls(forced.stdout)).filter(([, v]) => !/^#[0-9a-f]{6}$/.test(v)),
    [],
  );
});

test('a tokens file that cannot be used is a usage error, exit 2, named for the option', () => {
  const dir = folder();
  mkdirSync(join(dir, 'dir.json'));
  writeFileSync(join(dir, 'broken.json'), '{"accent": ');
  writeFileSync(join(dir, 'array.json'), '[]');
  writeFileSync(join(dir, 'big.json'), `{"x":"${'a'.repeat(64 * 1024)}"}`);
  writeFileSync(join(dir, 'edge.json'), `{"x":"${'a'.repeat(64 * 1024 - 20)}"}`);
  for (const cmd of ['build', 'check']) {
    for (const [file, why] of [
      ['nope.json', /--theme nope\.json: no such file/],
      ['dir.json', /--theme dir\.json: not a regular file/],
      ['broken.json', /--theme broken\.json: not valid JSON/],
      ['array.json', /--theme array\.json: must be a JSON object/],
      ['big.json', /--theme big\.json: larger than 64 KiB/],
    ] as const) {
      const r = run([cmd, 'p.lede', '--theme', file], dir);
      assert.equal(r.status, 2, `${cmd} ${file}`);
      assert.match(r.stderr, why, `${cmd} ${file}`);
      assert.equal(r.stdout, '', 'nothing built');
    }
  }
  const edge = run(['check', 'p.lede', '--theme', 'edge.json'], dir);
  assert.equal(edge.status, 0, edge.stderr);
  assert.match(edge.stderr, /\[theme-key\] x is not a key/);
  // The same through stdin for the document: the tokens file is still a path.
  assert.equal(run(['build', '-', '--theme', 'nope.json'], dir, PAGE).status, 2);
});

test('--theme and --theme-strict are checked as options: a value is needed, once, and strict needs a file', () => {
  const dir = folder();
  const cases: [string[], RegExp][] = [
    [['build', 'p.lede', '--theme'], /lede: --theme needs a tokens file/],
    [['build', 'p.lede', '--theme', '--force'], /lede: --theme needs a tokens file/],
    [['build', 'p.lede', '--theme='], /lede: --theme needs a tokens file/],
    [['build', 'p.lede', '--theme', 'tokens.json', '--theme=tokens.json'], /lede: --theme given more than once/],
    [['build', 'p.lede', '--theme-strict'], /lede: --theme-strict needs --theme FILE/],
    [['check', 'p.lede', '--theme-strict'], /lede: --theme-strict needs --theme FILE/],
    [['watch', 'p.lede', '--theme-strict'], /lede: --theme-strict needs --theme FILE/],
    [['build', 'p.lede', '--theem', 'tokens.json'], /unknown option --theem; did you mean --theme\?/],
  ];
  for (const [args, message] of cases) {
    const r = run(args, dir);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, message, args.join(' '));
    assert.match(r.stderr, /usage:\n/);
  }
  // `ast` takes no theme: the options are ignored, the file is not even read.
  assert.equal(run(['ast', 'p.lede', '--theme', 'nope.json', '--theme-strict'], dir).status, 0);
  assert.equal(run(['--theme', 'tokens.json', 'build', 'p.lede'], dir).status, 2, 'options go after the command');
});

test('watch builds with the theme, and reads the file again for the next build', async () => {
  const dir = folder({ light: { bg: '#fff8f0' } });
  const child = spawn(process.execPath, [CLI, 'watch', 'p.lede', '-o', 'out.html', '--theme', 'tokens.json'], { cwd: dir });
  let err = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => (err += d));
  const html = () => {
    try {
      return readFileSync(join(dir, 'out.html'), 'utf8');
    } catch {
      return '';
    }
  };
  const until = async (what: string, done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(done(), `timed out waiting for ${what}; stderr so far:\n${err}`);
  };
  try {
    await until('the first build', () => err.includes('watching') && html().includes('--bg:#fff8f0;'));
    assert.match(err, /p\.lede:2:1: \S*warning\S* \[theme-override\]/);
    writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ light: { bg: '#fffaf0' } }));
    writeFileSync(join(dir, 'p.lede'), `${PAGE}\nmore\n`);
    await until('a rebuild with the new tokens', () => html().includes('--bg:#fffaf0;') && html().includes('more'));
    // A tokens file that goes bad is one line, and the watcher keeps going.
    writeFileSync(join(dir, 'tokens.json'), '{');
    writeFileSync(join(dir, 'p.lede'), `${PAGE}\nagain\n`);
    await until('the line about the tokens file', () => /lede: --theme tokens\.json: not valid JSON \(/.test(err));
    assert.equal(child.exitCode, null, 'still running');
    writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ light: { bg: '#fffbf5' } }));
    writeFileSync(join(dir, 'p.lede'), `${PAGE}\nonce more\n`);
    await until('a rebuild after the fix', () => html().includes('--bg:#fffbf5;') && html().includes('once more'));
    assert.doesNotMatch(err, /\n\s+at /, 'no stack trace');
  } finally {
    child.kill();
  }
});

test('--help documents the flags, the codes and the limit', () => {
  const help = run(['--help'], folder()).stdout;
  assert.match(help, /lede build .*\n\s+\[--theme tokens\.json \[--theme-strict\]\]/);
  assert.match(help, /lede watch .*\[--theme tokens\.json \[--theme-strict\]\]/);
  assert.match(help, /lede check [^\n]*\n\s+\[--theme tokens\.json \[--theme-strict\]\]/);
  assert.match(help, /--theme FILE\s+build\/watch\/check: brand tokens, a JSON file \(at most 64 KiB\)/);
  assert.match(help, /W theme-override/);
  assert.match(help, /W theme-adjusted/);
  assert.match(help, /E theme-value/);
  assert.match(help, /--theme-strict\s+build\/watch\/check: with --theme/);
  assert.match(help, /E theme-adjusted/);
});

test('check --external and --theme work together: the tokens file and the page are both reported, and a finding is still exit 1', () => {
  const dir = folder();
  writeFileSync(join(dir, 'leak.lede'), '# Leak\n\nSee https://wiki.acme-internal.io/page for it.\n');
  const r = run(['check', 'leak.lede', '--external', '--allow=none.acme-other.io', '--theme', 'tokens.json', '--json'], dir);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout) as Record<string, { code: string }[]>;
  assert.ok(out['tokens.json'].some((d) => d.code === 'theme-adjusted'));
  assert.ok(out['leak.lede'].some((d) => d.code === 'external'));
  // The same page with only the theme is clean, as the theme alone adds nothing to a page without an accent.
  assert.equal(run(['check', 'leak.lede', '--theme', 'tokens.json'], dir).status, 0);
});
