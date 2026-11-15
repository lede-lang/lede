// The TextMate grammar for .lede (editors/textmate/lede.tmLanguage.json; internal spec task C5a, lede-lang/meta).
//
// RESTRICTION, stated on purpose: TextMate engines use Oniguruma, and this test has no Oniguruma. Every pattern in the grammar is
// therefore limited to syntax that means the same in JavaScript, and this file compiles each one with `new RegExp(src, 'u')`. That
// covers the `^`/`$` anchors, lookahead and lookbehind, backreferences, `[A-Za-z]` classes and the like; it leaves out `\G`, `\A`,
// `\h`, possessive quantifiers, atomic groups, and the `(?i)` flag groups, which the grammar spells as `[Tt][Ii][Pp]` instead. A
// pattern can still behave differently in a real engine in ways this test cannot see (see editors/README.md).
//
// The walk below follows the TextMate rule for the top level: of all the patterns, the one that matches earliest in the line wins, and
// a tie goes to the one listed first. A line-anchored pattern matches at its start, so for those lines this is "the first rule that
// matches", as the parser's own classification (spec section 3) is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYWORDS, NOTE_KINDS, parse } from '@lede-lang/core';

const GRAMMAR_PATH = new URL('../../../editors/textmate/lede.tmLanguage.json', import.meta.url);

interface Rule {
  name?: string;
  match?: string;
  begin?: string;
  end?: string;
  captures?: Record<string, Rule>;
  beginCaptures?: Record<string, Rule>;
  endCaptures?: Record<string, Rule>;
  patterns?: Rule[];
  include?: string;
  contentName?: string;
}
interface Grammar {
  scopeName: string;
  fileTypes: string[];
  patterns: Rule[];
  repository: Record<string, Rule>;
}

const grammar = JSON.parse(readFileSync(GRAMMAR_PATH, 'utf8')) as Grammar;

/** Every pattern source in the grammar, with the path that found it, for compiling. */
function sources(node: unknown, path: string, out: { path: string; src: string }[]): void {
  if (Array.isArray(node)) node.forEach((n, i) => sources(n, `${path}[${i}]`, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'match' || k === 'begin' || k === 'end' || k === 'while') && typeof v === 'string')
        out.push({ path: `${path}.${k}`, src: v });
      else sources(v, `${path}.${k}`, out);
    }
  }
}

/** The rules the top level lists, includes resolved against the repository. */
const topLevel: Rule[] = grammar.patterns.flatMap((p) => {
  const include = p.include ?? '';
  assert.ok(include.startsWith('#'), `top-level entries are repository includes: ${JSON.stringify(p)}`);
  const rule = grammar.repository[include.slice(1)];
  assert.ok(rule, `${include} is in the repository`);
  // A repository entry that only lists patterns (the inline markup) stands for those patterns, in order.
  return rule.patterns && !rule.match && !rule.begin ? rule.patterns : [rule];
});

const compiled = topLevel.map((rule) => ({ rule, re: new RegExp((rule.match ?? rule.begin)!, 'u') }));

interface Hit {
  rule: Rule;
  m: RegExpExecArray;
}
/** The rule TextMate would pick for `line`: the earliest match, the first listed on a tie. */
function first(line: string): Hit | undefined {
  let best: Hit | undefined;
  for (const { rule, re } of compiled) {
    const m = re.exec(line);
    if (m && (!best || m.index < best.m.index)) best = { rule, m };
  }
  return best;
}
const scopeOf = (line: string): string | undefined => first(line)?.rule.name;

test('the grammar file is a TextMate grammar for .lede', () => {
  assert.equal(grammar.scopeName, 'source.lede');
  assert.deepEqual(grammar.fileTypes, ['lede']);
  assert.ok(topLevel.length > 30);
});

test('every pattern compiles as a JavaScript regular expression', () => {
  const all: { path: string; src: string }[] = [];
  sources(grammar, 'grammar', all);
  assert.ok(all.length > 60, `found ${all.length} patterns`);
  for (const { path, src } of all) {
    // An `end` pattern may name the begin pattern's captures (`\1`); a standalone compile has no group for it, so give it one.
    const probe = path.endsWith('.end') ? `(x)${src}` : src;
    assert.doesNotThrow(() => new RegExp(probe, 'u'), `${path}: ${src}`);
    assert.ok(
      !/\\[GAhHzZ]|\(\?[imxs-]+\)|\(\?>|[+*?]\+/.test(src.replace(/\\\\/g, '')) || /\[[^\]]*[+*?]\+/.test(src),
      `${path} uses Oniguruma-only syntax: ${src}`,
    );
  }
});

test('every include points at a rule that exists or at a stock grammar', () => {
  const stock = /^(source|text)\.[\w.+-]+$/;
  const incs: string[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) {
        if (k === 'include' && typeof v === 'string') incs.push(v);
        else walk(v);
      }
    }
  };
  walk(grammar);
  for (const i of incs) assert.ok(i.startsWith('#') ? i.slice(1) in grammar.repository : stock.test(i), `include ${i}`);
});

// One sample per construct, with the scope of the rule that claims it. `undefined` is "no rule claims the line": prose.
const SAMPLES: [line: string, scope: string | undefined][] = [
  // meta, headings, lists, quotes, notes, rules
  ['@title Page title', 'meta.meta-line.lede'],
  ['@accent #2357c6', 'meta.meta-line.lede'],
  ['@meta Owner | Ana Ruiz', 'meta.meta-line.lede'],
  ['# Heading one', 'markup.heading.lede'],
  ['## Heading two', 'markup.heading.lede'],
  ['### Heading three', 'markup.heading.lede'],
  ['###### too deep, still a heading line', 'markup.heading.lede'],
  ['#', 'markup.heading.lede'],
  ['#hashtag is prose', undefined],
  ['- a bullet', 'markup.list.unnumbered.lede'],
  ['-', 'markup.list.unnumbered.lede'],
  ['-- a sub-bullet', 'markup.list.unnumbered.sub.lede'],
  ['-- 1. a sub-step', 'markup.list.unnumbered.sub.lede'],
  ['- [ ] a task', 'markup.list.unnumbered.task.lede'],
  ['- [x] a done task', 'markup.list.unnumbered.task.lede'],
  ['- [X] a done task', 'markup.list.unnumbered.task.lede'],
  ['-dash is prose', undefined],
  ['1. first', 'markup.list.numbered.lede'],
  ['12) twelfth', 'markup.list.numbered.lede'],
  ['2026 was a year', undefined],
  ['> a quote', 'markup.quote.lede'],
  ['> — Attribution', 'markup.quote.lede'],
  ['! A note.', 'markup.note.lede'],
  ['!! A warning.', 'markup.note.warning.lede'],
  ['!!! A critical callout.', 'markup.note.danger.lede'],
  ['!text with no space is prose', undefined],
  ['! Tip: use SQS.', 'markup.note.kind.lede'],
  ['! tip: lower case counts', 'markup.note.kind.lede'],
  ['! RECOMMENDATION: upper case counts', 'markup.note.kind.lede'],
  ['! Tip:', 'markup.note.lede'],
  ['! Warning: not a kind word', 'markup.note.lede'],
  ['!! Tip: severity is not softened', 'markup.note.warning.lede'],
  ['---', 'meta.separator.lede'],
  ['-------', 'meta.separator.lede'],
  ['--', undefined],
  ['html: <b>raw</b>', 'meta.html-line.lede'],
  ['  indentation never matters', undefined],
  ['  ## indented heading', 'markup.heading.lede'],
  ['  chart bar runs', 'meta.chart.lede'],
  // the escape
  ['\\table stakes', 'meta.paragraph.escaped.lede'],
  ['\\data is a word', 'meta.paragraph.escaped.lede'],
  ['\\# not a heading', 'meta.paragraph.escaped.lede'],
  ['\\- not a list', 'meta.paragraph.escaped.lede'],
  ['\\> not a quote', 'meta.paragraph.escaped.lede'],
  ['\\! not a note', 'meta.paragraph.escaped.lede'],
  ['\\decision was made on Monday', 'meta.paragraph.escaped.lede'],
  // fences
  ['```', 'markup.fenced_code.block.lede'],
  ['```text', 'markup.fenced_code.block.lede'],
  ['````', 'markup.fenced_code.block.lede'],
  ['```js', 'markup.fenced_code.block.js.lede'],
  ['```ts', 'markup.fenced_code.block.ts.lede'],
  ['```json', 'markup.fenced_code.block.json.lede'],
  ['```python', 'markup.fenced_code.block.python.lede'],
  ['```bash', 'markup.fenced_code.block.shell.lede'],
  ['```html', 'markup.fenced_code.block.html-basic.lede'],
  ['```css', 'markup.fenced_code.block.css.lede'],
  ['```yaml', 'markup.fenced_code.block.yaml.lede'],
  ['```lede', 'markup.fenced_code.block.lede.lede'],
  ['```=html', 'markup.fenced_code.block.raw-html.lede'],
  ['```=svg', 'invalid.illegal.raw-format.lede'],
  // keyword lines, one per keyword (the coverage test below ties this list to the parser)
  ['data runs = week,deploys; W1,14; W2,19', 'meta.data.lede'],
  ['data runs += W3,23', 'meta.data.lede'],
  ['data big < file.csv', 'meta.data.lede'],
  ['chart line runs x=week y=deploys title="Deploys"', 'meta.chart.lede'],
  ['chart range plan from=start to=end', 'meta.chart.lede'],
  ['table runs cols=week sort=-deploys limit=5', 'meta.table.lede'],
  ['table = a | b', 'meta.table.lede'],
  ['table of contents', 'meta.table.lede'], // a keyword line that fails loudly, as the parser says (spec section 3)
  ['kpi Uptime | 99.97% | +0.02 pts | good', 'meta.kpi.lede'],
  ['kpi Deploys | =runs.deploys', 'meta.kpi.lede'],
  ['diagram arch dir=LR title="Topology"', 'meta.diagram.lede'],
  ['diagram login sequence', 'meta.diagram.lede'],
  ['image chart.png "Alt text" caption="A caption"', 'meta.image.lede'],
  ['grid 2', 'meta.grid.lede'],
  ['grid 2 count=4', 'meta.grid.lede'],
  ['cards', 'meta.cards.lede'],
  ['step Rotate the cert | by 03:00 | Ana', 'meta.step.lede'],
  ['ask goal lines=3 | What is the goal?', 'meta.ask.lede'],
  ['choose db | Postgres, MySQL, "Other, say which" | Which database?', 'meta.choose.lede'],
  ['confirm ok | Ready to go?', 'meta.confirm.lede'],
  ['export json', 'meta.export.lede'],
  ['export', 'meta.export.lede'],
  ['param tasks unit=% | Tasks done | 40 0 100 5', 'meta.param.lede'],
  ['param p | Label | 1 0 9 1', 'meta.param.lede'],
  ['toggle dark on | Dark mode', 'meta.toggle.lede'],
  ['toggle extra off needs=base | Extras', 'meta.toggle.lede'],
  ['toggle plain | Plain toggle', 'meta.toggle.lede'],
  ['bucket stage | Todo, Doing, Done | Sort the stages', 'meta.bucket.lede'],
  ['template brief | The brief', 'meta.template.lede'],
  ['preset quick | Quick | tasks=10; dark=on', 'meta.preset.lede'],
  ['decision db "Which database?" status=open by=2026-12-01', 'meta.decision.lede'],
  ['decision db status=settled', 'meta.decision.lede'],
  // prose that starts with a keyword stays prose (spec section 3, the shape rules)
  ['Table 3 shows the totals.', undefined],
  ['dataset is a word', undefined],
  ['cards on the table', undefined],
  ['export the data', undefined],
  ['export a b', undefined],
  ['toggle the flag on Monday', undefined],
  ['param is a word', undefined],
  ['bucket list ideas', undefined],
  ['template matching is fun', undefined],
  ['preset values are fixed', undefined],
  ['decision was made on Monday', undefined],
  ['decision queue is a phrase', undefined],
  ['decision db', undefined],
  // NAME: lines, scoped by the shape of what follows the colon (the grammar cannot know the declared names)
  ['arch: user "Customer" user', 'meta.node.lede'],
  ['arch: api "Payments API" svc "ECS, 6 tasks" focus', 'meta.node.lede'],
  ['arch: user -> api : https', 'meta.edge.lede'],
  ['arch: api -> db, cache : sql', 'meta.edge.lede'],
  ['arch: q --> worker : async', 'meta.edge.lede'],
  ['arch: a <-> b', 'meta.edge.lede'],
  ['arch: a -x- b', 'meta.edge.lede'],
  ['arch: a -x-> b', 'meta.edge.lede'],
  ['arch: a -> b -> c | good', 'meta.edge.lede'],
  ['arch: group priv "Private subnets" api, db', 'meta.statement.lede'],
  ['arch: legend', 'meta.statement.lede'],
  ['login: alt "password ok"', 'meta.statement.lede'],
  ['login: opt "remember me"', 'meta.statement.lede'],
  ['login: else "bad password"', 'meta.statement.lede'],
  ['login: end', 'meta.statement.lede'],
  ['login: note app : checks password', 'meta.statement.lede'],
  ['db: option sqs "Managed queue" | cheap | chosen', 'meta.statement.lede'],
  ['db: question "Who owns it?" | answer: Ana', 'meta.statement.lede'],
  ['db: role decides "Ana"', 'meta.statement.lede'],
  ['runs: W6 | 3 | 1', 'meta.row.lede'],
  ['stage: Parse the spec | Draft', 'meta.row.lede'],
  [': Managed queue | 1,200 | Fits', 'meta.table-row.lede'],
  [':', 'meta.table-row.lede'],
  // an ordinary `Word: text` line is prose; only the shapes above claim a NAME: line
  ['Note: remember to call the doctor', undefined],
  ['Warning: the end of the file is near', undefined],
  ['Result: done', undefined],
  ['Summary: the bucket list is long', undefined],
  // inline markup, in a paragraph: the earliest inline match is the rule
  ['`code` at the start', 'markup.inline.raw.lede'],
  ['Some **bold** words', 'markup.bold.lede'],
  ['Some *italic* words', 'markup.italic.lede'],
  ['Some _italic_ words', 'markup.italic.lede'],
  ['See [the docs](https://example.com/a_(b)) now', 'meta.link.inline.lede'],
  ['Escaped \\* star', 'constant.character.escape.lede'],
  ['Use ``a`b`` with a backtick', 'markup.inline.raw.lede'],
  ['2 * 3 * 4 is not italic', undefined],
  ['snake_case_name is not italic', undefined],
];

test('each construct is claimed by the rule the parser would read it as', () => {
  for (const [line, scope] of SAMPLES) assert.equal(scopeOf(line), scope, `line: ${line}`);
});

test('a keyword line scopes its keyword, its name and its options', () => {
  const cap = (line: string, i: number): string | undefined => first(line)?.rule.captures?.[i]?.name;
  assert.equal(cap('chart line runs x=week', 1), 'keyword.control.chart.lede');
  assert.equal(cap('chart line runs x=week', 2), 'constant.language.chart-kind.lede');
  assert.equal(cap('chart line runs x=week', 3), 'variable.other.lede');
  assert.equal(cap('data runs = a,b', 2), 'entity.name.type.lede');
  assert.equal(cap('diagram arch dir=LR', 2), 'entity.name.type.lede');
  assert.equal(cap('toggle t on | L', 1), 'keyword.control.toggle.lede');
  assert.equal(cap('toggle t on | L', 2), 'entity.name.type.lede');
  assert.equal(cap('! Tip: x', 2), 'keyword.other.note-kind.lede');
  assert.equal(cap('arch: a -> b', 1), 'entity.name.type.lede');
  assert.equal(cap('arch: group g "G" a', 3), 'keyword.other.statement.lede');
  // The option, string, pipe and arrow patterns that the captures hand the rest of the line to.
  const inner = (name: string): Rule => grammar.repository[name];
  assert.match('x=week', new RegExp(inner('option').match!, 'u'));
  assert.match('"say ""hi"" \\" there"', new RegExp(`^${inner('string').match!}$`, 'u'));
  for (const arrow of ['->', '-->', '<->', '-x->']) assert.match(`a ${arrow} b`, new RegExp(inner('arrow').match!, 'u'));
  assert.match('a -x- b', new RegExp(inner('arrow').match!, 'u'));
  assert.match('| good', new RegExp(inner('pipe').match!, 'u'));
});

test('every parser keyword has a keyword-line rule and a sample, so the grammar cannot fall behind', () => {
  const sampled = new Set(SAMPLES.map(([, s]) => s));
  for (const kw of KEYWORDS) {
    const rule = grammar.repository[`meta.${kw}`];
    assert.ok(rule, `no rule meta.${kw} for the keyword ${kw}`);
    assert.equal(rule.name, `meta.${kw}.lede`);
    assert.equal(rule.captures?.[1]?.name, `keyword.control.${kw}.lede`, `${kw}: its keyword is scoped`);
    assert.ok(sampled.has(`meta.${kw}.lede`), `no sample line for the keyword ${kw}`);
    assert.ok(topLevel.includes(rule), `meta.${kw} is not listed at the top level`);
  }
  // The opposite direction: a keyword rule with no keyword behind it is a stale rule.
  const known = new Set<string>(KEYWORDS);
  for (const r of topLevel) {
    const k = /^meta\.(\w+)\.lede$/.exec(r.name ?? '')?.[1];
    if (k && r.captures?.[1]?.name?.startsWith('keyword.control.')) assert.ok(known.has(k) || k === 'html', `stale keyword rule ${r.name}`);
  }
});

test('every note kind word of the parser is a kind in the grammar, in any case', () => {
  for (const word of NOTE_KINDS.keys()) {
    for (const w of [word, word[0].toUpperCase() + word.slice(1), word.toUpperCase()]) {
      assert.equal(scopeOf(`! ${w}: text`), 'markup.note.kind.lede', w);
    }
  }
});

test('the keyword-versus-prose decision agrees with the parser on the same lines', () => {
  const lines = SAMPLES.map(([l]) => l).filter((l) =>
    /^(?:data|chart|table|kpi|diagram|image|grid|cards|step|ask|choose|confirm|export|param|toggle|bucket|template|preset|decision|Table|dataset)\b/.test(
      l,
    ),
  );
  assert.ok(lines.length > 40);
  for (const line of lines) {
    const keyword = /^meta\.\w+\.lede$/.test(scopeOf(line) ?? '');
    const blocks = parse(`${line}\n`).blocks;
    // The parser reads prose as a paragraph; a keyword line makes some other block, or none at all when it fails loudly.
    const parserKeyword = blocks.length === 0 || blocks[0].type !== 'paragraph';
    assert.equal(keyword, parserKeyword, `grammar and parser disagree on: ${line}`);
  }
});
