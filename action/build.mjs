// The shell logic of the Lede GitHub Action (action.yml), kept in a script so it can be tested and so no workflow input is ever
// interpolated into a shell command: every input arrives as an environment variable, and the CLI is run with an argument vector,
// never through a shell. It never passes --unsafe-html or --allow-remote, and has no input that could.
import { spawnSync } from 'node:child_process';
import { appendFileSync, globSync, mkdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

/**
 * The @lede-lang/cli version to run. An explicit `input` wins. Otherwise the action's own ref, when it is a version tag (`v0.2.4`),
 * names the CLI release of the same number; any other ref (a branch, a SHA, a major tag such as `v0`) gets `latest`. The CLI on npm
 * can lag the repository, so an action pinned to a commit runs the newest published CLI, not that commit's.
 */
export function resolveVersion(input, actionRef) {
  const given = (input ?? '').trim();
  if (given) {
    if (!SAFE_VERSION.test(given)) throw new Error(`version "${given}" is not a version or dist-tag`);
    return given.replace(/^v(?=\d)/, '');
  }
  const m = SEMVER.exec((actionRef ?? '').trim());
  return m ? m[1] : 'latest';
}

/** `true`/`false` inputs as GitHub writes them. */
export function flag(value, fallback) {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '') return fallback;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new Error(`"${value}" is not true or false`);
}

/** A relative path that stays inside `root`, or an error. */
function inside(root, p, what) {
  if (isAbsolute(p) || normalize(p).split(sep).includes('..'))
    throw new Error(`${what} "${p}" must be a relative path inside the repository`);
  return resolve(root, p);
}

/**
 * The `.lede` files the patterns name, relative to `root`, sorted and unique. Patterns are one per line (a glob or a path).
 * node_modules, .git and the output folder are skipped.
 */
export function findFiles(root, patterns, outDir) {
  const found = new Set();
  const out = relative(root, outDir).split(sep).join('/');
  const skip = (p) => {
    const q = String(p.name ?? p)
      .split(sep)
      .join('/');
    return /(^|\/)(node_modules|\.git)(\/|$)/.test(q) || (out !== '' && (q === out || q.startsWith(`${out}/`)));
  };
  for (const raw of patterns.split(/\r?\n/)) {
    const pat = raw.trim();
    if (!pat) continue;
    inside(root, pat, 'file pattern');
    for (const hit of globSync(pat, {
      cwd: root,
      exclude: (d) => /^(node_modules|\.git)$/.test(typeof d === 'string' ? (d.split(/[\\/]/).pop() ?? '') : d.name),
    })) {
      const rel = String(hit).split(sep).join('/');
      if (skip(rel) || !rel.endsWith('.lede')) continue;
      if (statSync(join(root, rel)).isFile()) found.add(rel);
    }
  }
  return [...found].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The output path of a source file: the same folders under `outDir`, `.html` in place of `.lede`. */
export const outputFor = (outDir, rel) => join(outDir, rel.replace(/\.lede$/, '.html'));

function run(cli, args, cwd) {
  const r = spawnSync(cli[0], [...cli.slice(1), ...args], { cwd, stdio: 'inherit', shell: false });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

/** Build every file; returns what was built. Throws on the first failure, after saying which file. */
export function main(env, log = console.log) {
  const root = resolve(env.GITHUB_WORKSPACE || process.cwd());
  const outDir = inside(root, (env.LEDE_OUT_DIR || '_site').trim(), 'out-dir');
  const check = flag(env.LEDE_CHECK, true);
  const artifact = flag(env.LEDE_ARTIFACT, false);
  const version = resolveVersion(env.LEDE_VERSION, env.LEDE_ACTION_REF);
  // LEDE_CLI replaces the npx command (for tests and local runs): a program and its arguments, split on spaces, never run by a shell.
  const cli = env.LEDE_CLI ? env.LEDE_CLI.trim().split(/\s+/) : ['npx', '--yes', `@lede-lang/cli@${version}`];
  const files = findFiles(root, env.LEDE_FILES || '**/*.lede', outDir);
  if (files.length === 0) throw new Error(`no .lede files match: ${(env.LEDE_FILES || '**/*.lede').split(/\r?\n/).join(', ')}`);
  // A name that starts with `-` would read as an option.
  const arg = (f) => (f.startsWith('-') ? `./${f}` : f);
  log(`lede ${version}: ${files.length} file${files.length === 1 ? '' : 's'}`);
  if (check) {
    if (run(cli, ['check', ...(artifact ? ['--artifact'] : []), ...files.map(arg)], root) !== 0) throw new Error('lede check failed');
  }
  const built = [];
  for (const f of files) {
    const dest = outputFor(outDir, f);
    mkdirSync(dirname(dest), { recursive: true });
    if (run(cli, ['build', arg(f), '-o', dest, ...(artifact ? ['--artifact'] : [])], root) !== 0)
      throw new Error(`lede build failed for ${f}`);
    built.push(relative(root, dest).split(sep).join('/'));
  }
  const result = { files: built, outDir: relative(root, outDir).split(sep).join('/') };
  if (env.GITHUB_OUTPUT) {
    const d = `lede_${randomBytes(8).toString('hex')}`;
    appendFileSync(env.GITHUB_OUTPUT, `files<<${d}\n${built.join('\n')}\n${d}\nout-dir=${result.outDir}\n`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = main(process.env);
    console.log(`built ${r.files.length} file${r.files.length === 1 ? '' : 's'} into ${r.outDir}`);
  } catch (e) {
    console.log(`::error::${String(e instanceof Error ? e.message : e).replace(/[\r\n%]/g, ' ')}`);
    process.exitCode = 1;
  }
}
