// Build the shipped examples into a static site for GitHub Pages (.github/workflows/pages.yml).
//   node scripts/build-pages.ts [out-dir]     default _site
// Each example keeps its path under examples/ (examples/parity/bars.lede becomes parity/bars.html), built by this
// commit's CLI with no flags, so the site shows what `lede build` does on main. The index is a Lede page written here at
// build time and never tracked: a tracked .lede file would join the render-hash tests.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const examples = join(root, 'examples');
const cli = join(root, 'packages/cli/src/cli.ts');
const out = resolve(root, process.argv[2] ?? '_site');

/** The same set `pnpm check:examples` checks: every .lede under examples/ outside an as-written folder. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'as-written' ? [] : sources(p);
    return e.name.endsWith('.lede') ? [p] : [];
  });
}

/** The page's `@title`, else its first heading, else the file name. */
function titleOf(file: string): string {
  const lines = readFileSync(file, 'utf8').split('\n');
  const line = lines.find((l) => l.startsWith('@title ')) ?? lines.find((l) => l.startsWith('# '));
  return line ? line.replace(/^(@title|#) /, '').trim() : relative(examples, file);
}

/** Link text is inline Lede: escape what would start markup. */
const text = (s: string) => s.replace(/[\\`*[\]]/g, (c) => `\\${c}`);

const build = (src: string, dest: string) =>
  execFileSync(process.execPath, [cli, 'build', src, '-o', dest], { stdio: ['ignore', 'ignore', 'inherit'] });

rmSync(out, { recursive: true, force: true });
const groups = new Map<string, string[]>();
for (const src of sources(examples).toSorted()) {
  const rel = relative(examples, src).replace(/\.lede$/, '.html');
  mkdirSync(dirname(join(out, rel)), { recursive: true });
  build(src, join(out, rel));
  const group = dirname(rel) === '.' ? 'Overview' : dirname(rel);
  const links = groups.get(group) ?? [];
  links.push(`- [${text(titleOf(src))}](${rel})`);
  groups.set(group, links);
}

const index = [
  '@title Lede examples',
  '@subtitle Every shipped example, built from main by the lede command with no flags',
  '# Lede examples',
  '',
  'Each page below is one self-contained HTML file compiled from a `.lede` source in [lede-lang/lede](https://github.com/lede-lang/lede/tree/main/examples).',
  ...[...groups].flatMap(([group, links]) => ['', `## ${group}`, ''].concat(links)),
  '',
].join('\n');
const indexSrc = join(out, 'index.lede');
writeFileSync(indexSrc, index);
build(indexSrc, join(out, 'index.html'));
rmSync(indexSrc);
// Pages runs Jekyll on an uploaded branch, not on an uploaded artifact; the marker keeps a branch deploy correct too.
writeFileSync(join(out, '.nojekyll'), '');
process.stderr.write(`build-pages: ${[...groups.values()].flat().length} pages and an index in ${relative(root, out)}\n`);
