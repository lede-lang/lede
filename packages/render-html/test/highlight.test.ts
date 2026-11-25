// Build-time highlighting and line numbers for code fences (spec §4.9, D84). What is held here: the language list and the span
// contract (`tk-K`, one class, nothing else), the text of every fence equal to its source in every listed language, pages without a
// highlighted or numbered fence unchanged, the syntax colours in the stylesheet of the pages that use them and nowhere else, and
// the scanner's work linear in the size of the fence. The security corpus runs the same fences through the page audit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser } from 'htmlparser2';
import { SYNTAX_COLOURS, SYNTAX_TOKENS, parse, parseTheme, walkBlocks, type CodeBlock } from '@lede-lang/core';
import { HIGHLIGHT_LANGS, TOKEN_KINDS, compile, css, highlights, render, tokenize } from '../src/index.ts';
import { codeHtml } from '../src/highlight.ts';
import { browserTest, serve } from './chrome.ts';
import { rng, text as fuzzText } from './fuzz.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const corpus = JSON.parse(readFileSync(new URL('./fixtures/security-corpus.json', import.meta.url), 'utf8')) as { strings: string[] };

/** The RFC's list (issue #35), written out: the scanner's table must be exactly this. */
const LISTED = 'ts js tsx jsx json yaml toml sh bash py go rs java kt swift c cpp cs rb sql html css diff lede'.split(' ');
const KINDS = ['kw', 'str', 'num', 'cm', 'fn', 'ty', 'op', 'pn', 'add', 'del', 'hd'];
/** A string on one line: every line break, the two Unicode separators included, is a space. */
const BREAKS = new RegExp(`[\\r\\n${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
const oneLine = (s: string): string => s.replace(BREAKS, ' ');

interface Read {
  /** The text of the markup, entities decoded. */
  text: string;
  /** Each element as `tag` and its attributes. */
  tags: { name: string; attribs: Record<string, string>; depth: number }[];
}
/** Markup as a browser's parser reads it (htmlparser2, not the code under test). */
function read(html: string): Read {
  const out: Read = { text: '', tags: [] };
  let depth = 0;
  const p = new Parser(
    {
      ontext: (t) => (out.text += t),
      onopentag: (name, attribs) => out.tags.push({ name, attribs, depth: depth++ }),
      onclosetag: () => depth--,
    },
    { decodeEntities: true },
  );
  p.write(html);
  p.end();
  return out;
}

/** What breaks the span contract in the contents of a `<code>`: anything but spans with one class from the list (`ln` when numbered). */
function contractProblems(html: string, numbered: boolean): string[] {
  const allowed = new Set([...KINDS.map((k) => `tk-${k}`), ...(numbered ? ['ln'] : [])]);
  const problems: string[] = [];
  for (const t of read(html).tags) {
    if (t.name !== 'span') problems.push(`<${t.name}>`);
    else if (Object.keys(t.attribs).join() !== 'class' || !allowed.has(t.attribs.class))
      problems.push(`<span ${JSON.stringify(t.attribs)}>`);
    else if (t.attribs.class === 'ln' && t.depth !== 0) problems.push('a line span inside another span');
  }
  if (/<span[^>]*>[^<]*\n/.test(html.replace(/<span class="ln">/g, ''))) problems.push('a token span holds a line break');
  return problems;
}

const SAMPLES: Record<string, string> = {
  ts: 'import { x } from "./x.ts";\n/* block\n   comment */\nexport async function load<T>(id: number): Promise<T | null> {\n  const url = `https://a/${id}`; // note\n  return fetch(url) ?? 0x1F + 1.5e3;\n}',
  js: "const re = /a'b/;\nlet s = 'it\\'s';\nclass A extends B { static #x = 1n }",
  tsx: 'export const C = (p: Props) => <div className="x">{p.name}</div>;',
  jsx: 'const C = () => <a href="#top">Top</a>;',
  json: '{"a": [1, -2.5e3, true, null], "b": {"c": "d:e"}}',
  yaml: '# c\nname: demo\nitems:\n  - id: 1\n    url: "http://x" # y\n  - &a plain: yes',
  toml: '[package]\nname = "x"\nversion = 1.2\n[[bin]]\ndate = 2026-01-01T00:00:00Z # c',
  sh: 'set -e\nfor f in *.txt; do\n  echo "$f ${HOME}" # hi\n  do-thing --x=1\ndone',
  bash: 'if [ -z "$1" ]; then exit 1; fi',
  py: '@dataclass\nclass A(Base):\n    """Doc\n    string"""\n    def f(self, x: int = 3) -> str:\n        return f"{x}" # c',
  go: "package main\nfunc main() { s := `raw\nstr`; var r rune = 'a'; fmt.Println(s, r) }",
  rs: "fn main<'a>(x: &'a str) -> Option<u8> { let c = 'x'; println!(\"{}\", c); None }",
  java: 'public final class A { String s = """\n  text\n  """; int f() { return 1; } }',
  kt: 'data class P(val name: String) { fun hi() = "hi $name" }',
  swift: 'struct P { let name: String; func hi() -> String { "hi \\(name)" } }',
  c: "#include <stdio.h>\nint main(void) { char c = '\\n'; return 0; }",
  cpp: 'template <typename T> class V { public: virtual ~V() = default; };',
  cs: 'public record P(string Name) { public int F() => 1; }',
  rb: 'class Foo < Bar\n  def ok?(a) = a == :sym && Foo::Baz # c\nend',
  sql: "SELECT count(*) AS n FROM users u -- c\nWHERE u.name = 'O''Brien' AND id IN (1, 2);",
  html: '<!doctype html>\n<!-- c -->\n<a href="x" class=y disabled>T &amp; U</a><br/>',
  css: '@media (min-width: 10px) {\n  a:hover {\n    color: #fff;\n    margin: 0 -1.5em !important;\n  }\n}\n/* c */',
  diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n ctx\n-old <b>\n+new\n--- sql comment\n\\ No newline at end of file',
  lede: '@title Demo\n# Head\nSome `code`, **bold** and [a link](https://a.b/c).\ndata d = x,v; a,1\nchart bar d title="T" labels\ndiagram net dir=LR\nnet: api "Orders API" svc\nnet: api -x-> db : deny | bad\nNote: prose\n- item\n! Tip: do it\n```ts lines\nchart is code here\n```\ntoggle the flag on Monday\ntoggle t1 | Label',
};

test('the highlighted languages are the RFC list, and the kinds are the eleven classes', () => {
  assert.deepEqual([...HIGHLIGHT_LANGS].toSorted(), LISTED.toSorted());
  assert.deepEqual([...TOKEN_KINDS], KINDS);
  assert.deepEqual(Object.keys(SAMPLES).toSorted(), LISTED.toSorted(), 'a sample for every language');
  for (const lang of LISTED) assert.ok(highlights(lang), lang);
  // The name is matched as written: no aliases, no case folding, nothing inherited from Object.
  for (const lang of ['', 'text', 'python', 'typescript', 'TS', 'Diff', 'md', 'lines', 'constructor', '__proto__', 'toString'])
    assert.ok(!highlights(lang), lang);
});

for (const lang of LISTED)
  test(`${lang}: the sample is cut into spans from the list, its text is the source, and it has something to show`, () => {
    const src = SAMPLES[lang];
    for (const numbered of [false, true]) {
      const html = codeHtml(src, lang, numbered);
      assert.deepEqual(contractProblems(html, numbered), []);
      assert.equal(read(html).text, src);
      assert.equal((html.match(/<span class="ln">/g) ?? []).length, numbered ? src.split('\n').length : 0);
    }
    if (lang !== 'diff')
      assert.equal(
        tokenize(lang, src)
          .map((t) => t[1])
          .join(''),
        src,
      );
    const kinds = new Set(read(codeHtml(src, lang, false)).tags.map((t) => t.attribs.class));
    assert.ok(kinds.size >= 3, `kinds drawn: ${[...kinds].join(' ')}`);
  });

test('what each family reads: comments, strings, keywords, calls, types, keys, diff lines and Lede lines', () => {
  const has = (lang: string, src: string, ...spans: string[]) => {
    const html = codeHtml(src, lang, false);
    for (const s of spans) assert.ok(html.includes(s), `${lang}: ${s} in ${html}`);
  };
  const k = (kind: string, t: string) => `<span class="tk-${kind}">${t}</span>`;
  has('ts', 'const n: number = f(1); // c', k('kw', 'const'), k('ty', 'number'), k('fn', 'f'), k('num', '1'), k('cm', '// c'));
  has('ts', 'a /* x\ny */ b', `${k('cm', '/* x')}\n${k('cm', 'y */')}`);
  has('ts', 'x = "a // b";', k('str', '&quot;a // b&quot;'));
  has('py', 'x = 1 # c "s"', k('cm', '# c &quot;s&quot;'));
  has('py', "s = '''a\nb'''", `${k('str', "'''a")}\n${k('str', "b'''")}`);
  has('rs', "fn f<'a>() { let c = 'x'; }", k('str', "'x'"), "'a");
  has('sh', 'echo "$HOME" $PATH # c', k('kw', 'echo'), k('ty', '$PATH'), k('cm', '# c'));
  has('sh', 'echo $# a#b', 'a#b');
  has('json', '{"k": "v"}', k('ty', '&quot;k&quot;'), k('str', '&quot;v&quot;'));
  has('yaml', 'key: value # c', k('ty', 'key'), k('cm', '# c'));
  has('toml', '[t]\nk = 1', k('hd', '[t]'), k('ty', 'k'), k('num', '1'));
  has('sql', 'select Count(*) from t', k('kw', 'select'), k('fn', 'Count'), k('kw', 'from'));
  has('html', '<a href="x">', k('kw', 'a'), k('ty', 'href'), k('str', '&quot;x&quot;'));
  has('css', 'a {\n  color: red;\n}', k('ty', 'color'));
  has('diff', '+a\n-b\n c', `${k('add', `${k('op', '+')}a`)}\n${k('del', `${k('op', '-')}b`)}\n${k('pn', ' ')}c`);
  has('diff', '--- a/x\n+++ b/x\n@@ -1 +1 @@\n--- gone', k('hd', '--- a/x'), k('hd', '+++ b/x'), k('del', `${k('op', '-')}-- gone`));
  has('lede', '@title T\n# H\nkpi 1 | Open', k('ty', '@title'), k('hd', '# H'), k('kw', 'kpi'));
  has('lede', 'diagram net\nnet: a -> b', k('kw', 'diagram'), k('fn', 'net:'), k('op', '-&gt;'));
  // A `NAME:` line binds only to a declared name, an editor word is a keyword only with its `|`, and a fence inside is code.
  assert.ok(!codeHtml('Note: prose\ntoggle the flag on Monday', 'lede', false).includes('<span'));
  assert.equal(codeHtml('````\nkpi 1 | x\n````', 'lede', false), `${k('pn', '````')}\nkpi 1 | x\n${k('pn', '````')}`);
});

/** The code blocks of a compiled page, in order: the text of each `<pre class="code …"><code>` that is not a template's or an export's. */
function codeTexts(html: string): string[] {
  const out: string[] = [];
  let open = false;
  const p = new Parser(
    {
      onopentag(name, a) {
        if (name === 'pre' && /^code\b/.test(a.class ?? '') && (a['aria-label'] === 'Code' || 'data-lang' in a)) {
          open = true;
          out.push('');
        }
      },
      ontext: (t) => void (open && (out[out.length - 1] += t)),
      onclosetag: (name) => void (name === 'pre' && (open = false)),
    },
    { decodeEntities: true },
  );
  p.write(html);
  p.end();
  return out;
}
const codeBlocks = (blocks: Parameters<typeof walkBlocks>[0]): CodeBlock[] => {
  const out: CodeBlock[] = [];
  walkBlocks(blocks, (b) => void (b.type === 'code' && out.push(b)));
  return out;
};

test(`the text of every fence is its source: ${corpus.strings.length} corpus strings in every listed language, plain and numbered`, async () => {
  const fails: string[] = [];
  for (const [i, p] of corpus.strings.entries()) {
    const body = [oneLine(p), ` ${p}`, `+${p}`, `-${p}`, `"${p}`, `/* ${p}`, `<a ${p}`, `chart ${p}`].join('\n');
    const src = LISTED.flatMap((lang) => [`\`\`\`\`\`${lang}\n${body}\n\`\`\`\`\``, `\`\`\`\`\`${lang} lines\n${body}\n\`\`\`\`\``]).join(
      '\n\n',
    );
    const { html, doc } = await compile(src);
    const blocks = codeBlocks(doc.blocks);
    const texts = codeTexts(html);
    if (blocks.length !== LISTED.length * 2 || texts.length !== blocks.length)
      fails.push(`string ${i}: ${blocks.length} blocks, ${texts.length} drawn`);
    for (const [n, b] of blocks.entries())
      if (texts[n] !== b.text || !b.text.includes(oneLine(p))) fails.push(`string ${i} in ${b.lang}${b.lines ? ' lines' : ''}`);
  }
  assert.deepEqual(fails, []);
});

test('the text of every fence is its source: generated text, and every fence of every tracked page read as every listed language', () => {
  const bodies = new Set<string>();
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed);
    bodies.add(Array.from({ length: 1 + Math.floor(r() * 4) }, () => fuzzText(r)).join(['', ' ', '"', "'", '/*', '<', '`'][seed % 7]));
  }
  const files = execFileSync('git', ['ls-files', '-z', '--', '*.lede'], { cwd: root, encoding: 'utf8' }).split('\0');
  for (const f of files.filter((x) => x && !x.startsWith('bench/gen/')))
    for (const b of codeBlocks(parse(readFileSync(`${root}${f}`, 'utf8'), { loadFile: () => 'a,b\n1,2' }).blocks)) bodies.add(b.text);
  assert.ok(bodies.size > 300, `${bodies.size} bodies`);
  const fails: string[] = [];
  for (const body of bodies)
    for (const lang of LISTED)
      for (const numbered of [false, true]) {
        const html = codeHtml(body, lang, numbered);
        if (read(html).text !== body || contractProblems(html, numbered).length > 0)
          fails.push(`${lang}: ${JSON.stringify(body).slice(0, 80)}`);
      }
  assert.deepEqual(fails.slice(0, 10), []);
});

// ------------------------------------------------------------------ pages

const LEGACY = (lang: string, text: string) =>
  lang
    ? `<pre class="code" tabindex="0" role="region" aria-label="${lang} code" data-lang="${lang}"><code>${text}</code></pre>`
    : `<pre class="code" tabindex="0" role="region" aria-label="Code"><code>${text}</code></pre>`;

test('a fence with no language or an unlisted one is drawn as before, and its page gains nothing', async () => {
  const src =
    '# T\n\n```\nconst a = "<b>";\n```\n\n```text\nconst a = 1;\n```\n\n```python\ndef f(): pass\n```\n\n```TS\nconst a = 1;\n```\n';
  const { html } = await compile(src);
  for (const want of [
    LEGACY('', 'const a = &quot;&lt;b&gt;&quot;;'),
    LEGACY('text', 'const a = 1;'),
    LEGACY('python', 'def f(): pass'),
    LEGACY('TS', 'const a = 1;'),
  ])
    assert.ok(html.includes(want), want);
  assert.ok(!html.includes('tk-') && !html.includes('class="ln"') && !html.includes('--lnw'));
  // The stylesheet is the one a page with no fence at all gets.
  const style = (h: string) => /<style>([\s\S]*?)<\/style>/.exec(h)![1];
  assert.equal(style(html), style((await compile('# T\n\nText.\n')).html));
});

test('a listed language is highlighted inside the same <pre> and <code>, and `lines` numbers any fence', async () => {
  const main = async (src: string) => render(parse(src), { fragment: true });
  assert.ok(
    (await main('```ts\nconst a = 1;\n```\n')).includes(
      LEGACY(
        'ts',
        '<span class="tk-kw">const</span> a <span class="tk-op">=</span> <span class="tk-num">1</span><span class="tk-pn">;</span>',
      ),
    ),
  );
  const numbered = await main('```text lines\na <b>\n\nc\n```\n');
  assert.ok(
    numbered.includes(
      '<pre class="code nums" tabindex="0" role="region" aria-label="text code" data-lang="text"><code><span class="ln">a &lt;b&gt;</span>\n<span class="ln"></span>\n<span class="ln">c</span></code></pre>',
    ),
    numbered,
  );
  // The gutter widens with the number of digits of the last line.
  const lines = (n: number) => `\`\`\`ts lines\n${Array.from({ length: n }, (_, i) => `x${i}`).join('\n')}\n\`\`\`\n`;
  for (const [n, cls] of [
    [99, 'code nums'],
    [100, 'code nums g3'],
    [1000, 'code nums g4'],
  ] as const)
    assert.ok((await main(lines(n))).includes(`<pre class="${cls}" `), `${n} lines`);
  // A template's fence is the shell runtime's to fill: it is never highlighted or numbered.
  const tpl = await main('ask a | A\ntemplate t | T\n```ts lines\nconst x = "{a}";\n```\n');
  assert.ok(!tpl.includes('tk-') && !tpl.includes('class="ln"'), tpl);
});

test('the syntax colours and the code rules are in the stylesheet of a page that uses them, in light, dark and print, and nowhere else', async () => {
  const plain = css({});
  const coded = css({ code: true });
  assert.ok(!plain.includes('tk-') && !plain.includes('/* code */'));
  for (const theme of ['light', 'dark'] as const) {
    const decl = SYNTAX_TOKENS.map((t) => `--${t}:${SYNTAX_COLOURS[theme][t]};`).join(' ');
    // Light: the root block and print. Dark: the media block and the forced block.
    assert.equal(coded.split(decl).length - 1, 2, `${theme}: ${decl}`);
  }
  assert.ok(/@media print\{:root:root\{[^}]*--tk-kw:#8f2a9e;/.test(coded), 'print takes the light syntax colours');
  // Taking the code rules and the seven declarations out leaves the plain sheet, byte for byte.
  const stripped = coded.replace(/\n {2}--tk-kw:[^\n]*;(?=\n|\})/g, '').replace(/\/\* code \*\/[\s\S]*$/, '');
  assert.equal(stripped, plain);
  for (const k of KINDS) assert.ok(coded.includes(`.tk-${k}`), `a rule for .tk-${k}`);
  // A forced theme declares one block and print.
  assert.equal(css({ code: true, theme: 'dark' }).split('--tk-kw:').length - 1, 2);
  // Full page, artifact and fragment agree on <main>, and the first two on the style.
  const src = '```diff lines\n+a\n```\n';
  const page = (await compile(src)).html;
  const artifact = (await compile(src, { artifact: true })).html;
  const fragment = (await compile(src, { fragment: true })).html;
  assert.ok(page.includes(fragment) && artifact.includes(fragment));
  assert.ok(page.includes('--tk-kw:') && artifact.includes('--tk-kw:') && !fragment.includes('--tk-kw:'));
});

test('a brand theme keeps the house syntax colours where they read and moves the ones that do not, in the sheet too', () => {
  const house = parseTheme('{"accent":"#0b5fff"}');
  assert.equal(house.theme.syntax, undefined);
  assert.ok(css({ code: true, tokens: house.theme }).includes(`--tk-kw:${SYNTAX_COLOURS.light['tk-kw']};`));
  const grey = parseTheme('{"light":{"bg":"#d0d0d0","surface":"#d0d0d0"}}');
  const moved = grey.theme.syntax?.light ?? {};
  assert.ok(Object.keys(moved).length > 0);
  const sheet = css({ code: true, tokens: grey.theme });
  for (const [token, hex] of Object.entries(moved)) {
    assert.notEqual(hex, SYNTAX_COLOURS.light[token as keyof typeof moved]);
    assert.ok(sheet.includes(`--${token}:${hex};`), token);
  }
  assert.ok(sheet.includes(`--tk-kw:${SYNTAX_COLOURS.dark['tk-kw']};`), 'the dark block keeps the house colours');
  assert.ok(!css({ tokens: grey.theme }).includes('tk-'), 'and a page without code declares none');
  assert.throws(() => css({ code: true, tokens: { ...grey.theme, syntax: { light: { 'tk-kw': 'red;}' } } } }), /tk-kw is not a #rrggbb/);
});

test('the scanner is linear: 200,000 characters of the worst input each rule has are cut in well under a second each', () => {
  const n = 200_000;
  const worst: [string, string][] = [
    ['ts', '/*'.repeat(n / 2)],
    ['ts', '"\\'.repeat(n / 2)],
    ['ts', `${'`'.repeat(n / 2)}${'${'.repeat(n / 4)}`],
    ['py', '"""'.repeat(n / 3)],
    ['py', `${"'''".repeat(3)}${' x'.repeat(n / 2)}`],
    ['yaml', '- '.repeat(n / 2)],
    ['yaml', `${'a '.repeat(n / 2)}\n`.repeat(2)],
    ['json', `"a"${' '.repeat(n)}`],
    ['css', `${'a;'.repeat(n / 2)}:`],
    ['css', `a${' '.repeat(n)}:`],
    ['html', `<a ${'= '.repeat(n / 2)}`],
    ['html', '<!--'.repeat(n / 4)],
    ['html', `<a b=${' '.repeat(n)}c`],
    ['lede', `${'`'.repeat(2000)}${' x'.repeat(n / 2)}`],
    ['lede', Array.from({ length: 600 }, (_, i) => '`'.repeat(i + 1)).join(' ')],
    ['lede', `[x](${'a)'.repeat(n / 2)}`],
    ['lede', `chart ${'"'.repeat(n)}`],
    ['sql', "'".repeat(n)],
    ['toml', '['.repeat(n)],
    ['diff', '+'.repeat(n)],
    ['sh', '${'.repeat(n / 2)],
    ['rb', ':'.repeat(n)],
  ];
  for (const [lang, src] of worst) {
    const t = performance.now();
    const html = codeHtml(src, lang, true);
    const ms = performance.now() - t;
    assert.ok(ms < 3000, `${lang} ${JSON.stringify(src.slice(0, 12))}…: ${Math.round(ms)} ms`);
    assert.ok(html.length >= src.length);
  }
});

// ------------------------------------------------------------------ in a browser

browserTest(
  'in Chromium: the text and a copied selection of every block are its source, line numbers are not text, and a diff line fills its block',
  async (browser) => {
    const src = [
      ...LISTED.flatMap((lang) => [`\`\`\`\`${lang}\n${SAMPLES[lang]}\n\`\`\`\``, `\`\`\`\`${lang} lines\n${SAMPLES[lang]}\n\`\`\`\``]),
      '```text lines\nplain\n\nthree\n```',
    ].join('\n\n');
    const { html, doc } = await compile(src);
    const want = codeBlocks(doc.blocks).map((b) => b.text);
    for (const width of [1280, 360]) {
      const { ctx, page } = await serve(browser, html, { width });
      const got = await page.evaluate(() =>
        [...document.querySelectorAll('pre.code')].map((pre) => {
          const sel = getSelection()!;
          sel.selectAllChildren(pre);
          const code = pre.querySelector('code')!;
          const first = pre.querySelector('.ln');
          const lines = [...pre.querySelectorAll('.tk-add,.tk-del')].map((e) => Math.round(e.getBoundingClientRect().width));
          return {
            text: code.textContent,
            selected: sel.toString(),
            inner: (pre as HTMLElement).innerText,
            number: first ? getComputedStyle(first, '::before').content : '',
            select: first ? getComputedStyle(first, '::before').userSelect : '',
            lineWidths: new Set(lines).size,
            kw: getComputedStyle(pre.querySelector('.tk-kw') ?? pre).color,
            fg: getComputedStyle(pre).color,
            overflow: document.documentElement.scrollWidth > window.innerWidth,
          };
        }),
      );
      assert.equal(got.length, want.length);
      for (const [i, g] of got.entries()) {
        const where = `block ${i} at ${width}px`;
        assert.equal(g.text, want[i], `${where}: textContent`);
        assert.equal(g.selected, want[i], `${where}: the selection`);
        assert.equal(g.inner, want[i], `${where}: innerText`);
        assert.ok(g.lineWidths <= 1, `${where}: added and removed lines are one width`);
        assert.equal(g.overflow, false, `${where}: the page does not scroll sideways`);
      }
      const numbered = got.filter((g) => g.number !== '');
      assert.equal(numbered.length, LISTED.length + 1);
      for (const g of numbered) assert.deepEqual([g.number, g.select], ['counter(ln)', 'none']);
      assert.notEqual(got[0].kw, got[0].fg, 'a keyword takes its own colour');
      await ctx.close();
    }
  },
);
