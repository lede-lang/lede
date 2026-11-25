// Build the shipped examples into a static site for GitHub Pages (.github/workflows/pages.yml).
//   node scripts/build-pages.ts [out-dir]     default _site
// Each example keeps its path under examples/ (examples/parity/bars.lede becomes parity/bars.html), built by this
// commit's CLI with no flags, so the site shows what `lede build` does on main. The index is a Lede page written here at
// build time and never tracked: a tracked .lede file would join the render-hash tests. It lists the pages by folder and, read
// from each page's parsed blocks, by block, so the site doubles as a registry of what each block looks like.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parse, walkBlocks, type Block } from '@lede-lang/core';

const root = resolve(import.meta.dirname, '..');
const examples = join(root, 'examples');
const cli = join(root, 'packages/cli/src/cli.ts');
const out = resolve(root, process.argv[2] ?? '_site');
const repo = 'https://github.com/lede-lang/lede';
const site = 'https://lede-lang.github.io/lede/';

/** Section names for the example folders; a folder not named here keeps its own name. */
const GROUPS: Record<string, string> = {
  '.': 'Every block on one page',
  article: 'Agent-written pages',
  parity: 'One block at a time',
  'spike-a': 'Chart markers',
  'spike-b': 'Flow and sequence diagrams',
  'spike-c': 'Page types',
  tabs: 'Tabs',
  v04: 'Cards, ranges and annotations',
};

/** The block a reader would look a page up by, as its keyword is written; undefined for plain text and headings. */
function blockName(b: Block): string | undefined {
  switch (b.type) {
    case 'heading':
    case 'paragraph':
    case 'rule':
      return undefined;
    case 'chart':
      return `chart ${b.kind}`;
    case 'diagram':
      return b.kind === 'sequence' ? 'diagram (sequence)' : 'diagram';
    case 'kpis':
      return 'kpi';
    case 'steps':
      return 'step';
    case 'note':
      return 'note (!)';
    case 'list':
      return 'list (- or 1.)';
    case 'quote':
      return 'quote (>)';
    default:
      return b.type;
  }
}

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

/** A section's place: the order of GROUPS, then any other folder. */
const rank = (group: string) => {
  const i = Object.values(GROUPS).indexOf(group);
  return i < 0 ? Infinity : i;
};

/** How many pages the block list links for each block: the most focused ones, those with the fewest kinds of block. */
const PER_BLOCK = 3; // the index text says "up to three"

/** Link text is inline Lede: escape what would start markup. */
const text = (s: string) => s.replace(/[\\`*[\]]/g, (c) => `\\${c}`);

const build = (src: string, dest: string) =>
  execFileSync(process.execPath, [cli, 'build', src, '-o', dest], { stdio: ['ignore', 'ignore', 'inherit'] });

/**
 * The agent-written pages are also ledelang.dev's gallery, compiled from the same sources; their copies here name that
 * page as canonical, so search engines index one of the two. The temporary source sits beside the original, where any
 * `data x < file` it holds still resolves.
 */
function buildPage(src: string, dest: string, rel: string): void {
  if (dirname(rel) !== 'article') return void build(src, dest);
  const tmp = `${src}.canonical.lede`;
  writeFileSync(tmp, `@canonical https://ledelang.dev/gallery/${basename(rel)}\n${readFileSync(src, 'utf8')}`);
  try {
    build(tmp, dest);
  } finally {
    rmSync(tmp);
  }
}

rmSync(out, { recursive: true, force: true });
const groups = new Map<string, string[]>();
/** The pages this site is canonical for: all but the agent-written ones (buildPage). */
const indexed: string[] = [];
/** Block name to the pages that use it, each with how many kinds of block that page holds. */
const byBlock = new Map<string, { link: string; kinds: number }[]>();
for (const src of sources(examples).toSorted()) {
  const rel = relative(examples, src).replace(/\.lede$/, '.html');
  mkdirSync(dirname(join(out, rel)), { recursive: true });
  buildPage(src, join(out, rel), rel);
  if (dirname(rel) !== 'article') indexed.push(rel);
  const title = text(titleOf(src));
  const group = GROUPS[dirname(rel)] ?? dirname(rel);
  groups.set(group, [...(groups.get(group) ?? []), `- [${title}](${rel}) ([source](${repo}/blob/main/${relative(root, src)}))`]);
  const names = new Set<string>();
  walkBlocks(parse(readFileSync(src, 'utf8')).blocks, (b) => {
    const name = blockName(b);
    if (name) names.add(name);
  });
  for (const name of names) byBlock.set(name, [...(byBlock.get(name) ?? []), { link: `[${title}](${rel})`, kinds: names.size }]);
}

const index = [
  '@title Lede examples',
  '@subtitle Every shipped example, built from main by the lede command with no flags',
  '@description Every Lede block (charts, diagrams, sequence diagrams, tables, metric tiles, cards, steps, questions and tabs) in a page an AI agent could write, compiled to one self-contained HTML page with no JavaScript.',
  `@canonical ${site}`,
  '# Lede examples',
  '',
  `Each page below is one self-contained HTML file compiled from a \`.lede\` source in [lede-lang/lede](${repo}/tree/main/examples). This site is built and published by the repository's own GitHub Actions workflow ([pages.yml](${repo}/blob/main/.github/workflows/pages.yml)); to publish your own pages the same way, see [the Lede action](${repo}/blob/main/action/README.md). The full reference is at [ledelang.dev](https://ledelang.dev/reference/).`,
  '',
  '## Find an example by block',
  '',
  'Up to three of the most focused pages that use each block; the sections after it list every page.',
  '',
  ...[...byBlock]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, pages]) => {
      const best = pages.toSorted((a, b) => a.kinds - b.kinds).slice(0, PER_BLOCK);
      return `- \`${name}\`: ${best.map((p) => p.link).join(', ')}`;
    }),
  ...[...groups].toSorted(([a], [b]) => rank(a) - rank(b)).flatMap(([group, links]) => ['', `## ${group}`, ''].concat(links)),
  '',
].join('\n');
const indexSrc = join(out, 'index.lede');
writeFileSync(indexSrc, index);
build(indexSrc, join(out, 'index.html'));
rmSync(indexSrc);
// For Search Console: the github.io root is not ours, so no robots.txt can point here; submit this URL by hand.
writeFileSync(
  join(out, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['', ...indexed]
    .map((u) => `  <url><loc>${site}${u}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
);
// Pages runs Jekyll on an uploaded branch, not on an uploaded artifact; the marker keeps a branch deploy correct too.
writeFileSync(join(out, '.nojekyll'), '');
process.stderr.write(`build-pages: ${[...groups.values()].flat().length} pages and an index in ${relative(root, out)}\n`);
