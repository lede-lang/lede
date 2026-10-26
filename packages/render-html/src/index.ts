import type {
  Block,
  LedeDocument,
  TableBlock,
  DataSet,
  KpiBlock,
  ListBlock,
  ListItem,
  HeadingBlock,
  CardsBlock,
  StepsBlock,
  Kpi,
} from '@lede-lang/core';
import { browserUrl, imageSrcKind, num, parse, type ParseOptions } from '@lede-lang/core';
import sanitizeHtml from 'sanitize-html';
import { renderChart } from './chart.ts';
import { renderFlow } from './diagram.ts';
import { renderSequence } from './sequence.ts';
import { css } from './theme.ts';
import { esc, fmtCell, inline, plain, slug, textWidth } from './util.ts';

export interface RenderOptions {
  /** Pass `html:` blocks through untouched. Default false: they are sanitized to a safe allowlist. */
  unsafeHtml?: boolean;
  /** Allow images from http(s) URLs. Default false: no remote fetches. */
  allowRemote?: boolean;
  /** Emit only the <main> body, no page shell. */
  fragment?: boolean;
}

const WIDE = new Set(['grid', 'diagram']);

export async function render(doc: LedeDocument, opts: RenderOptions = {}): Promise<string> {
  const ctx = new Ctx(doc, opts);
  const blocks = doc.blocks.filter((b) => b.type !== 'data');
  let firstH1 = blocks.find((b) => b.type === 'heading' && b.level === 1);
  const title = doc.meta.title || (firstH1 && firstH1.type === 'heading' ? plain(firstH1.text) : 'Untitled');
  const sub = doc.meta.subtitle ? `<p class="subtitle">${inline(doc.meta.subtitle)}</p>` : '';
  const by = byline(doc.meta.author, doc.meta.date);
  const head: string[] = [];
  let rest = blocks;
  // @title that no `#` heading repeats becomes the page heading, and the document's own
  // headings move down a level so the page keeps one h1.
  if (doc.meta.title && (!firstH1 || (firstH1.type === 'heading' && plain(firstH1.text).trim() !== plain(doc.meta.title).trim()))) {
    head.push(`<h1>${inline(doc.meta.title)}</h1>`, sub, by);
    if (firstH1) ctx.shift = 1;
    firstH1 = undefined;
  } else if (firstH1 && blocks[0] === firstH1) {
    head.push(await ctx.block(firstH1, true), sub, by);
    rest = blocks.slice(1);
    firstH1 = undefined;
  } else if (!firstH1) {
    head.push(sub, by);
  }
  const body: string[] = [];
  const masthead = head.filter(Boolean);
  if (masthead.length) body.push(`<header class="mast">${masthead.join('')}</header>`);
  const prose = doc.meta.width !== 'wide' && isProse(rest);
  for (const u of plan(rest, prose)) {
    if (u.kind === 'block') {
      const b = u.block;
      // A short paragraph straight after the title is the standfirst.
      const lead = b.type === 'paragraph' && b === rest[0] && masthead.length > 0 && (prose || plain(b.text).length <= 360);
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose: uid() numbers ids in document order
      body.push(lead ? `<p class="lead">${inline(b.type === 'paragraph' ? b.text : '')}</p>` : await ctx.block(b, true));
      if (b === firstH1) body.push(sub, by);
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose: uid() numbers ids in document order
    } else body.push(await ctx.unit(u));
  }
  const main = `<main class="doc${prose ? ' prose' : ''}">\n${body.filter(Boolean).join('\n')}\n</main>`;
  if (opts.fragment) return main;
  const desc = doc.meta.description ? `\n<meta name="description" content="${esc(doc.meta.description)}">` : '';
  const lang = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(doc.meta.lang ?? '') ? doc.meta.lang : 'en';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${opts.allowRemote ? "'self' data: https:" : "'self' data:"}; base-uri 'none'; form-action 'none'">
<meta name="generator" content="lede 0.1">
<title>${esc(title)}</title>${desc}
<style>${css({ accent: doc.meta.accent, theme: doc.meta.theme, wide: doc.meta.width === 'wide' })}</style>
</head>
<body>
${main}
</body>
</html>
`;
}

/** Parse and render in one call. */
export async function compile(src: string, opts: RenderOptions & ParseOptions = {}): Promise<{ html: string; doc: LedeDocument }> {
  const doc = parse(src, opts);
  return { html: await render(doc, opts), doc };
}

function byline(author?: string, date?: string): string {
  if (!author && !date) return '';
  // "Name, Role": the role follows the name, muted. The comma stays in the markup, so the byline
  // still reads as "Name, Role" as text.
  const comma = author ? author.indexOf(',') : -1;
  const a = author
    ? comma > 0 && author.slice(comma + 1).trim()
      ? `<span class="by-n">${esc(author.slice(0, comma).trim())}</span><span class="by-r">, ${esc(author.slice(comma + 1).trim())}</span>`
      : `<span class="by-n">${esc(author)}</span>`
    : '';
  const d = date ? `<time${/^\d{4}-\d{2}-\d{2}$/.test(date) ? ` datetime="${date}"` : ''}>${esc(date)}</time>` : '';
  return `<p class="byline">${[a, d].filter(Boolean).join('<span class="by-s" aria-hidden="true"> · </span>')}</p>`;
}

// ---------------------------------------------------------------- page-level inference
// Patterns writers already produce are recognized from the block sequence; there is no syntax
// for them. A page without these patterns renders block by block, as before.

type Section = { h: HeadingBlock; body: Block[] };
type Unit =
  | { kind: 'block'; block: Block }
  | { kind: 'faq'; sections: Section[] }
  | { kind: 'proscons'; pro: Section; con: Section }
  | { kind: 'cards'; sections: Section[] }
  | { kind: 'set'; sections: Section[] }
  | { kind: 'rec'; section: Section };

const PROS = /^(pros|advantages|upsides|strengths|benefits|for|do|dos|do's|what went well|went well|what worked)$/i;
const CONS =
  /^(cons|drawbacks|downsides|weaknesses|disadvantages|against|avoid|don't|dont|don'ts|donts|what (did not|didn't) go well|what went wrong|what (did not|didn't) work)$/i;

function section(bs: Block[], i: number): Section | null {
  const h = bs[i];
  if (!h || h.type !== 'heading') return null;
  let j = i + 1;
  while (j < bs.length && !(bs[j].type === 'heading' && (bs[j] as HeadingBlock).level <= h.level)) j++;
  return { h, body: bs.slice(i + 1, j) };
}

const REC = /^(recommendation|decision|verdict|conclusion)s?$/i;

/** A short Recommendation / Decision / Verdict / Conclusion section: at most 4 blocks of text, 600 characters. */
function recCard(s: Section): boolean {
  return (
    s.h.level >= 2 &&
    REC.test(plain(s.h.text).trim()) &&
    s.body.length >= 1 &&
    s.body.length <= 4 &&
    s.body.every((b) => b.type === 'paragraph' || b.type === 'list' || b.type === 'note') &&
    s.body.reduce((n, b) => n + textLen(b), 0) <= 600
  );
}

const span = (s: Section) => 1 + s.body.length;
const bulletList = (b: Block): b is ListBlock => b.type === 'list' && !b.ordered && b.items.every((i) => i.checked === null);
const boldLabel = (b: Block) => b.type === 'paragraph' && /^\*\*[^*]{1,40}\*\*:?$/.test(b.text.trim());

function plan(bs: Block[], prose = false): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < bs.length;) {
    const s = section(bs, i);
    if (s) {
      // Recommendation card: checked first, so no set or option-card run below can swallow it.
      if (recCard(s)) {
        out.push({ kind: 'rec', section: s });
        i += span(s);
        continue;
      }
      // FAQ: three or more sibling headings that are questions, each with an answer.
      const faq: Section[] = [];
      for (
        let k = i, t = section(bs, k);
        t && t.h.level === s.h.level && /\?\s*$/.test(plain(t.h.text)) && t.body.length > 0 && !t.body.some((b) => b.type === 'heading');
        k += span(t), t = section(bs, k)
      )
        faq.push(t);
      if (faq.length >= 3) {
        out.push({ kind: 'faq', sections: faq });
        i += faq.reduce((n, t) => n + span(t), 0);
        continue;
      }
      // Pros / Cons: two sibling headings, each over one bullet list.
      const t = section(bs, i + span(s));
      if (
        s.h.level > 1 &&
        PROS.test(plain(s.h.text).trim()) &&
        t &&
        t.h.level === s.h.level &&
        CONS.test(plain(t.h.text).trim()) &&
        s.body.length === 1 &&
        bulletList(s.body[0]) &&
        t.body.length === 1 &&
        bulletList(t.body[0])
      ) {
        out.push({ kind: 'proscons', pro: s, con: t });
        i += span(s) + span(t);
        continue;
      }
      // Option cards: two to six sibling h3 sections holding only short bullet lists
      // (optionally under bold labels like **Pros**).
      const cards: Section[] = [];
      for (
        let k = i, c = section(bs, k);
        c && c.h.level === 3 && cards.length < 6 && !recCard(c) && cardable(c);
        k += span(c), c = section(bs, k)
      )
        cards.push(c);
      if (cards.length >= 2) {
        out.push({ kind: 'cards', sections: cards });
        i += cards.reduce((n, c) => n + span(c), 0);
        continue;
      }
      // Parallel sections: three or more sibling sections with the same short shape
      // (principles, people, options) read as a set of cards. Not on essays.
      const set: Section[] = [];
      if (!prose && s.h.level > 1 && setable(s)) {
        for (let k = i, c = section(bs, k); c && c.h.level === s.h.level && set.length < 8; k += span(c), c = section(bs, k)) {
          if (recCard(c)) break;
          if (setable(c) && shape(c) === shape(s)) {
            set.push(c);
            continue;
          }
          // The last section may run on into closing blocks (a rule, a quote): take its matching head.
          const head = { h: c.h, body: c.body.slice(0, s.body.length) };
          if (set.length >= 2 && setable(head) && shape(head) === shape(s) && !c.body.some((b) => b.type === 'heading')) set.push(head);
          break;
        }
      }
      if (set.length >= 3) {
        out.push({ kind: 'set', sections: set });
        i += set.reduce((n, c) => n + span(c), 0);
        continue;
      }
    }
    out.push({ kind: 'block', block: bs[i] });
    i++;
  }
  return out;
}

const textLen = (b: Block): number =>
  b.type === 'paragraph' || b.type === 'quote' || b.type === 'note' || b.type === 'heading'
    ? plain(b.text).length
    : b.type === 'list'
      ? b.items.reduce((n, i) => n + plain(i.text).length, 0)
      : 0;
const shape = (s: Section) => s.body.map((b) => (b.type === 'list' ? (b.ordered ? 'ol' : 'ul') : b.type)).join(',');

function setable(s: Section): boolean {
  return (
    plain(s.h.text).length <= 70 &&
    s.body.length >= 1 &&
    s.body.length <= 3 &&
    s.body.every((b) => b.type === 'paragraph' || b.type === 'list' || b.type === 'note') &&
    s.body.reduce((n, b) => n + textLen(b), 0) <= 700
  );
}

function cardable(s: Section): boolean {
  if (plain(s.h.text).length > 60 || s.body.length === 0) return false;
  if (!s.body.every((b) => bulletList(b) || boldLabel(b)) || !s.body.some(bulletList)) return false;
  const items = s.body.flatMap((b) => (b.type === 'list' ? b.items : []));
  return items.length <= 12 && items.every((i) => plain(i.text).length <= 160);
}

/** Mostly paragraphs, no data blocks: an essay, letter or post. */
function isProse(bs: Block[]): boolean {
  if (bs.some((b) => ['chart', 'table', 'kpis', 'diagram', 'grid', 'html', 'code', 'cards', 'steps'].includes(b.type))) return false;
  const len = textLen;
  const paras = bs.filter((b) => b.type === 'paragraph');
  const pchars = paras.reduce((n, b) => n + len(b), 0);
  const all = bs.reduce((n, b) => n + len(b), 0);
  return paras.length >= 4 && pchars >= 1200 && pchars / Math.max(1, all) >= 0.6 && pchars / paras.length >= 140;
}

// "Pro: x", "**Do:** x", "Avoid: x": a verdict prefix the writer typed on a list item.
const YES = /^(\*\*)?(pros?|do|advantage|upside|strength)(:\*\*|\*\*:|:)\s*/i;
const NO = /^(\*\*)?(cons?|don't|dont|avoid|drawback|downside|weakness)(:\*\*|\*\*:|:)\s*/i;
const verdict = (t: string): 'yes' | 'no' | '' => (YES.test(t) ? 'yes' : NO.test(t) ? 'no' : '');

class Ctx {
  private n = 0;
  shift = 0;
  private ids = new Set<string>();
  private readonly doc: LedeDocument;
  private readonly opts: RenderOptions;
  private readonly picks: string[];

  constructor(doc: LedeDocument, opts: RenderOptions) {
    this.doc = doc;
    this.opts = opts;
    this.picks = picksOf(doc.blocks);
  }

  uid(prefix: string): string {
    return `${prefix}${++this.n}`;
  }

  heading(b: HeadingBlock, cls = ''): string {
    let id = slug(b.text);
    while (this.ids.has(id)) id += '-x';
    this.ids.add(id);
    const lvl = Math.min(4, b.level + this.shift);
    return `<h${lvl} id="${id}"${cls ? ` class="${cls}"` : ''}>${inline(b.text)}</h${lvl}>`;
  }

  async unit(u: Exclude<Unit, { kind: 'block' }>): Promise<string> {
    const inner = async (bs: Block[]) => (await Promise.all(bs.map((b) => this.block(b, false)))).join('');
    if (u.kind === 'faq' || u.kind === 'set') {
      const cls = u.kind === 'faq' ? 'faq' : 'set';
      const cards = await Promise.all(
        u.sections.map(async (s) => `<section class="card ${cls}">${this.heading(s.h)}${await inner(s.body)}</section>`),
      );
      // Short parallel sections sit side by side; longer ones stack like FAQ cards.
      const small = u.kind === 'set' && u.sections.every((s) => s.body.reduce((n, b) => n + textLen(b), 0) <= 240);
      return small ? `<div class="cards n3">${cards.join('')}</div>` : `<div class="faqs">${cards.join('')}</div>`;
    }
    if (u.kind === 'rec') {
      const [first, ...more] = u.section.body;
      const title = first.type === 'paragraph' && /^\*\*\S.*?\*\*/.test(first.text);
      let head: string;
      if (title) {
        const m = /^\*\*[^*]+\*\*/.exec((first as { text: string }).text)!;
        const rest = (first as { text: string }).text.slice(m[0].length).trim();
        head = `<p class="rec-t">${inline(m[0])}</p>${rest ? `<p>${inline(rest)}</p>` : ''}`;
      } else head = await inner([first]);
      return `<section class="card rec">${this.heading(u.section.h)}${head}${await inner(more)}</section>`;
    }
    if (u.kind === 'proscons') {
      const side = (s: Section, tone: 'yes' | 'no') =>
        `<section class="card pc ${tone}">${this.heading(s.h)}${list(s.body[0] as ListBlock, tone)}</section>`;
      return `<div class="cards n2">${side(u.pro, 'yes')}${side(u.con, 'no')}</div>`;
    }
    const cards = u.sections.map((s) => {
      const parts: string[] = [];
      let label: 'yes' | 'no' | '' = '';
      for (const b of s.body) {
        if (b.type === 'paragraph') {
          const t = plain(b.text).replace(/:$/, '').trim();
          label = PROS.test(t) ? 'yes' : CONS.test(t) ? 'no' : '';
          parts.push(`<p class="cl${label ? ` ${label}` : ''}">${esc(t)}</p>`);
        } else if (b.type === 'list') {
          parts.push(label ? list(b, label) : verdictGroups(b));
          label = '';
        }
      }
      return `<section class="card opt">${this.heading(s.h)}${parts.join('')}</section>`;
    });
    const n = cards.length;
    return `<div class="cards n${n === 4 || n === 2 ? 2 : 3}">${cards.join('')}</div>`;
  }

  // oxlint-disable-next-line eslint/consistent-return -- exhaustive over Block
  async block(b: Block, top: boolean): Promise<string> {
    const wide = top && WIDE.has(b.type) ? ' wide' : '';
    switch (b.type) {
      case 'heading':
        return this.heading(b);
      case 'paragraph':
        return `<p>${inline(b.text)}</p>`;
      case 'list':
        return list(b);
      case 'quote':
        return `<blockquote><p>${inline(b.text)}</p>${b.cite ? `<cite>— ${inline(b.cite)}</cite>` : ''}</blockquote>`;
      case 'note': {
        const label = { note: 'Note', warn: 'Warning', danger: 'Critical' }[b.tone];
        // A note that opens with a bold phrase uses it as its title; a plain note's "Note" label adds nothing then.
        const m = /^\*\*([^*]+[.:!?])\*\*\s*/.exec(b.text);
        if (m && m[0].length < b.text.length) {
          const lbl = b.tone === 'note' ? `<span class="sr">${label}: </span>` : `<b class="nl">${label}</b>`;
          return `<aside class="note ${b.tone} titled" role="note">${lbl}<strong class="nt">${inline(m[1])}</strong> ${inline(b.text.slice(m[0].length))}</aside>`;
        }
        return `<aside class="note ${b.tone}" role="note"><b class="nl">${label}</b>${inline(b.text)}</aside>`;
      }
      case 'rule':
        return '<hr>';
      case 'code':
        // A long line scrolls sideways, so the block takes focus and has a name (WCAG 2.1.1).
        if (!b.lang) return `<pre class="code" tabindex="0" role="region" aria-label="Code"><code>${esc(b.text)}</code></pre>`;
        return `<pre class="code" tabindex="0" role="region" aria-label="${esc(b.lang)} code" data-lang="${esc(b.lang)}"><code>${esc(b.text)}</code></pre>`;
      case 'html':
        return this.opts.unsafeHtml ? b.html : sanitize(b.html, { allowRemote: this.opts.allowRemote });
      case 'data':
        return '';
      case 'chart': {
        const d = this.doc.data[b.data];
        if (!d) return '';
        return renderChart(b, d, this.uid('c'));
      }
      case 'table': {
        const d = this.doc.data[b.data];
        return d ? table(b, d, this.picks) : '';
      }
      case 'cards':
        return this.cards(b, top);
      case 'steps':
        return steps(b);
      case 'kpis':
        return kpis(b, wide, top);
      case 'image': {
        // Judged as the browser reads the URL, so `/\host` and a leading control character count as remote.
        const kind = imageSrcKind(b.src);
        const cap = b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : '';
        if (kind === 'bad' || (kind === 'remote' && !this.opts.allowRemote)) {
          const why = kind === 'bad' ? 'Image not loaded' : 'Image not loaded (remote images are off)';
          return `<figure class="img"><div class="img-blocked" role="img" aria-label="${esc(b.alt)}">${why}: ${esc(b.alt)}</div>${cap}</figure>`;
        }
        return `<figure class="img"><img src="${esc(browserUrl(b.src))}" alt="${esc(b.alt)}" loading="lazy" decoding="async">${cap}</figure>`;
      }
      case 'grid': {
        // A chart in a cell of the 64rem (1024px) grid is drawn at the cell's own width: the grid's
        // gaps are 16px, and the figure's padding and border take 34px from the cell.
        const cellWidth = Math.floor((1024 - 16 * (b.columns - 1)) / b.columns) - 34;
        const kids = await Promise.all(
          b.children.map(async (c) => {
            const d = c.type === 'chart' && b.columns >= 2 ? this.doc.data[c.data] : undefined;
            return c.type === 'chart' && d ? renderChart(c, d, this.uid('c'), { cellWidth }) : this.block(c, false);
          }),
        );
        return `<div class="lgrid wide" style="--cols:${b.columns}">${kids.join('')}</div>`;
      }
      case 'diagram': {
        if (b.nodes.length === 0) return '';
        const svg = b.kind === 'sequence' ? renderSequence(b, this.uid('d')) : await renderFlow(b, this.uid('d'));
        return wide ? svg.replace('<figure class="viz dg-fig', '<figure class="viz dg-fig wide') : svg;
      }
    }
  }

  /**
   * v0.4 `cards`: a grid of titled cards, 2 or 3 to a row by count (4 make a 2x2), one column
   * at 720px and below like `grid`. Three to a row spans the wide column only when a card holds a chart or table. Each card's blocks
   * render as anywhere else, sized to the card: charts get the card's width, tables stack or
   * tighten against it.
   */
  async cards(b: CardsBlock, top: boolean): Promise<string> {
    const n = b.items.length;
    if (!n) return '';
    const cols = n === 1 ? 1 : n === 2 || n === 4 ? 2 : 3;
    // A trio breaks out of the text column only when a card holds a chart or table that needs the room;
    // cards of prose and bullets stay in the column (D38).
    const needsRoom = b.items.some((c) => c.blocks.some((k) => k.type === 'chart' || k.type === 'table'));
    const wide = top && cols >= 3 && needsRoom;
    const box = wide || this.doc.meta.width === 'wide' ? 1024 : 736;
    // Card padding and border take 42px; a chart figure's own padding and border take 34px.
    const inner = Math.floor((box - 16 * (cols - 1)) / cols) - 42;
    // A phone card is 400 - 32 (page gutter) - 34 (card padding, border) wide.
    const fit = Math.min(inner, 334);
    const cards = await Promise.all(
      b.items.map(async (c) => {
        const kids = await Promise.all(
          c.blocks.map(async (k) => {
            if (k.type === 'chart') {
              const d = this.doc.data[k.data];
              return d ? renderChart(k, d, this.uid('c'), { cellWidth: inner - 34 }) : '';
            }
            if (k.type === 'table') {
              const d = this.doc.data[k.data];
              return d ? table(k, d, this.picks, fit) : '';
            }
            return this.block(k, false);
          }),
        );
        const rec = /recommended/i.test(plain(c.title)) ? ' rec' : '';
        const h = this.heading({ type: 'heading', level: 3, text: c.title, line: c.line });
        return `<section class="card lc${rec}">${h}${kids.join('')}</section>`;
      }),
    );
    return `<div class="cards lcards${wide ? ' wide' : ''}" style="--cols:${cols}">${cards.join('')}</div>`;
  }
}

// ---------------------------------------------------------------- steps and chips

/** v0.4 `step` lines: numbered step cards; the deadline is always a chip, a status word a status chip. */
function steps(b: StepsBlock): string {
  if (!b.items.length) return '';
  const items = b.items
    .map((s, i) => {
      const due = s.due.trim() ? chip(s.due, true) : '';
      const note = s.note.trim() ? `<div class="sn">${inline(s.note)}</div>` : '';
      return `<li><span class="n">${i + 1}</span><div class="st"><b>${inline(s.title)}</b>${due}</div>${note}</li>`;
    })
    .join('');
  return `<ol class="steps cards sx">${items}</ol>`;
}

// A date or time phrase: an optional lead word (by, due, until), then only date/time tokens.
// At least one token must be unambiguous (a clock time, an ISO date, a month or weekday name,
// today/tomorrow/EOD, Q3, week 4); bare numbers and years only ride along.
const MONTHS =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const WDAYS = 'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?';
const STRONG = new RegExp(
  `^(?:\\d{4}-\\d{2}-\\d{2}(?:t\\d{1,2}:\\d{2}(?::\\d{2})?z?)?|\\d{1,2}:\\d{2}(?::\\d{2})?(?:[ap]\\.?m\\.?)?(?:[-–]\\d{1,2}:\\d{2})?|\\d{1,2}(?:[ap]\\.?m\\.?)|(?:${MONTHS})\\.?|(?:${WDAYS})\\.?|today|tonight|tomorrow|yesterday|eod|eow|eom|cob|noon|midnight|q[1-4]|h[12]|fy\\d{2,4}|t[+-]\\d\\S*|\\u0003)$`,
  'i',
);
const WEAK = /^(?:\d{1,2}(?:st|nd|rd|th)?|\d{4}|utc(?:[+-]\d{1,2})?|gmt|[ecmp][sd]t|bst|cet|cest|ist|z|at|on|of|the|-|–|—|to)$/i;
const PHRASE = new RegExp(
  `\\b(?:end of (?:day|week|month|quarter|year|sprint)|(?:this|next|last) (?:week|month|quarter|year|sprint|${WDAYS})|(?:week|day|sprint) \\d+)\\b`,
  'gi',
);
const LEAD_WORD = /^(?:by|due|due by|until|till|before|after|from|starting|starts|ends?|eta|deadline|no later than|nlt)\s*:?\s+/i;

export function dateLike(raw: string): boolean {
  let t = plain(raw).trim().replace(/[.]$/, '');
  if (!t || t.length > 40) return false;
  t = t.replace(PHRASE, ' \u0003 ').trim().replace(LEAD_WORD, '');
  const toks = t.split(/[\s,/]+/).filter(Boolean);
  if (!toks.length || !toks.every((k) => STRONG.test(k) || WEAK.test(k))) return false;
  return toks.some((k) => STRONG.test(k));
}

/** A status word as a status pill, a date/time phrase as a neutral chip; `force` chips any text. */
function chip(raw: string, force = false): string {
  const hit = statusOf(raw);
  if (hit) return `<span class="pill ${hit}">${inline(raw)}</span>`;
  if (force || dateLike(raw)) return `<span class="chip">${inline(raw)}</span>`;
  return '';
}

// ---------------------------------------------------------------- lists

function li(i: ListItem, inner = '', cls = ''): string {
  const text = inline(i.text);
  const v = verdict(i.text);
  const c = [...new Set([cls, v, i.checked === null ? '' : 't'].filter(Boolean))].join(' ');
  const attr = c ? ` class="${c}"` : '';
  if (i.checked === null) return `<li${attr}>${text}${inner}</li>`;
  return `<li${attr}><span class="box-c${i.checked ? ' on' : ''}" role="img" aria-label="${i.checked ? 'done' : 'not done'}"></span><span>${text}</span>${inner}</li>`;
}

const LEAD = /^\*\*(\S(?:.*?\S)?)\*\*/;

/** An ordered list whose every item opens with a bold lead-in and has sub-items or at least 120 characters. */
function stepCards(b: ListBlock, groups: { parent: ListItem; subs: ListItem[] }[]): boolean {
  return (
    b.ordered &&
    groups.length > 0 &&
    groups.every(
      ({ parent, subs }) => parent.checked === null && LEAD.test(parent.text) && (subs.length > 0 || plain(parent.text).length >= 120),
    )
  );
}

/** Group flat `level: 2` runs under their parent item; `tone` marks every item as a pro or a con. */
function list(b: ListBlock, tone?: 'yes' | 'no'): string {
  const out: string[] = [];
  const items = b.items;
  const groups: { parent: ListItem; subs: ListItem[] }[] = [];
  for (let k = 0; k < items.length;) {
    const parent = items[k++];
    const subs: ListItem[] = [];
    while (k < items.length && items[k].level === 2) subs.push(items[k++]);
    groups.push({ parent, subs });
  }
  const cards = !tone && stepCards(b, groups);
  for (const [gi, { parent, subs }] of groups.entries()) {
    let inner = '';
    if (subs.length) {
      const ord = subs[0].ordered === true;
      const tasks = subs.some((s) => s.checked !== null);
      const kids = subs.map((s) => li(s)).join('');
      inner = ord
        ? `<ol class="sub${b.ordered ? ' nested' : ' alpha'}${tasks ? ' tasks' : ''}">${kids}</ol>`
        : `<ul class="sub${tasks ? ' tasks' : ''}">${kids}</ul>`;
    }
    if (cards) {
      const m = LEAD.exec(parent.text) as RegExpExecArray;
      const text = parent.text.slice(m[0].length).trim();
      const body = `${text ? inline(text) : ''}${inner}`;
      out.push(`<li><span class="n">${b.start + gi}</span><b>${inline(m[1])}</b>${body ? `<div>${body}</div>` : ''}</li>`);
    } else out.push(li(parent, inner, tone ?? ''));
  }
  const top = items.filter((i) => i.level !== 2);
  const tasks = top.some((i) => i.checked !== null);
  const cls = [tasks ? 'tasks' : '', tone ? `marks ${tone}` : '', !tone && top.some((i) => verdict(i.text)) ? 'marks' : '']
    .filter(Boolean)
    .join(' ');
  if (cards)
    return `<ol class="steps cards"${b.start !== 1 ? ` start="${b.start}" style="counter-reset:step ${b.start - 1}"` : ''}>${out.join('')}</ol>`;
  if (b.ordered)
    return `<ol${b.start !== 1 ? ` start="${b.start}" style="counter-reset:step ${b.start - 1}"` : ''}${tasks ? ' class="tasks"' : ''}>${out.join('')}</ol>`;
  return `<ul${cls ? ` class="${cls}"` : ''}>${out.join('')}</ul>`;
}

/** A card list whose items carry Pro:/Con: prefixes splits into labelled groups, prefix dropped. */
function verdictGroups(b: ListBlock): string {
  const top = b.items.filter((i) => i.level !== 2);
  if (!top.some((i) => verdict(i.text)) || b.items.some((i) => i.level === 2)) return list(b);
  const out: string[] = [];
  let run: ListItem[] = [];
  let cur = '';
  const flush = () => {
    if (!run.length) return;
    const tone = cur as 'yes' | 'no' | '';
    const isPro = run.every((i) => /^(\*\*)?pros?\b/i.test(i.text));
    const isCon = run.every((i) => /^(\*\*)?cons?\b/i.test(i.text));
    if (isPro || isCon) out.push(`<p class="cl ${tone}">${isPro ? 'Pros' : 'Cons'}</p>`);
    const items = run.map((i) =>
      isPro || isCon ? { ...i, text: i.text.replace(tone === 'yes' ? YES : NO, '').replace(/^[a-z]/, (c) => c.toUpperCase()) } : i,
    );
    out.push(tone ? list({ ...b, items }, tone) : list({ ...b, items }));
    run = [];
  };
  for (const i of top) {
    const v = verdict(i.text);
    if (v !== cur) flush();
    cur = v;
    run.push(i);
  }
  flush();
  return out.join('');
}

// ---------------------------------------------------------------- metrics

// A change that starts with a sign or a number is a delta; anything else is a short note.
const DELTA = /^[+\-−±▲▼↑↓]?\s*[$€£¥]?\d/;

function kpis(b: KpiBlock, wide: string, top: boolean): string {
  const hero = top && b.items.length === 1;
  const cells = b.items.map((k) => {
    const dir = /^[+▲↑]/.test(k.delta) ? 'up' : /^[-−▼↓]/.test(k.delta) ? 'down' : '';
    const glyph = dir === 'up' ? '▲ ' : dir === 'down' ? '▼ ' : '';
    const tone = k.tone && k.tone !== 'neutral' ? ` ${k.tone}` : '';
    const sr = k.tone === 'good' ? '<span class="sr"> (good)</span>' : k.tone === 'bad' ? '<span class="sr"> (bad)</span>' : '';
    // A field that is only a status word or a date/time phrase is a chip (F.5), checked before
    // DELTA, which would take "2026-05-18" or "03:00" for a change.
    const dchip = k.delta ? chip(k.delta) : '';
    const isDelta = !dchip && DELTA.test(k.delta);
    const delta = k.delta && isDelta ? `<span class="kd${tone}">${glyph}${inline(k.delta.replace(/^[▲▼↑↓]\s*/, ''))}${sr}</span>` : '';
    const notes = [k.delta && !isDelta ? `${dchip || inline(k.delta)}${sr}` : '', k.note ? chip(k.note) || inline(k.note) : ''].filter(
      Boolean,
    );
    // With no numeric change to carry it, the tone describes the metric itself.
    const vt = tone && (!isDelta || hero) ? tone : '';
    // The value is formatted, then its visible length goes out as --kvn so CSS can size it to fit.
    // A value of 5 characters or fewer cannot overflow at any size, so it carries no count and
    // CSS falls back to the cap.
    // A bare four-digit 1900-2100 value is a year far more often than a count.
    const value = /^(19|20)\d{2}$/.test(k.value.trim()) ? k.value : fmtCell(k.value, k.label);
    const n = Array.from(plain(value)).length;
    // Text values (names, ids, regions) wrap instead of shrinking below a readable size.
    const long = /[A-Za-z]{4,}/.test(value) && n > 8 ? ' long' : '';
    return `<div class="kpi${hero ? ' hero' : ''}"><span class="kl">${inline(k.label)}</span><span class="kv${long}${vt}"${n > 5 ? ` style="--kvn:${n}"` : ''}>${inline(value)}</span>${k.bar ? kbar(k.value, k.tone) : ''}${delta}${notes.map((note) => `<span class="kn">${note}</span>`).join('')}</div>`;
  });
  return `<div class="kpis${hero ? ' solo' : ''}${wide}">${cells.join('')}</div>`;
}

/** `kpi ... | bar`: a progress bar under the value, filled to a percent or a 0-100 number. */
function kbar(value: string, tone: Kpi['tone']): string {
  const v = num(value);
  if (v === null || v < 0 || v > 100 || !/^\s*[+-]?[\d.,]+\s*%?\s*$/.test(plain(value))) return '';
  const t = tone ? ` ${tone}` : '';
  return `<span class="kbar${t}" aria-hidden="true"><i style="width:${Math.round(v * 10) / 10}%"></i></span>`;
}

// ---------------------------------------------------------------- tables

const BOLD_CELL = /^\s*\*\*[^*]+\*\*\s*$/;

/** Names a page recommends: a note or paragraph opening "Choose X", "Recommend X", "Go with X", "Use X". */
function picksOf(bs: Block[]): string[] {
  // A note may say "Choose X" anywhere; a paragraph counts only under a Recommendation or
  // Decision heading, and only there does a plain imperative ("Use X") count, since runbooks
  // are full of "Use X" steps.
  const out: string[] = [];
  let underRec = false;
  for (const b of bs) {
    if (b.type === 'heading') underRec = /recommend|decision|verdict|choice|conclusion/i.test(b.text);
    if (b.type !== 'note' && !(b.type === 'paragraph' && underRec)) continue;
    const verbs = underRec
      ? 'choose|recommend(?:ation)?:?|go with|pick|adopt|use|buy|select'
      : 'choose|recommend(?:ation)?:?|go with|pick|adopt';
    const m = new RegExp(
      `^(?:we\\s+)?(?:${verbs})\\s+(.+?)(?:[.,;:!(]|\\s+(?:with|because|mainly|for|over|as|and|now|today|instead)\\b|$)`,
      'i',
    ).exec(
      plain(b.text)
        .replace(/^\s*recommendation:\s*/i, 'choose ')
        .trim(),
    );
    if (m && m[1].length <= 40) out.push(m[1].trim().toLowerCase());
  }
  return out;
}

function keyMatch(cellText: string, pick: string): boolean {
  const c = cellText
    .trim()
    .toLowerCase()
    .replace(/\s*\(.*\)$/, '');
  if (!c || !pick) return false;
  const re = (s: string) => new RegExp(`(^|\\W)${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`);
  return c === pick || re(pick).test(c) || re(c).test(pick);
}

const TIME_LIKE =
  /^(\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?|day \d+|week \d+|t\+.+)$/i;

/** A two-column table whose first column is a time in every row reads as a vertical timeline. */
function timeLike(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => TIME_LIKE.test(plain(c).trim()));
}

function timeline(b: TableBlock, rows: string[][], idx: number[], head0: string): string {
  const items = rows
    .map((r) => {
      const [t, e] = [r[idx[0]] ?? '', r[idx[1]] ?? ''];
      const em = BOLD_CELL.test(t) || BOLD_CELL.test(e);
      return `<li${em ? ' class="em"' : ''}><time>${inline(t)}</time><span>${cell(e)}</span></li>`;
    })
    .join('');
  const cap = b.title ? `<p class="tl-cap">${inline(b.title)}</p>` : '';
  // A header such as "Time (UTC)" carries information the rows do not repeat: keep it as a note.
  const unit = /\(.+\)/.test(plain(head0)) ? `<p class="tl-unit">${inline(head0)}</p>` : '';
  return `<div class="tlwrap">${cap}${unit}<ol class="timeline">${items}</ol></div>`;
}

/** Heat step 1..5 for each value by rank within its column; ties share the average rank. */
function heatLevels(vals: (number | null)[]): (number | null)[] {
  const xs = vals.filter((v): v is number => v !== null).toSorted((a, c) => a - c);
  const n = xs.length;
  return vals.map((v) => {
    if (v === null) return null;
    if (n < 2) return 3;
    const first = xs.indexOf(v);
    const mean = first + (xs.lastIndexOf(v) - first) / 2;
    return 1 + Math.round((mean / (n - 1)) * 4);
  });
}

/**
 * Bar length as a percent of the cell: the value itself when every value ends in %, else value /
 * column max. `targets` (from `target=`) share the scale: they raise the max (or, for percents,
 * the 100 the bars are measured against) and come back on the same scale as `ticks`.
 */
function barPercents(raws: string[], targets: (number | null)[] = []): (string | null)[] & { ticks?: (string | null)[] } {
  const filled = raws.filter((r) => r !== '');
  const pct = filled.length > 0 && filled.every((r) => /%\s*$/.test(r));
  const vals = raws.map((r) => (r === '' ? null : num(r)));
  const tmax = Math.max(0, ...targets.filter((v): v is number => v !== null));
  const max = pct ? Math.max(100, tmax) : Math.max(0, tmax, ...vals.filter((v): v is number => v !== null));
  const at = (v: number | null) => {
    if (v === null) return null;
    const p = max > 0 ? (v / max) * 100 : 0;
    return `${Math.round(Math.min(100, Math.max(0, p)) * 10) / 10}%`;
  };
  const out: (string | null)[] & { ticks?: (string | null)[] } = vals.map(at);
  if (targets.length) out.ticks = targets.map(at);
  return out;
}

/** `fit`: the narrowest width the table must read at (the 368px phone column, or a card). */
function table(b: TableBlock, d: DataSet, picks: string[] = [], fit = 364): string {
  const cols = b.cols ?? d.columns;
  let rows = [...d.rows];
  if (b.sort) {
    const i = d.columns.indexOf(b.sort.col);
    const numeric = rows.every((r) => r[i] === '' || num(r[i]) !== null);
    rows.sort((r1, r2) => {
      const c = numeric ? (num(r1[i]) ?? -Infinity) - (num(r2[i]) ?? -Infinity) : r1[i].localeCompare(r2[i]);
      return b.sort!.desc ? -c : c;
    });
  }
  if (b.limit) rows = rows.slice(0, b.limit);
  const idx = cols.map((c) => d.columns.indexOf(c));
  if (!b.heat && !b.bars && cols.length === 2 && rows.length > 0 && rows.length <= 14 && timeLike(rows.map((r) => r[idx[0]] ?? '')))
    return timeline(b, rows, idx, cols[0]);
  const numeric = idx.map((i) => rows.length > 0 && rows.every((r) => r[i] === '' || num(r[i]) !== null) && rows.some((r) => r[i] !== ''));
  // A column of bare four-digit 1900-2100 integers is a column of years, whatever its header says.
  const yearCol = idx.map(
    (i) => rows.length > 0 && rows.every((r) => r[i] === '' || /^(19|20)\d{2}$/.test((r[i] ?? '').trim())) && rows.some((r) => r[i] !== ''),
  );
  const hdr = cols.map((c, j) => (yearCol[j] ? 'year' : c));
  // The first column names the row when it is text or a unique key (a version, a year): a row
  // header, left-aligned, sticky when the table scrolls.
  const rowHead = cols.length > 1 && (!numeric[0] || new Set(rows.map((r) => r[idx[0]])).size === rows.length);
  if (rowHead) numeric[0] = false;
  // Short single-token values (dates, ids, versions) never break mid-token.
  const nowrap = idx.map(
    (i, j) => !numeric[j] && rows.length > 0 && rows.every((r) => !/\s/.test(plain(r[i] ?? '').trim()) && plain(r[i] ?? '').length <= 16),
  );
  // Phone: the table's width in the compact phone style (13px cells, headers wrapping between
  // words). Wider than the 368px column, it stacks into one labelled card per row.
  const words = (s: string) => plain(s).split(/\s+/);
  const est = idx.reduce((sum, i, j) => {
    const head = Math.max(...words(cols[j]).map((w) => textWidth(w.toUpperCase(), 11, { bold: true }) * 1.1));
    const cellW = (raw: string) => {
      const chipped = !!statusOf(raw) || (!(j === 0 && rowHead) && dateLike(raw));
      // A date chip is bold with a border and 8px side padding, wider than a status pill: 38 keeps a date column from overflowing at 400px.
      const full = Math.max(
        textWidth(plain(fmtCell(raw, hdr[j])), 13) + (statusOf(raw) ? 24 : chipped ? 38 : 0),
        b.bars?.includes(cols[j]) ? 80 : 0,
      );
      if (numeric[j] || nowrap[j] || chipped) return full;
      return Math.min(full, Math.max(100, ...words(raw).map((w) => textWidth(w, 13))));
    };
    // 6% margin: the width table is approximate, and a near miss scrolls sideways.
    return sum + Math.max(head, ...rows.map((r) => cellW(r[i] ?? ''))) * 1.06 + 14;
  }, 0);
  // A number-heavy table that nearly fits stays a table in a tighter style (12px, 5px padding):
  // twelve stacked cards of four numbers read worse than one dense grid.
  const numCols = numeric.filter(Boolean).length;
  const tightW = ((est - 14 * cols.length) * 12) / 13 + 10 * cols.length;
  const tight = est > fit && numCols * 2 >= cols.length - 1 && tightW <= fit - 2;
  const stack = cols.length >= 3 && est > fit && !tight;
  // Stacked cards set short fields two to a line, label above value.
  // per column, so every card has the same layout.
  const wideCol = idx.map((i, j) => plain(cols[j]).length > 26 || rows.some((r) => plain(r[i] ?? '').length > 20));
  // Emphasis inferred from content: a fully bold cell marks the chosen row; a blocking status
  // word marks a problem row. Only a minority of rows is ever emphasized.
  const marks = rows.map((r) => {
    const cells = idx.map((i) => r[i] ?? '');
    if (cells.some((c) => statusOf(c) === 'bad')) return 'bad';
    if (cells.some((c) => statusOf(c) === 'warn' && /^(at risk|delayed|slipping|behind|overdue)$/i.test(norm(c)))) return 'warn';
    if (cells.some((c) => BOLD_CELL.test(c))) return 'pick';
    return '';
  });
  // A pick that equals a column header tints that column instead of a row.
  const colKey = (j: number) => plain(cols[j]).trim().toLowerCase();
  const pickCol = cols.map((_, j) => rowHead && j > 0 && picks.includes(colKey(j)));
  // "Choose X." elsewhere on the page names the chosen row when exactly one row's key matches.
  if (rowHead && !marks.includes('pick')) {
    for (const p of picks) {
      if (cols.some((_, j) => j > 0 && colKey(j) === p)) continue;
      const hit = rows.map((r, ri) => (keyMatch(plain(r[idx[0]] ?? ''), p) ? ri : -1)).filter((ri) => ri >= 0);
      if (hit.length === 1 && !marks[hit[0]]) {
        marks[hit[0]] = 'pick';
        break;
      }
    }
  }
  // heat: numeric columns tinted by rank; bar=: numeric columns drawn as inline bars.
  const byName = (want: string[]) => cols.map((c) => want.some((w) => plain(w).trim().toLowerCase() === plain(c).trim().toLowerCase()));
  const heatOn = !b.heat ? cols.map(() => false) : b.heat === true ? cols.map(() => true) : byName(b.heat);
  const barOn = b.bars?.length ? byName(b.bars) : cols.map(() => false);
  const level = cols.map((_, j) => (heatOn[j] && numeric[j] ? heatLevels(rows.map((r) => (r[idx[j]] ? num(r[idx[j]]) : null))) : null));
  // target=col: each row's tick on its bar, on the bar's scale. Ignored without bars or when the
  // column is missing or not numeric.
  const ti = b.targetCol && b.bars?.length ? d.columns.indexOf(b.targetCol) : -1;
  const tvals =
    ti >= 0 && rows.some((r) => (r[ti] ?? '').trim() !== '') && rows.every((r) => (r[ti] ?? '').trim() === '' || num(r[ti]) !== null)
      ? rows.map((r) => ((r[ti] ?? '').trim() === '' ? null : num(r[ti])))
      : [];
  const bar = cols.map((_, j) =>
    barOn[j] && numeric[j]
      ? barPercents(
          rows.map((r) => (r[idx[j]] ?? '').trim()),
          tvals,
        )
      : null,
  );
  const hot = marks.filter(Boolean).length;
  const use = hot > 0 && hot * 2 <= rows.length;
  const role = (r: string) => (stack ? ` role="${r}"` : '');
  const head = cols
    .map(
      (c, j) =>
        `<th scope="col"${numeric[j] || pickCol[j] ? ` class="${[numeric[j] ? 'n' : '', pickCol[j] ? 'pick' : ''].filter(Boolean).join(' ')}"` : ''}${role('columnheader')}>${inline(c)}</th>`,
    )
    .join('');
  const body = rows
    .map((r, ri) => {
      const cells = idx
        .map((i, j) => {
          const label = stack ? ` data-label="${esc(plain(cols[j]))}"` : '';
          if (j === 0 && rowHead) return `<th scope="row"${role('rowheader')}>${cell(r[i] ?? '', hdr[j])}</th>`;
          const lv = level[j]?.[ri];
          const tc = [
            numeric[j] ? 'n' : nowrap[j] ? 'nw' : '',
            stack && wideCol[j] ? 'w' : '',
            lv ? `h${lv}` : '',
            pickCol[j] ? 'pick' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const bp = bar[j]?.[ri];
          const tk = bar[j]?.ticks?.[ri];
          const tick = tk
            ? `<b class="tg" style="--t:${tk}"><span class="sr">target ${esc(fmtCell((r[ti] ?? '').trim(), plain(b.targetCol ?? '')))}</span></b>`
            : '';
          const inner = bp
            ? `<span class="cb${tick ? ' tgt' : ''}" style="--p:${bp}"><i></i>${tick}${cell(r[i] ?? '', hdr[j], true)}</span>`
            : cell(r[i] ?? '', hdr[j], true);
          return `<td${tc ? ` class="${tc}"` : ''}${label}${role('cell')}>${inner}</td>`;
        })
        .join('');
      const m = use ? marks[ri] : '';
      return `<tr${m ? ` class="hl ${m}"` : ''}${role('row')}>${cells}</tr>`;
    })
    .join('');
  const cap = b.title ? `<caption>${inline(b.title)}</caption>` : '';
  // Five or more short fields per card go three to a line.
  const trio = stack && !wideCol.some(Boolean) && cols.length - (rowHead ? 1 : 0) >= 5;
  const cls = ['lt', stack ? 'stack' : '', trio ? 'trio' : '', tight ? 'tight' : '', rowHead ? 'rh' : ''].filter(Boolean).join(' ');
  const legend = level.some(Boolean)
    ? '<div class="heat-legend"><i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i><i class="h5"></i> low → high</div>'
    : '';
  const tbl = `<div class="scroll tbl${stack ? ' stack' : ''}" tabindex="0" role="region" aria-label="${esc(plain(b.title ?? (d.name.startsWith('_') ? 'Table' : `${d.name} table`)))}"><table class="${cls}"${role('table')}>${cap}<thead${role('rowgroup')}><tr${role('row')}>${head}</tr></thead><tbody${role('rowgroup')}>${body}</tbody></table></div>`;
  return legend ? `<div class="tblx">${tbl}${legend}</div>` : tbl;
}

// Status words in a table cell render as a labeled pill. The word stays the text, so the
// meaning never depends on color; writers get this for free by typing the status.
const STATUS: [RegExp, 'good' | 'warn' | 'bad' | 'info'][] = [
  [
    /^(done|complete|completed|shipped|ready|on track|pass|passed|passing|go|healthy|ok|green|approved|live|resolved|met|available|enabled|stable|fixed|merged|recommended|chosen|winner|ahead)$/i,
    'good',
  ],
  [
    /^(at risk|in progress|pending|partial|degraded|yellow|amber|in review|review|delayed|slipping|warning|investigating|monitoring|planned|draft|beta|watch|mitigated|behind|caution)$/i,
    'warn',
  ],
  [
    /^(blocked|failed|fail|failing|no-go|no go|not ready|not met|off track|red|critical|breached|missed|down|outage|rejected|deprecated|overdue|open incident|sev1|sev 1|p0|exhausted)$/i,
    'bad',
  ],
  [/^(not started|todo|to do|tbd|skipped|paused|on hold)$/i, 'info'],
];

const norm = (raw: string) => plain(raw).trim().replace(/[.!]$/, '');
const statusOf = (raw: string) => STATUS.find(([re]) => re.test(norm(raw)))?.[1];

/** `dates`: a cell that is only a date/time phrase becomes a neutral chip (not in row headers or timelines). */
function cell(raw: string, header = '', dates = false): string {
  const hit = statusOf(raw);
  if (hit) return `<span class="pill ${hit}">${inline(raw)}</span>`;
  if (dates && dateLike(raw)) return `<span class="chip">${inline(raw)}</span>`;
  return inline(fmtCell(raw, header));
}

const ALLOWED = {
  allowedTags: [
    'a',
    'abbr',
    'b',
    'blockquote',
    'br',
    'caption',
    'cite',
    'code',
    'col',
    'colgroup',
    'dd',
    'del',
    'details',
    'dfn',
    'div',
    'dl',
    'dt',
    'em',
    'figcaption',
    'figure',
    'h2',
    'h3',
    'h4',
    'hr',
    'i',
    'img',
    'ins',
    'kbd',
    'li',
    'mark',
    'ol',
    'p',
    'pre',
    's',
    'samp',
    'small',
    'span',
    'strong',
    'sub',
    'summary',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'time',
    'tr',
    'u',
    'ul',
    'var',
    'progress',
    'meter',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
    time: ['datetime'],
    progress: ['value', 'max'],
    meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
    '*': ['class', 'id', 'title', 'lang'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Images: data: URIs and relative paths only. A remote src is a fetch the viewer's browser
  // makes on load, which is how injected content exfiltrates data, so it needs allowRemote.
  allowedSchemesByTag: { img: ['data'] },
  allowProtocolRelative: false,
  // The data: scheme is allowed for images only, so a data: src that is not an image is dropped (D49).
  transformTags: {
    img: (tagName: string, attribs: sanitizeHtml.Attributes) => {
      const { src, ...rest } = attribs;
      return { tagName, attribs: src === undefined || imageSrcKind(src) !== 'bad' ? attribs : rest };
    },
  },
};

export function sanitize(html: string, opts: { allowRemote?: boolean | undefined } = {}): string {
  if (!opts.allowRemote) return sanitizeHtml(html, ALLOWED);
  return sanitizeHtml(html, { ...ALLOWED, allowedSchemesByTag: { img: ['data', 'http', 'https'] } });
}

export { css } from './theme.ts';
export { layoutFlow } from './diagram.ts';
export { niceTicks } from './chart.ts';
