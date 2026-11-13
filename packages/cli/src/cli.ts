#!/usr/bin/env node
// lede build | watch | check | ast
import { readFileSync, writeFileSync, watch as fsWatch, existsSync, realpathSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { text as readAll } from 'node:stream/consumers';
import {
  parse,
  fix,
  artifactDiagnostics,
  externalDiagnostics,
  redactExternal,
  findingSecrets,
  maskSecrets,
  scanExternal,
  parseTheme,
  ThemeFileError,
  THEME_MAX_BYTES,
  type Diagnostic,
  type ExternalFinding,
  type ExternalOptions,
  type LedeDocument,
  type ThemeTokens,
} from '@lede-lang/core';
import { confine, unreadable } from './confine.ts';
import { DEFAULT_IMAGE_MAX, inlineImages } from './images.ts';

const USAGE = `usage:
  lede build <file.lede> [-o out.html] [--force] [--unsafe-html] [--allow-remote] [--artifact] [--shell] [--image-max=SIZE] [--link-images]
                         [--theme tokens.json [--theme-strict]]
  lede watch <file.lede> [-o out.html] [--image-max=SIZE] [--link-images] [--theme tokens.json [--theme-strict]]
  lede check <file.lede>... [--json] [--fix [--dry-run]] [--artifact] [--image-max=SIZE] [--link-images] [--external [--allow=HOST,...]]
                         [--theme tokens.json [--theme-strict]]
  lede ast   <file.lede>
  lede help
  lede version`;

const HELP = `${USAGE}

commands:
  build   compile a page to one self-contained HTML file (stdout without -o); refuses on errors. A local image is written into the
          page as a data: URI, so the page is one file (see --image-max and --link-images)
  watch   rebuild next to the source on every save; it keeps going when an editor replaces the file or it is deleted for a while
  check   print file:line:col diagnostics, then a last line: ok if there were none, else the
          counts (a warning is not ok); exit 1 if any is an error (or, with --external, a finding), 2 on a usage error
  ast     print the parsed document as JSON
  version print the version of this package (also --version, -V)

A file may be - to read the document from stdin (build, check and ast; not with watch, --fix or --dry-run). Diagnostics call
it <stdin>, and \`data x < file.csv\` loads resolve against the current directory, confined to it like a file's.

options:
  -o FILE         build/watch: write the HTML here (-o=FILE does too), never over an input file
  --force         build: write the page even if it has errors
  --unsafe-html   build: keep raw \`html\` blocks unsanitized (local files only)
  --allow-remote  build: load remote images (links never need it)
  --image-max=SIZE  build/watch/check: the largest local image to inline as a data: URI, such as 300k or 2m (default 512k); the page's
                  images may total eight times that. An image over a limit, missing, outside the document's directory or not a PNG,
                  JPEG, GIF, WebP, AVIF or SVG file keeps its path, with W image-inline. Remote images are never fetched
  --link-images   build/watch/check: leave local image paths as written (no inlining, no image-inline warnings)
  --theme FILE    build/watch/check: brand tokens, a JSON file (at most 64 KiB) of hex colours: {"accent", "light": {...}, "dark": {...},
                  "series"}. Its palette and chart colours replace the house ones in both themes, and the page's own @accent is ignored
                  (W theme-override). Every colour that is text must read on its surfaces, 7:1 for fg and 4.5:1 for the other text tokens
                  and the house good, warn and bad,
                  3:1 for series on the page and card: one that does not is moved in lightness only, hue and chroma kept, to the nearest
                  value that does (W theme-adjusted; E theme-surface if no lightness can). A value that is not a hex colour is
                  E theme-value. The file is named by you and is not confined to the document's directory. Spec section 9
  --theme-strict  build/watch/check: with --theme, a colour that would be moved is an error (E theme-adjusted) instead of a warning
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
  --external      check: also report what the page gives away, as W external with detail {kind, text}: URLs, IP addresses, host names,
                  account ids, keys and email addresses, wherever they sit (prose, meta, fences, data, diagrams); exit 1 if there is any,
                  so it can gate a publish. The documentation names (example.com, 192.0.2.0/24, 2001:db8::/32) are never reported.
                  With --fix each is replaced by <url>, <ip>, <host>, <account>, <key> or <email> and printed as a repair (--dry-run
                  previews); where that would break the page, by host-1, ip-1 and so on, and where nothing can stand in, it is left and
                  stays a finding. build never redacts
  --allow=HOSTS   check --external: host names and IP addresses to leave alone, comma-separated (the flag may repeat), with the URLs on them
  -h, --help      show this help
  -V, --version   print the version

An option no command knows is a usage error (exit 2); one that only another command takes is ignored. After -- every word
is a FILE, so a name may start with -. A failure that is not
a usage error exits 70 with one line on stderr; set LEDE_DEBUG to add the stack.`;

/** What a diagnostic calls `file`: `-` is the document on stdin, which has no name. */
const nameOf = (file: string): string => (file === '-' ? '<stdin>' : file);

/** The folder a document's local files (data and images) are read from, and confined to. Data files of a document on stdin load from where the command was run. */
const baseOf = (file: string): string => (file === '-' ? process.cwd() : dirname(resolve(file)));

function parseOptions(file: string) {
  const base = baseOf(file);
  return {
    loadFile: (p: string) => {
      if (/^[a-z]+:/i.test(p)) throw new Error('only local files can be loaded');
      const full = confine(base, p);
      try {
        if (statSync(full).size > 5 * 1024 * 1024) throw new Error(`${p} is larger than 5 MB`);
        return readFileSync(full, 'utf8');
      } catch (e) {
        throw (e as NodeJS.ErrnoException).code === undefined ? e : unreadable(p, e as NodeJS.ErrnoException);
      }
    },
  };
}

/** The `--theme` option: the tokens file the operator named, and whether a colour that would be moved is an error. */
interface ThemeFlag {
  path: string;
  strict: boolean;
}

/**
 * A tokens file read and validated: the flag it was read for, the theme the renderer takes, the file's text (for the report) and what
 * the validator said of it.
 */
interface LoadedTheme {
  flag: ThemeFlag;
  tokens: ThemeTokens;
  src: string;
  diagnostics: Diagnostic[];
}

/**
 * Read `--theme`'s file. The operator names it, so it is not confined to the document's tree; it is read as JSON and nothing else, from a
 * regular file, at most 64 KiB. Throws `ThemeFileError`, named for the option, for a file that cannot be used at all; every problem with
 * a value in it is a diagnostic (spec section 9).
 */
function loadTheme(flag: ThemeFlag): LoadedTheme {
  const fail = (why: string): never => {
    throw new ThemeFileError(`--theme ${flag.path}: ${why}`);
  };
  const stat = statSync(flag.path, { throwIfNoEntry: false });
  if (!stat) return fail('no such file');
  if (!stat.isFile()) return fail('not a regular file');
  let src: string;
  try {
    const fd = openSync(flag.path, 'r');
    try {
      const buf = Buffer.alloc(THEME_MAX_BYTES + 1);
      const n = readSync(fd, buf, 0, buf.length, 0);
      if (n > THEME_MAX_BYTES) return fail(`larger than ${THEME_MAX_BYTES / 1024} KiB`);
      src = buf.toString('utf8', 0, n);
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    if (e instanceof ThemeFileError) throw e;
    return fail(`cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'})`);
  }
  try {
    const { theme, diagnostics } = parseTheme(src, { strict: flag.strict });
    return { flag, tokens: theme, src, diagnostics };
  } catch (e) {
    if (e instanceof ThemeFileError) return fail(e.message);
    throw e;
  }
}

/** What `build`, `watch` and `check` read besides the document, from the command line. */
interface Inputs {
  /** The largest local image inlined as a data: URI, in bytes, or null (`--link-images`) to leave the paths. */
  images: number | null;
  /** `--theme`'s file, read once by `main` (a watch reads it again for each rebuild). */
  theme: LoadedTheme | null;
}

/**
 * Read and parse `file` (`-` is stdin). With `images` (bytes), each local image in the document becomes a data: URI and its
 * diagnostics hold W `image-inline` for the ones that could not; `encode: false` (check) types and sizes them without encoding them.
 * With `artifact`, its diagnostics also hold the warnings only an Artifact host needs, for the images that are still paths. With
 * `external`, what the page gives away, from one scan whose `findings` are returned too. With `themed`, a `--theme` file is in force:
 * the document's `@accent` is ignored, with W `theme-override`.
 */
async function load(
  file: string,
  opts: { artifact?: boolean; images?: number | null; encode?: boolean; external?: ExternalOptions | null; themed?: boolean } = {},
): Promise<{ src: string; doc: LedeDocument; findings: ExternalFinding[] }> {
  const src = file === '-' ? await readAll(process.stdin) : readFileSync(file, 'utf8');
  const doc = parse(src, { ...parseOptions(file), themed: !!opts.themed });
  if (opts.images != null) doc.diagnostics.push(...inlineImages(doc, baseOf(file), opts.images, opts.encode ?? true));
  if (opts.artifact) doc.diagnostics.push(...artifactDiagnostics(doc));
  const findings = opts.external ? scanExternal(src, opts.external) : [];
  if (opts.external) {
    doc.diagnostics.push(...externalDiagnostics(src, opts.external, findings));
    // Any diagnostic may quote the text a credential sits in (a meta URL, a data row): under --external none prints one whole.
    const secrets = findingSecrets(findings);
    if (secrets.length) doc.diagnostics = doc.diagnostics.map((d) => maskDiagnostic(d, secrets));
  }
  return { src, doc, findings };
}

/** `d` with `secrets` masked in its message and in every string of its detail, however deep. */
function maskDiagnostic(d: Diagnostic, secrets: readonly string[]): Diagnostic {
  const mask = (v: unknown): unknown => {
    if (typeof v === 'string') return maskSecrets(v, secrets);
    if (Array.isArray(v)) return v.map(mask);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x)]));
    return v;
  };
  const out: Diagnostic = { ...d, message: maskSecrets(d.message, secrets) };
  if (d.detail !== undefined) out.detail = mask(d.detail) as Record<string, unknown>;
  return out;
}

/**
 * Where each line of `src` that holds a credential starts holding it (line to column, both 1-based), from `findings`, the scan of
 * `src` for `--external`: a line echoed under a diagnostic, or as the old side of a `--dry-run` diff, is cut there, so a CI log never
 * holds a key whole. Every line inside a private key block is cut at its start.
 */
function keyCuts(src: string, findings: readonly ExternalFinding[]): Map<number, number> {
  const cuts = new Map<number, number>();
  for (const f of findings) {
    if (!f.secrets.length) continue;
    // A key a longer finding holds (a URL with `?key=`) cuts the line where the key starts, not where the URL does.
    const inside = f.kind === 'key' ? 0 : Math.min(...f.secrets.map((k) => f.text.indexOf(k)).filter((i) => i >= 0), f.text.length);
    const col = f.col + inside;
    cuts.set(f.line, Math.min(cuts.get(f.line) ?? col, col));
    if (f.kind !== 'key') continue;
    const extra = src.slice(f.start, f.end).split('\n').length - 1;
    for (let i = 1; i <= extra; i++) cuts.set(f.line + i, 1);
  }
  return cuts;
}

/** Line `n` (1-based) of `lines`, cut where `cuts` says a credential starts. */
const echo = (lines: string[], n: number, cuts: Map<number, number>): string | undefined => {
  const at = cuts.get(n);
  const l = lines[n - 1];
  return at === undefined || l === undefined ? l : `${l.slice(0, at - 1)}...`;
};

function report(file: string, src: string, diags: Diagnostic[], cuts: Map<number, number> = new Map()): void {
  const lines = src.split('\n');
  for (const d of diags) {
    const color = d.severity === 'error' ? '\x1b[31m' : '\x1b[33m';
    const tty = process.stderr.isTTY;
    process.stderr.write(`${file}:${d.line}:${d.col}: ${tty ? color : ''}${d.severity}${tty ? '\x1b[0m' : ''} [${d.code}] ${d.message}\n`);
    const l = echo(lines, d.line, cuts);
    if (l !== undefined) process.stderr.write(`  ${l}\n  ${' '.repeat(Math.max(0, d.col - 1))}^\n`);
  }
}

/** How many of `diags` are errors and how many warnings. */
function tally(diags: readonly Diagnostic[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const d of diags) {
    if (d.severity === 'error') errors++;
    else if (d.severity === 'warning') warnings++;
  }
  return { errors, warnings };
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

async function build(file: string, out: string | null, flags: Set<string>, inputs: Inputs, watching?: Watching): Promise<boolean> {
  const name = nameOf(file);
  const brand = inputs.theme;
  const { src, doc } = await load(file, { artifact: flags.has('--artifact'), images: inputs.images, themed: brand !== null });
  if (brand) report(brand.flag.path, brand.src, brand.diagnostics);
  report(name, src, doc.diagnostics);
  const errors = tally(doc.diagnostics).errors + (brand ? tally(brand.diagnostics).errors : 0);
  if (errors && !flags.has('--force')) {
    process.stderr.write(`${name}: ${errors} error(s); not written (use --force to render anyway)\n`);
    return false;
  }
  // The renderer pulls in elkjs and sanitize-html, about 170 ms that `check`, `ast` and `--help` never need, so it loads only here.
  const { render, wantsShell } = await import('@lede-lang/html');
  const shell = flags.has('--shell');
  const html = await render(doc, {
    unsafeHtml: flags.has('--unsafe-html'),
    allowRemote: flags.has('--allow-remote'),
    artifact: flags.has('--artifact'),
    shell,
    ...(brand ? { theme: brand.tokens } : {}),
  });
  const idle = shell && !wantsShell(doc);
  if (idle && !watching?.shellIdle)
    process.stderr.write(
      `${name}: --shell had no effect: the page needs a field (ask, choose, confirm, param, toggle, bucket or template) and an export line\n`,
    );
  if (watching) watching.shellIdle = idle;
  if (out) writeFileSync(out, html);
  else process.stdout.write(html);
  if (out)
    process.stderr.write(
      `${name} → ${out} (${(Buffer.byteLength(src) / 1024).toFixed(1)} KB → ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)\n`,
    );
  return true;
}

/** Where `watch` writes: OUT, or `NAME.html` beside `NAME.lede`. */
const watchTarget = (file: string, out: string | null): string => out ?? resolve(dirname(file), `${basename(file, '.lede')}.html`);

/**
 * `lede watch`: build once, then rebuild after every change to FILE until stopped. It watches the directory and picks FILE's events
 * by name: an editor that saves by writing a temp file and renaming it over the original leaves a watcher on the file itself holding
 * the old inode, which never fires again, and deleting the file would end it.
 */
async function watchFile(file: string, target: string, flags: Set<string>, inputs: Inputs): Promise<number> {
  const watched = new Set([...flags, '--force']);
  const watching: Watching = { shellIdle: false };
  // The first build is not guarded: an unreadable FILE or an unwritable OUT stops the command (exit 70), not a loop of the same line.
  await build(file, target, watched, inputs, watching);
  let gone = false;
  /**
   * One rebuild, which never throws: a missing or unreadable FILE is a line on stderr, and the next change tries again. The tokens
   * file is read again too, so a watch picks up a new one with the next save of the document.
   */
  const rebuild = async (): Promise<void> => {
    try {
      const theme = inputs.theme && loadTheme(inputs.theme.flag);
      await build(file, target, watched, { ...inputs, theme }, watching);
      gone = false;
      return;
    } catch (e) {
      // A file that is there and cannot be built is an error; one that is not there (deleted, or mid-rename in a save) is gone.
      if (existsSync(file)) {
        gone = false;
        process.stderr.write(failure(e));
        return;
      }
    }
    if (!gone) process.stderr.write(`lede: ${file} is gone; waiting for it to come back\n`);
    gone = true;
  };
  // One rebuild at a time: a change that lands during a build asks for one more after it, so the last save always wins.
  let busy = false;
  let again = false;
  const cycle = async (): Promise<void> => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      await rebuild();
    } finally {
      busy = false;
    }
    if (again) {
      again = false;
      await cycle();
    }
  };
  // Follow a symlinked FILE to the file that is edited; the page is still read through FILE.
  const real = realpathSync(file);
  // Names are compared as a file system that ignores case and normalization would: FILE typed `readme.lede` may be `README.lede`
  // on disk, and the event carries the name on disk. A neighbour that differs only so costs one rebuild.
  const key = (n: string) => n.normalize('NFC').toLowerCase();
  const name = key(basename(real));
  // Some platforms give no name. Any change in the folder may then be FILE's, and so may the page this command just wrote there,
  // so such an event counts only when FILE itself has changed since the last one that did.
  const stamp = (): string => {
    const s = statSync(file, { throwIfNoEntry: false });
    return s ? `${s.mtimeMs}:${s.size}` : '';
  };
  let seen = stamp();
  let timer: NodeJS.Timeout | null = null;
  const watcher = fsWatch(dirname(real), (_event, changed) => {
    if (changed !== null) {
      if (key(changed) !== name) return;
    } else {
      const now = stamp();
      if (now === seen) return;
      seen = now;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void cycle(), 60);
  });
  process.stderr.write(`watching ${file} → ${target}\n`);
  return await new Promise<number>((done) => {
    watcher.on('error', (e) => {
      process.stderr.write(failure(e));
      done(70);
    });
  });
}

/**
 * `lede check`: print every diagnostic (or the JSON), repair first under --fix, and exit 1 if any is an error. With `--external`, what
 * the page gives away is reported too, as warnings, and any of it is also exit 1; under --fix it is replaced after the other repairs.
 */
async function check(files: string[], flags: Set<string>, inputs: Inputs, allow: string[]): Promise<number> {
  const brand = inputs.theme;
  const external: ExternalOptions | null = flags.has('--external') ? { allow } : null;
  let bad = 0;
  let warned = 0;
  let leaks = 0;
  const all: Record<string, Diagnostic[]> = {};
  const count = (diags: readonly Diagnostic[]): void => {
    const t = tally(diags);
    bad += t.errors;
    warned += t.warnings;
  };
  // The tokens file is checked once, ahead of the documents, and reported under its own name.
  if (brand) {
    all[brand.flag.path] = brand.diagnostics;
    if (!flags.has('--json')) report(brand.flag.path, brand.src, brand.diagnostics);
    count(brand.diagnostics);
  }
  for (const f of files) {
    const dry = flags.has('--dry-run');
    // Under --fix a file is rewritten in place; stdin was refused before we got here, so `f` is a real path.
    if (flags.has('--fix') || dry) {
      const before = readFileSync(f, 'utf8');
      const r = fix(before, parseOptions(f));
      const verb = dry ? 'would fix' : 'fixed';
      const found = external ? scanExternal(before, external) : [];
      const secrets = findingSecrets(found);
      for (const a of r.applied)
        process.stderr.write(
          `${f}:${a.line}: ${verb} [${a.code}] ${maskSecrets(a.note, secrets)}${a.guess ? ' (a guess: check it)' : ''}\n`,
        );
      let after = r.src;
      if (external) {
        const e = redactExternal(r.src, external, parseOptions(f));
        for (const a of e.applied) process.stderr.write(`${f}:${a.line}: ${verb} [external] ${a.note}\n`);
        // A finding no placeholder can stand in for without breaking the page stays, and is reported again below.
        for (const s of e.skipped)
          process.stderr.write(
            `${f}:${s.line}: not fixed [external] ${s.kind} left as written: a placeholder there would break the page\n`,
          );
        after = e.src;
      }
      if (dry) {
        // Neither kind of repair changes the line count, so a line-by-line comparison is the whole diff.
        const was = before.split('\n');
        const cuts = keyCuts(before, found);
        after.split('\n').forEach((line, i) => {
          if (line !== was[i]) process.stderr.write(`${f}:${i + 1}:\n- ${echo(was, i + 1, cuts)}\n+ ${line}\n`);
        });
      } else if (after !== before) writeFileSync(f, after);
    }
    // Files are reported one after the other, in the order given, and stdin can be read only once.
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose
    const { src, doc, findings } = await load(f, {
      artifact: flags.has('--artifact'),
      images: inputs.images,
      encode: false,
      external,
      themed: brand !== null,
    });
    all[nameOf(f)] = doc.diagnostics;
    if (!flags.has('--json')) report(nameOf(f), src, doc.diagnostics, keyCuts(src, findings));
    count(doc.diagnostics);
    leaks += findings.length;
  }
  if (flags.has('--json')) process.stdout.write(`${JSON.stringify(all, null, 2)}\n`);
  else process.stderr.write(`${summary(bad, warned)}\n`);
  return bad || leaks ? 1 : 0;
}

const COMMANDS = ['build', 'watch', 'check', 'ast'] as const;
type Command = (typeof COMMANDS)[number];

/** Every flag some command takes. A flag no command knows is a usage error; one only another command knows is ignored (spec section 9). */
const FLAGS = [
  '--force',
  '--unsafe-html',
  '--allow-remote',
  '--artifact',
  '--shell',
  '--json',
  '--fix',
  '--dry-run',
  '--link-images',
  '--external',
  '--theme-strict',
];
/** The options that take a value, as `NAME VALUE` or `NAME=VALUE` (`--allow` only as `--allow=VALUE`). */
const VALUE_OPTIONS = new Set(['-o', '--image-max', '--allow', '--theme']);
/** What a misspelled option is compared with: the flags, plus the options that take a value and the ones `main` handles before it parses. */
const KNOWN_OPTIONS = [...FLAGS, '--allow', '--help', '--version', '-o', '--image-max', '--theme', '-h', '-V'];

interface Args {
  cmd: Command;
  files: string[];
  out: string | null;
  /** `--image-max` in bytes, or null when it was not given. */
  imageMax: number | null;
  /** `--theme`'s file, or null when it was not given. */
  theme: string | null;
  flags: Set<string>;
  /** The names of `--allow=`, all of them. */
  allow: string[];
}

/** A size such as `300k`, `2m` or `524288` (k and m are 1024 and 1024 squared; a trailing b is allowed) in bytes, or null if it is not one or is zero. */
function parseSize(text: string): number | null {
  const m = /^(\d{1,9})([km]?)b?$/i.exec(text);
  const bytes = m ? Number(m[1]) * (m[2] === '' ? 1 : 1024 ** (m[2].toLowerCase() === 'k' ? 1 : 2)) : 0;
  return bytes > 0 ? bytes : null;
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

/** Split the command line into the command, its files, `-o`, `--allow=` and its flags, or say what is wrong with it. */
function parseArgs(argv: string[]): Args | UsageError {
  const [cmd, ...rest] = argv;
  if (!cmd) return { usage: null };
  if (cmd.startsWith('-'))
    return {
      usage: KNOWN_OPTIONS.includes(cmd.split('=')[0]) ? `${cmd} goes after the command: lede <command> FILE ${cmd}` : unknownOption(cmd),
    };
  if (!(COMMANDS as readonly string[]).includes(cmd)) return { usage: `unknown command ${cmd}` };
  const flags = new Set<string>();
  const files: string[] = [];
  const allow: string[] = [];
  let out: string | null = null;
  let imageMax: number | null = null;
  let theme: string | null = null;
  let options = true; // until `--`, after which every word is a FILE
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const name = a.split('=', 1)[0];
    if (!options) files.push(a);
    else if (a === '--') options = false;
    else if (VALUE_OPTIONS.has(name)) {
      // `NAME VALUE` takes the next word (`spaced`), `NAME=VALUE` the rest of this one.
      const spaced = a === name;
      const value = spaced ? rest[++i] : a.slice(name.length + 1);
      // For -o and --theme a spaced value that is itself an option is a forgotten value, not a file called --force;
      // -o=--force says it on purpose.
      const file = !!value && !(spaced && value.startsWith('-'));
      if (name === '-o') {
        if (!file) return { usage: '-o needs a file name' };
        if (out !== null) return { usage: '-o given more than once' };
        out = value;
      } else if (name === '--theme') {
        if (!file) return { usage: '--theme needs a tokens file' };
        if (theme !== null) return { usage: '--theme given more than once' };
        theme = value;
      } else if (name === '--image-max') {
        const bytes = parseSize(value ?? '');
        if (bytes === null) return { usage: '--image-max needs a size such as 300k or 2m' };
        imageMax = bytes;
      } else {
        // --allow takes only the `=` form.
        const names = (spaced ? '' : value)
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean);
        if (!names.length) return { usage: '--allow needs host names: --allow=host1,host2' };
        allow.push(...names);
      }
    } else if (FLAGS.includes(a)) flags.add(a);
    else if (a !== '-' && a.startsWith('-')) return { usage: unknownOption(a) };
    else files.push(a);
  }
  if (!files.length) return { usage: 'no file given' };
  if (flags.has('--theme-strict') && theme === null && cmd !== 'ast') return { usage: '--theme-strict needs --theme FILE' };
  const stdin = files.filter((f) => f === '-').length;
  if (stdin > 1) return { usage: '- (stdin) can be given only once' };
  if (stdin && cmd === 'watch') return { usage: 'watch needs a file, not - (stdin)' };
  if (stdin && (flags.has('--fix') || flags.has('--dry-run')))
    return { usage: '--fix and --dry-run rewrite the file, and a document read from - (stdin) has none' };
  // Silence would read as a clean page: a list of names that nothing checks is a mistake, not an ignored flag.
  if (cmd === 'check' && allow.length && !flags.has('--external')) return { usage: '--allow only means something with --external' };
  return { cmd: cmd as Command, files, out, imageMax, theme, flags, allow };
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

/** The CLI package's own version, read when asked: the release workflow rewrites it, and `../package.json` is that file from src/ and from dist/. */
function version(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (argv.includes('--version') || argv.includes('-V') || argv[0] === 'version') {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  const parsed = parseArgs(argv);
  if ('usage' in parsed) {
    process.stderr.write(`${parsed.usage === null ? '' : `lede: ${parsed.usage}\n`}${USAGE}\n`);
    return 2;
  }
  const { cmd, files, out, imageMax, theme, flags, allow } = parsed;
  if ((cmd === 'build' || cmd === 'watch') && flags.has('--shell') && flags.has('--unsafe-html')) {
    process.stderr.write('lede: --shell cannot be combined with --unsafe-html: raw html could plant its own controls and data block\n');
    return 2;
  }
  for (const f of files) {
    if (f === '-') continue;
    if (!existsSync(f)) {
      process.stderr.write(`lede: no such file ${f}\n`);
      return 2;
    }
    if (statSync(f).isDirectory()) {
      process.stderr.write(`lede: ${f} is a directory\n`);
      return 2;
    }
  }
  // `ast` prints the parse and takes no theme. For the others the file is read here, once, so that one that cannot be used is a usage
  // error before anything is built (a watch reads it again for every rebuild).
  let brand: LoadedTheme | null = null;
  if (cmd !== 'ast' && theme !== null) {
    try {
      brand = loadTheme({ path: theme, strict: flags.has('--theme-strict') });
    } catch (e) {
      if (!(e instanceof ThemeFileError)) throw e;
      process.stderr.write(`lede: ${e.message}\n`);
      return 2;
    }
  }
  const inputs: Inputs = { images: flags.has('--link-images') ? null : (imageMax ?? DEFAULT_IMAGE_MAX), theme: brand };
  // The page goes to OUT, so OUT must not be the document: `build ok.lede -o ok.lede` would turn the source into HTML.
  const watched = cmd === 'watch' ? watchTarget(files[0], out) : null;
  const target = watched ?? (cmd === 'build' ? out : null);
  const clash = target === null ? undefined : files.find((f) => f !== '-' && sameFile(f, target));
  if (clash !== undefined) {
    process.stderr.write(`lede: ${target} is the same file as ${clash}; not overwriting the source\n`);
    return 2;
  }
  switch (cmd) {
    case 'build':
      return (await build(files[0], out, flags, inputs)) ? 0 : 1;
    case 'check':
      return await check(files, flags, inputs, allow);
    case 'ast':
      process.stdout.write(`${JSON.stringify((await load(files[0])).doc, null, 2)}\n`);
      return 0;
    case 'watch':
      return watched === null ? 2 : await watchFile(files[0], watched, flags, inputs);
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
