// scripts/runtime-hash-note.ts and its place in .releaserc.json (issue #19): the release notes name the shell runtime's SHA-256
// when the hash file changed since the previous release tag, and say nothing when it did not. Runs real git in a scratch repository.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { HASH_FILE, runtimeHashNote } from '../scripts/runtime-hash-note.ts';
import { root } from '../scripts/pack.ts';

const SCRIPT = join(root, 'scripts', 'runtime-hash-note.ts');
const tmp = mkdtempSync(join(tmpdir(), 'lede-hash-note-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = '0123456789abcdef'.repeat(4);

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'lede test',
      GIT_AUTHOR_EMAIL: 'none',
      GIT_COMMITTER_NAME: 'lede test',
      GIT_COMMITTER_EMAIL: 'none',
    },
  });

let repos = 0;
/** A scratch repository on `main`. `write` puts files in the work tree and commits them in one commit. */
function scratch() {
  const dir = join(tmp, String(repos++));
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  let n = 0;
  return {
    dir,
    write(files: Record<string, string>) {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', `commit ${++n}`);
    },
    tag: (name: string) => git(dir, 'tag', name),
  };
}

const LINE = (hex: string) => `Shell runtime SHA-256: ${hex}`;

test('a changed hash file prints the new hash on one line', () => {
  const r = scratch();
  r.write({ [HASH_FILE]: `${A}\n` });
  r.tag('v0.1.0');
  r.write({ [HASH_FILE]: `${B}\n` });
  assert.equal(runtimeHashNote(r.dir, 'v0.1.0'), LINE(B));
});

test('an unchanged hash file prints nothing, whatever else changed', () => {
  const r = scratch();
  r.write({ [HASH_FILE]: `${A}\n`, 'other.txt': 'one\n' });
  r.tag('v0.1.0');
  r.write({ 'other.txt': 'two\n' });
  assert.equal(runtimeHashNote(r.dir, 'v0.1.0'), '');
});

test('the content is compared, so a change reverted before the release prints nothing', () => {
  const r = scratch();
  r.write({ [HASH_FILE]: `${A}\n` });
  r.tag('v0.1.0');
  r.write({ [HASH_FILE]: `${B}\n` });
  r.write({ [HASH_FILE]: `${A}\n` });
  assert.equal(runtimeHashNote(r.dir, 'v0.1.0'), '');
});

test('only the newest hash is named when it changed twice since the tag', () => {
  const r = scratch();
  r.write({ [HASH_FILE]: `${A}\n` });
  r.tag('v0.1.0');
  r.write({ [HASH_FILE]: `${B}\n` });
  r.write({ [HASH_FILE]: `${C}\n` });
  assert.equal(runtimeHashNote(r.dir, 'v0.1.0'), LINE(C));
});

test('the previous tag is the baseline: a change before it is not news', () => {
  const r = scratch();
  r.write({ [HASH_FILE]: `${A}\n` });
  r.tag('v0.1.0');
  r.write({ [HASH_FILE]: `${B}\n` });
  r.tag('v0.2.0');
  r.write({ 'other.txt': 'x\n' });
  assert.equal(runtimeHashNote(r.dir, 'v0.2.0'), '');
  assert.equal(runtimeHashNote(r.dir, 'v0.1.0'), LINE(B));
});

test('with no previous tag, an unknown tag, or a file the tag lacked, the hash is printed', () => {
  const r = scratch();
  r.write({ 'other.txt': 'x\n' });
  r.tag('v0.1.0');
  r.write({ [HASH_FILE]: `${A}\n` });
  assert.equal(runtimeHashNote(r.dir), LINE(A));
  assert.equal(runtimeHashNote(r.dir, ''), LINE(A));
  assert.equal(runtimeHashNote(r.dir, 'v9.9.9'), LINE(A));
  assert.equal(runtimeHashNote(r.dir, 'v0.1.0'), LINE(A));
});

test('a branch is not a tag: a branch named like the tag does not stand in for it', () => {
  const r = scratch();
  r.write({ [HASH_FILE]: `${A}\n` });
  git(r.dir, 'branch', 'v0.1.0');
  r.write({ [HASH_FILE]: `${B}\n` });
  assert.equal(runtimeHashNote(r.dir, 'v0.1.0'), LINE(B));
});

test('a hash file that is not a SHA-256 in hex fails the release rather than printing it', () => {
  const r = scratch();
  r.write({ [HASH_FILE]: `${A}\n` });
  r.tag('v0.1.0');
  r.write({ [HASH_FILE]: 'not a hash\n' });
  assert.throws(() => runtimeHashNote(r.dir, 'v0.1.0'), /not a SHA-256/);
  r.write({ [HASH_FILE]: `${A.slice(1)}\n` });
  assert.throws(() => runtimeHashNote(r.dir, 'v0.1.0'), /not a SHA-256/);
});

test('the command prints the line, and only the line, from the directory it is run in', () => {
  const r = scratch();
  r.write({ [HASH_FILE]: `${A}\n` });
  r.tag('v0.1.0');
  const run = (...args: string[]) => execFileSync(process.execPath, [SCRIPT, ...args], { cwd: r.dir, encoding: 'utf8' });
  assert.equal(run('v0.1.0'), '');
  assert.equal(run(), `${LINE(A)}\n`);
  r.write({ [HASH_FILE]: `${B}\n` });
  assert.equal(run('v0.1.0'), `${LINE(B)}\n`);
  assert.equal(run('v0.1.0', 'ignored'), `${LINE(B)}\n`);
});

test('the shipped hash file is one this script accepts', () => {
  assert.match(readFileSync(join(root, HASH_FILE), 'utf8').trim(), /^[0-9a-f]{64}$/);
});

test('.releaserc.json appends the line after the notes generator, and the exec plugin still sets the version', () => {
  const config = JSON.parse(readFileSync(join(root, '.releaserc.json'), 'utf8')) as {
    plugins: (string | [string, Record<string, string>])[];
  };
  const names = config.plugins.map((p) => (typeof p === 'string' ? p : p[0]));
  const exec = config.plugins[names.indexOf('@semantic-release/exec')];
  assert.ok(Array.isArray(exec));
  const { generateNotesCmd, prepareCmd } = exec[1];
  assert.ok(names.indexOf('semantic-release-unsquash') < names.indexOf('@semantic-release/exec'), 'the notes generator comes first');
  assert.match(generateNotesCmd, /^node scripts\/runtime-hash-note\.ts "\$\{lastRelease\.gitTag\}"$/);
  assert.ok(existsSync(join(root, generateNotesCmd.split(' ')[1])));
  assert.match(prepareCmd, /^node scripts\/set-version\.ts \$\{nextRelease\.version\}$/);
});
