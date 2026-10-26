#!/usr/bin/env node
// lede build | watch | check | ast
import { readFileSync, writeFileSync, watch as fsWatch, existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, basename, sep } from 'node:path';
import { parse, fix, type Diagnostic, type LedeDocument } from '@lede-lang/core';
import { render } from '@lede-lang/html';

const USAGE = `usage:
  lede build <file.lede> [-o out.html] [--force] [--unsafe-html] [--allow-remote]
  lede watch <file.lede> [-o out.html]
  lede check <file.lede>... [--json] [--fix [--dry-run]]
  lede ast   <file.lede>
  lede help`;

const HELP = `${USAGE}

commands:
  build   compile a page to one self-contained HTML file (stdout without -o); refuses on errors
  watch   rebuild next to the source on every save
  check   print file:line:col diagnostics; exit 1 if any is an error, 2 on a usage error
  ast     print the parsed document as JSON

options:
  -o FILE         build/watch: write the HTML here
  --force         build: write the page even if it has errors
  --unsafe-html   build: keep raw \`html\` blocks unsanitized (local files only)
  --allow-remote  build: load remote images (links never need it)
  --json          check: print diagnostics as JSON, keyed by file; each has severity, code, message,
                  line, col and, for some codes, a machine-readable \`detail\` object
  --fix           check: rewrite the file to repair mechanical slips (unquoted , or ; in cells,
                  #### headings, column names, kpi bars, grid before ### sections; spec §9) and
                  print each repair; repairs that pick between readings are marked "a guess"
  --dry-run       check --fix: print the lines that would change and write nothing
  -h, --help      show this help`;

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

function load(file: string): { src: string; doc: LedeDocument } {
  const src = readFileSync(file, 'utf8');
  return { src, doc: parse(src, parseOptions(file)) };
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

async function build(file: string, out: string | null, flags: Set<string>): Promise<boolean> {
  const { src, doc } = load(file);
  report(file, src, doc.diagnostics);
  const errors = doc.diagnostics.filter((d) => d.severity === 'error').length;
  if (errors && !flags.has('--force')) {
    process.stderr.write(`${file}: ${errors} error(s); not written (use --force to render anyway)\n`);
    return false;
  }
  const html = await render(doc, { unsafeHtml: flags.has('--unsafe-html'), allowRemote: flags.has('--allow-remote') });
  if (out) writeFileSync(out, html);
  else process.stdout.write(html);
  if (out)
    process.stderr.write(
      `${file} → ${out} (${(Buffer.byteLength(src) / 1024).toFixed(1)} KB → ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)\n`,
    );
  return true;
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const [cmd, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const oi = rest.indexOf('-o');
  const out = oi >= 0 ? rest[oi + 1] : null;
  const files = rest.filter((a, i) => !a.startsWith('-') && !(oi >= 0 && i === oi + 1));
  if (!cmd || !files.length || !['build', 'watch', 'check', 'ast'].includes(cmd)) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  for (const f of files)
    if (!existsSync(f)) {
      process.stderr.write(`lede: no such file ${f}\n`);
      return 2;
    }
  switch (cmd) {
    case 'build':
      return (await build(files[0], out, flags)) ? 0 : 1;
    case 'check': {
      let bad = 0;
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
        const { src, doc } = load(f);
        all[f] = doc.diagnostics;
        if (!flags.has('--json')) report(f, src, doc.diagnostics);
        bad += doc.diagnostics.filter((d) => d.severity === 'error').length;
      }
      if (flags.has('--json')) process.stdout.write(`${JSON.stringify(all, null, 2)}\n`);
      else process.stderr.write(bad ? `${bad} error(s)\n` : 'ok\n');
      return bad ? 1 : 0;
    }
    case 'ast':
      process.stdout.write(`${JSON.stringify(load(files[0]).doc, null, 2)}\n`);
      return 0;
    case 'watch': {
      const target = out ?? resolve(dirname(files[0]), `${basename(files[0], '.lede')}.html`);
      await build(files[0], target, new Set([...flags, '--force']));
      let timer: NodeJS.Timeout | null = null;
      fsWatch(files[0], () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void build(files[0], target, new Set([...flags, '--force'])), 60);
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
  process.stderr.write(`lede: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exitCode = 70;
}
