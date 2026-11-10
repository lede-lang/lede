#!/usr/bin/env node
// lede build | watch | check | ast
import { readFileSync, writeFileSync, watch as fsWatch, existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, basename, sep } from 'node:path';
import { parse, fix, artifactDiagnostics, type Diagnostic, type LedeDocument } from '@lede-lang/core';
import { render, wantsShell } from '@lede-lang/html';

const USAGE = `usage:
  lede build <file.lede> [-o out.html] [--force] [--unsafe-html] [--allow-remote] [--artifact] [--shell]
  lede watch <file.lede> [-o out.html]
  lede check <file.lede>... [--json] [--fix [--dry-run]] [--artifact]
  lede ast   <file.lede>
  lede help`;

const HELP = `${USAGE}

commands:
  build   compile a page to one self-contained HTML file (stdout without -o); refuses on errors
  watch   rebuild next to the source on every save
  check   print file:line:col diagnostics, then a last line: ok if there were none, else the
          counts (a warning is not ok); exit 1 if any is an error, 2 on a usage error
  ast     print the parsed document as JSON

options:
  -o FILE         build/watch: write the HTML here (-o=FILE does too), never over an input file
  --force         build: write the page even if it has errors
  --unsafe-html   build: keep raw \`html\` blocks unsanitized (local files only)
  --allow-remote  build: load remote images (links never need it)
  --artifact      build: write only <title>, <style> and <main>, for the Claude Artifact tool, which wraps them in its own page;
                  check/build: also warn about an image path the host cannot serve (W artifact-image)
  --shell         build/watch: add the interaction shell to a page with a field (ask, choose, confirm, param, toggle, bucket or template)
                  and an export line (export json, markdown or prompt): one fixed script, pinned by hash in the page's policy, that
                  keeps the answers and copies them out. Not with --unsafe-html. A page that cannot take it gets a note on stderr
                  (in watch, once, not on every save)
  --json          check: print diagnostics as JSON, keyed by file; each has severity, code, message,
                  line, col and, for some codes, a machine-readable \`detail\` object
  --fix           check: rewrite the file to repair mechanical slips (unquoted , or ; in cells,
                  #### headings, column names, kpi bars, grid before ### sections; spec §9) and
                  print each repair; repairs that pick between readings are marked "a guess"
  --dry-run       check --fix: print the lines that would change and write nothing
  -h, --help      show this help

An option no command knows is a usage error (exit 2); one that only another command takes is ignored. A failure that is not
a usage error exits 70 with one line on stderr; set LEDE_DEBUG to add the stack.`;

function parseOptions(file: string) {
  const base = dirname(resolve(file));
  return {
    loadFile: (p: string) => {
      if (/^[a-z]+:/i.test(p)) throw new Error('only local files can be loaded');
      // Confine data files to the document's own directory tree: a document must not be
      // able to read ~/.ssh or ../../secrets just because someone compiled it.
      // Resolve symlinks on both sides before comparing, or a link inside the folder escapes it.
      const root = realpathSync(base);
      const full = realpathSync(resolve(base, p));
      if (full !== root && !full.startsWith(root + sep)) throw new Error(`${p} is outside the document's directory`);
      if (statSync(full).size > 5 * 1024 * 1024) throw new Error(`${p} is larger than 5 MB`);
      return readFileSync(full, 'utf8');
    },
  };
}

/** Read and parse `file`. With `artifact`, its diagnostics also hold the warnings only an Artifact host needs. */
function load(file: string, artifact = false): { src: string; doc: LedeDocument } {
  const src = readFileSync(file, 'utf8');
  const doc = parse(src, parseOptions(file));
  if (artifact) doc.diagnostics.push(...artifactDiagnostics(doc));
  return { src, doc };
}

function report(file: string, src: string, diags: Diagnostic[]): void {
  const lines = src.split('\n');
  for (const d of diags) {
    const color = d.severity === 'error' ? '\x1b[31m' : '\x1b[33m';
    const tty = process.stderr.isTTY;
    process.stderr.write(`${file}:${d.line}:${d.col}: ${tty ? color : ''}${d.severity}${tty ? '\x1b[0m' : ''} [${d.code}] ${d.message}\n`);
    const l = lines[d.line - 1];
    if (l !== undefined) process.stderr.write(`  ${l}\n  ${' '.repeat(Math.max(0, d.col - 1))}^\n`);
  }
}

/** The last line of `check`: `ok` only when nothing was reported, so a warning is never followed by a success word. */
function summary(errors: number, warnings: number): string {
  const counts = [errors && `${errors} error(s)`, warnings && `${warnings} warning(s)`].filter(Boolean);
  return counts.length ? counts.join(', ') : 'ok';
}

/** What `watch` remembers between rebuilds: whether the last one said `--shell` had no effect, so the next says it only when that starts to hold. */
interface Watching {
  shellIdle: boolean;
}

async function build(file: string, out: string | null, flags: Set<string>, watching?: Watching): Promise<boolean> {
  const { src, doc } = load(file, flags.has('--artifact'));
  report(file, src, doc.diagnostics);
  const errors = doc.diagnostics.filter((d) => d.severity === 'error').length;
  if (errors && !flags.has('--force')) {
    process.stderr.write(`${file}: ${errors} error(s); not written (use --force to render anyway)\n`);
    return false;
  }
  const shell = flags.has('--shell');
  const html = await render(doc, {
    unsafeHtml: flags.has('--unsafe-html'),
    allowRemote: flags.has('--allow-remote'),
    artifact: flags.has('--artifact'),
    shell,
  });
  const idle = shell && !wantsShell(doc);
  if (idle && !watching?.shellIdle)
    process.stderr.write(
      `${file}: --shell had no effect: the page needs a field (ask, choose, confirm, param, toggle, bucket or template) and an export line\n`,
    );
  if (watching) watching.shellIdle = idle;
  if (out) writeFileSync(out, html);
  else process.stdout.write(html);
  if (out)
    process.stderr.write(
      `${file} → ${out} (${(Buffer.byteLength(src) / 1024).toFixed(1)} KB → ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)\n`,
    );
  return true;
}

/** `lede check`: print every diagnostic (or the JSON), repair first under --fix, and exit 1 if any is an error. */
function check(files: string[], flags: Set<string>): number {
  let bad = 0;
  let warned = 0;
  const all: Record<string, Diagnostic[]> = {};
  for (const f of files) {
    const dry = flags.has('--dry-run');
    if (flags.has('--fix') || dry) {
      const before = readFileSync(f, 'utf8');
      const r = fix(before, parseOptions(f));
      const verb = dry ? 'would fix' : 'fixed';
      for (const a of r.applied)
        process.stderr.write(`${f}:${a.line}: ${verb} [${a.code}] ${a.note}${a.guess ? ' (a guess: check it)' : ''}\n`);
      if (dry) {
        // Fixes never change the line count, so a line-by-line comparison is the whole diff.
        const was = before.split('\n');
        r.src.split('\n').forEach((line, i) => {
          if (line !== was[i]) process.stderr.write(`${f}:${i + 1}:\n- ${was[i]}\n+ ${line}\n`);
        });
      } else if (r.src !== before) writeFileSync(f, r.src);
    }
    const { src, doc } = load(f, flags.has('--artifact'));
    all[f] = doc.diagnostics;
    if (!flags.has('--json')) report(f, src, doc.diagnostics);
    bad += doc.diagnostics.filter((d) => d.severity === 'error').length;
    warned += doc.diagnostics.filter((d) => d.severity === 'warning').length;
  }
  if (flags.has('--json')) process.stdout.write(`${JSON.stringify(all, null, 2)}\n`);
  else process.stderr.write(`${summary(bad, warned)}\n`);
  return bad ? 1 : 0;
}

const COMMANDS = ['build', 'watch', 'check', 'ast'] as const;
type Command = (typeof COMMANDS)[number];

/** Every flag some command takes. A flag no command knows is a usage error; one only another command knows is ignored (spec section 9). */
const FLAGS = ['--force', '--unsafe-html', '--allow-remote', '--artifact', '--shell', '--json', '--fix', '--dry-run'];
/** What a misspelled option is compared with: the flags, plus the options `main` handles before it parses. */
const KNOWN_OPTIONS = [...FLAGS, '--help', '-o', '-h'];

interface Args {
  cmd: Command;
  files: string[];
  out: string | null;
  flags: Set<string>;
}

/** The usage error is its message, or null when the usage alone says it (no command at all). */
interface UsageError {
  usage: string | null;
}

/** Edit distance (insert, delete, replace), for the "did you mean" in an unknown option. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

function unknownOption(arg: string): string {
  // A one-letter option such as -x is within two edits of -o and -h, which would be a guess about nothing.
  const near = arg.length > 2 ? KNOWN_OPTIONS.map((f) => ({ f, d: distance(arg, f) })).filter((c) => c.d <= 2) : [];
  near.sort((a, b) => a.d - b.d);
  return `unknown option ${arg}${near.length ? `; did you mean ${near[0].f}?` : ''}`;
}

/** Split the command line into the command, its files, `-o` and its flags, or say what is wrong with it. */
function parseArgs(argv: string[]): Args | UsageError {
  const [cmd, ...rest] = argv;
  if (!cmd) return { usage: null };
  if (cmd.startsWith('-')) return { usage: unknownOption(cmd) };
  if (!(COMMANDS as readonly string[]).includes(cmd)) return { usage: `unknown command ${cmd}` };
  const flags = new Set<string>();
  const files: string[] = [];
  let out: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-o' || a.startsWith('-o=')) {
      // A value that is itself an option is a forgotten value, not a file called --force; -o=--force says it on purpose.
      const value = a === '-o' ? rest[++i] : a.slice(3);
      if (!value || (a === '-o' && value.startsWith('-'))) return { usage: '-o needs a file name' };
      if (out !== null) return { usage: '-o given more than once' };
      out = value;
    } else if (FLAGS.includes(a)) flags.add(a);
    else if (a.startsWith('-')) return { usage: unknownOption(a) };
    else files.push(a);
  }
  if (!files.length) return { usage: 'no file given' };
  return { cmd: cmd as Command, files, out, flags };
}

/** True when both paths are one existing file, whatever the names: a symlink or a hard link to it counts, and a path not yet written does not. */
function sameFile(a: string, b: string): boolean {
  try {
    const x = statSync(a, { bigint: true });
    const y = statSync(b, { bigint: true });
    // Some file systems report inode 0 for everything; that says nothing.
    return x.ino !== 0n && x.ino === y.ino && x.dev === y.dev;
  } catch {
    return false;
  }
}

/** The line a failure prints: its message, and the stack only for someone who set LEDE_DEBUG. */
function failure(e: unknown): string {
  const text = e instanceof Error ? ((process.env.LEDE_DEBUG ? e.stack : undefined) ?? e.message) : String(e);
  return `lede: ${text}\n`;
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const parsed = parseArgs(argv);
  if ('usage' in parsed) {
    process.stderr.write(`${parsed.usage === null ? '' : `lede: ${parsed.usage}\n`}${USAGE}\n`);
    return 2;
  }
  const { cmd, files, out, flags } = parsed;
  if ((cmd === 'build' || cmd === 'watch') && flags.has('--shell') && flags.has('--unsafe-html')) {
    process.stderr.write('lede: --shell cannot be combined with --unsafe-html: raw html could plant its own controls and data block\n');
    return 2;
  }
  for (const f of files) {
    if (!existsSync(f)) {
      process.stderr.write(`lede: no such file ${f}\n`);
      return 2;
    }
    if (statSync(f).isDirectory()) {
      process.stderr.write(`lede: ${f} is a directory\n`);
      return 2;
    }
  }
  // The page goes to OUT, so OUT must not be the document: `build ok.lede -o ok.lede` would turn the source into HTML.
  const target = cmd === 'watch' ? (out ?? resolve(dirname(files[0]), `${basename(files[0], '.lede')}.html`)) : out;
  const clash = cmd === 'build' || cmd === 'watch' ? files.find((f) => target !== null && sameFile(f, target)) : undefined;
  if (clash !== undefined) {
    process.stderr.write(`lede: ${target} is the same file as ${clash}; not overwriting the source\n`);
    return 2;
  }
  switch (cmd) {
    case 'build':
      return (await build(files[0], out, flags)) ? 0 : 1;
    case 'check':
      return check(files, flags);
    case 'ast':
      process.stdout.write(`${JSON.stringify(load(files[0]).doc, null, 2)}\n`);
      return 0;
    case 'watch': {
      const watching: Watching = { shellIdle: false };
      await build(files[0], target, new Set([...flags, '--force']), watching);
      let timer: NodeJS.Timeout | null = null;
      fsWatch(files[0], () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void build(files[0], target, new Set([...flags, '--force']), watching), 60);
      });
      process.stderr.write(`watching ${files[0]} → ${target}\n`);
      return await new Promise<number>(() => {});
    }
  }
  return 2;
}

// exitCode, not exit(): exit() ends the process before a piped stdout drains, and macOS pipes hold only 64 KiB.
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(failure(e));
  process.exitCode = 70;
}
