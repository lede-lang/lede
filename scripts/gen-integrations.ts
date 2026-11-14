// Writes the Lede skill in each agent host's native format under integrations/, all from the one source, skill/lede/SKILL.md
// (adoption spec task C2, internal spec, lede-lang/meta). The body text is cut from SKILL.md, never retyped, so the model reference
// exists once. `--check` writes nothing and fails when a generated file is missing, stale or breaks a gate (AGENTS.md under 32 KiB).
//   node scripts/gen-integrations.ts [--check]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const SKILL_DIR = join(root, 'skill', 'lede');
const OUT = join(root, 'integrations');
const AGENTS_LIMIT = 32 * 1024;
const MARKER = 'generated from skill/lede/SKILL.md by scripts/gen-integrations.ts, do not edit';

const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill);
if (!fm) throw new Error('skill/lede/SKILL.md has no frontmatter');
const description = /^description:\s*(.+)$/m.exec(fm[1])?.[1]?.trim();
if (!description) throw new Error('skill/lede/SKILL.md has no description');

// Body without the frontmatter, the "# Lede" title and the "Reference files" section (it points at files a single-file host lacks).
let body = skill
  .slice(fm[0].length)
  .replace(/^\s*# Lede\n/, '')
  .trim();
const refFiles = body.indexOf('\n## Reference files');
if (refFiles >= 0) body = body.slice(0, refFiles).trim();
const RULE =
  'When asked for a page, report, dashboard, status page, runbook, comparison or diagram that someone will open in a browser, ' +
  'write it as a Lede file (`.lede`), never as HTML or CSS, then compile it with the setup below. ' +
  'Not for apps, interactive widgets or pages that need script.';

const version = (JSON.parse(readFileSync(join(root, 'packages', 'cli', 'package.json'), 'utf8')) as { version: string }).version;

const section = (heading: string): string => `${heading}\n\n${RULE}\n\n${body}\n`;
const htmlMarker = `<!-- ${MARKER} -->\n`;

const files = new Map<string, string | Buffer>();
const agents = `${htmlMarker}${section('## Lede')}`;
files.set('agents-md/AGENTS.md', agents);
files.set(
  'cursor/lede.mdc',
  `---\ndescription: ${JSON.stringify(description)}\nglobs: "**/*.lede"\nalwaysApply: false\n---\n${htmlMarker}\n${section('# Lede')}`,
);
files.set('copilot/copilot-instructions.md', `${htmlMarker}${section('## Lede')}`);
files.set(
  'gemini/gemini-extension.json',
  `${JSON.stringify({ name: 'lede', version, description, contextFileName: 'GEMINI.md' }, null, 2)}\n`,
);
files.set('gemini/GEMINI.md', `${htmlMarker}${section('# Lede')}`);
files.set(
  'system-prompt/lede.txt',
  `[${MARKER}]\n\nYou can write pages as Lede, a line-oriented page format, instead of HTML.\n${RULE}\n\n${body}\n`,
);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
}
for (const f of walk(SKILL_DIR)) files.set(join('gemini', 'skills', 'lede', relative(SKILL_DIR, f)), readFileSync(f));

const bytes = (v: string | Buffer): number => (typeof v === 'string' ? Buffer.byteLength(v) : v.length);
const problems: string[] = [];
if (bytes(files.get('agents-md/AGENTS.md')!) >= AGENTS_LIMIT)
  problems.push(`AGENTS.md is ${bytes(files.get('agents-md/AGENTS.md')!)} bytes; the limit is ${AGENTS_LIMIT}`);
process.stdout.write(`gen-integrations: AGENTS.md snippet is ${bytes(files.get('agents-md/AGENTS.md')!)} bytes (limit ${AGENTS_LIMIT})\n`);

const check = process.argv.includes('--check');
let stale = false;
if (check) {
  for (const [name, content] of files) {
    const path = join(OUT, name);
    const have = existsSync(path) ? readFileSync(path) : null;
    if (!have || !have.equals(typeof content === 'string' ? Buffer.from(content) : content)) {
      process.stderr.write(`gen-integrations: ${name} is out of date; run node scripts/gen-integrations.ts\n`);
      stale = true;
    }
  }
  // A leftover file under the generated skill copy is stale too.
  const copy = join(OUT, 'gemini', 'skills', 'lede');
  if (existsSync(copy))
    for (const f of walk(copy)) {
      if (!files.has(relative(OUT, f))) {
        process.stderr.write(`gen-integrations: ${relative(OUT, f)} is not generated; run node scripts/gen-integrations.ts\n`);
        stale = true;
      }
    }
} else {
  rmSync(join(OUT, 'gemini', 'skills'), { recursive: true, force: true });
  for (const [name, content] of files) {
    mkdirSync(dirname(join(OUT, name)), { recursive: true });
    writeFileSync(join(OUT, name), content);
  }
  for (const [name, content] of files) process.stdout.write(`  ${name} ${bytes(content)}\n`);
}
if (problems.length) {
  process.stderr.write(`gen-integrations: ${problems.join('; ')}\n`);
  process.exit(1);
}
process.exit(stale ? 1 : 0);
