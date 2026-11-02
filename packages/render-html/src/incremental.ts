// The incremental renderer (internal spec, lede-lang/meta): blocks go in one at a time as they become final, DOM operations come
// out with the HTML of the unit they touch, and the markup that results is the markup `render()` writes for the whole page.
// Six decisions in `render()` read the whole document; each has a rule below (prose layout, grouping, the standfirst, the
// heading shift, picks, late meta). `end()` checks the result against the whole-page render and corrects what the rules
// missed (the settle); the tests and the bench switch the correction off, so they measure the rules and not the safety net.
import type { Block, DataSet, DiagramBlock, LedeDocument } from '@lede-lang/core';
import { resolve } from '@lede-lang/core';
import {
  Ctx,
  holdsFlow,
  isProse,
  masthead,
  mayGroup,
  picksOf,
  plan,
  planAt,
  renderMain,
  type CtxMark,
  type Probe,
  type RenderOptions,
  type Unit,
} from './index.ts';
import { css } from './theme.ts';
import { inline, plain } from './util.ts';

export type IncrementalOp =
  /** Set the `<header class="mast">` (a complete element). */
  | { op: 'masthead'; html: string }
  /** Set or clear the `prose` class of `<main>`. */
  | { op: 'prose'; on: boolean }
  /** A sealed unit, after the last one and before the tail. */
  | { op: 'append'; id: number; html: string }
  /** The unit `id` is drawn again (an update, a repick, a drawing, a settle). An empty `html` means it has no element. */
  | { op: 'replace'; id: number; html: string }
  /** Units a settle no longer wants. */
  | { op: 'remove'; ids: number[] }
  /** The held and open blocks, as one run of elements; '' removes it. */
  | { op: 'tail'; html: string }
  /** A unit that holds a diagram still being written: a figure of about its height, replaced by the drawing. */
  | { op: 'placeholder'; id: number; html: string; minHeight: number }
  /** The page stylesheet (the first op, and again at `end()` if late meta changed it). */
  | { op: 'style'; css: string };

export interface Pushed {
  ops: IncrementalOp[];
  /** A drawing that is not ready: resolves to the ops that replace its placeholder. Apply in the order they were returned. */
  pending?: Promise<IncrementalOp[]>;
}

export type SettleCause = 'prose' | 'shift' | 'lead' | 'picks' | 'other';

export interface IncrementalEnd {
  ops: IncrementalOp[];
  /** Children of `<main>` the settle replaced (or would have replaced, with `settle: false`). */
  settled: number;
  /** The number of children differed: the settle replaced from the first difference to the end. */
  countMismatch: boolean;
  /** The first child that differed (0 is the header when there is one), or null. */
  firstDiff: number | null;
  /** One cause per child that differed, and 'prose' when only the class of `<main>` differed. */
  causes: SettleCause[];
  /** True when `<main>` needed no settle at all: no child, no count and no class differed. */
  equal: boolean;
  /** Units committed that the finished document groups differently. Expected 0 (the hold rule). */
  regroups: number;
  /** Units drawn again in place because the picks of the page changed. */
  repicks: number;
  /** Diagrams drawn again after a statement followed their seal. */
  reseals: number;
  /** Meta keys (accent, theme, width, title, subtitle, author, date) that changed after the first block. */
  lateMeta: number;
  /** Times the prose class went on mid-stream (0 or 1). */
  proseFlips: number;
  /** The shift was assumed, not read: an `@title` page whose first heading is below h1, taken to have no `#` of its own. */
  shiftAssumed: boolean;
  /** How long each block that was held back waited before it was committed, in `now()` units. */
  holdMs: number[];
  /** For each diagram drawn alone in its unit: its placeholder height minus the height of its drawing, in px (drawing = svg + 34). */
  placeholderError: number[];
  /** Units drawn (a unit drawn again counts again). */
  renders: number;
}

export interface Incremental {
  /** A block became final. Returns the ops that show it: its unit, or nothing while a section may still group. */
  push(block: Block): Pushed;
  /** The open blocks (`LedeStream.tail()`), after the held ones: the run of elements at the end of the page. */
  tail(blocks: Block[]): IncrementalOp[];
  /** A diagram gained statements, or a `data NAME +=` appended rows. */
  update(what: DiagramBlock | { data: string }): Pushed;
  /** No statement of this diagram is expected for now: draw it. */
  seal(d: DiagramBlock): Pushed;
  /** Commit what is held, draw what is open, apply late meta, settle. Call after the stream's own `end()`. */
  end(): Promise<IncrementalEnd>;
  /** The page as it stands (header and units, no tail), for tests and the settle. */
  mainHtml(): string;
}

export interface IncrementalOptions extends RenderOptions {
  /** Correct the page against the whole-page render at `end()`. Default true; the tests and the bench pass false. */
  settle?: boolean;
  /** The clock for hold times. Default `performance.now()`. */
  now?: () => number;
}

/** The comparison every check uses: whitespace between tags is not content; nothing else is normalized. */
export const normalize = (html: string): string => html.replace(/>\s+</g, '><').trim();

const DATA_LIKE = new Set(['chart', 'table', 'kpis', 'diagram', 'grid', 'html', 'code', 'cards', 'steps']);
const STYLE_KEYS = ['accent', 'theme', 'width'] as const;
const MAST_KEYS = ['title', 'subtitle', 'author', 'date'] as const;

/**
 * The height of the slot a diagram holds until it is drawn. A sequence diagram is 72 + 36 per message + 24 per alt/opt frame. A
 * flow diagram is 64 + 72 per layer, a layer being a step of the longest simple chain of edges so far, capped at 480. It
 * only has to be close: the figure takes `min-height`, so a taller drawing grows it once.
 */
export function estimateHeight(d: DiagramBlock): number {
  if (d.kind === 'sequence') return 72 + 36 * d.edges.length + 24 * (d.frames?.length ?? 0);
  const next = new Map<string, string[]>();
  for (const e of d.edges) {
    next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
    if (e.both) next.set(e.to, [...(next.get(e.to) ?? []), e.from]);
  }
  // Six layers already reach the cap, so the search stops there.
  let best = 1;
  const walk = (n: string, seen: Set<string>): void => {
    best = Math.max(best, seen.size);
    if (best >= 6) return;
    for (const m of next.get(n) ?? []) {
      if (seen.has(m)) continue;
      seen.add(m);
      walk(m, seen);
      seen.delete(m);
      if (best >= 6) return;
    }
  };
  for (const n of next.keys()) {
    walk(n, new Set([n]));
    if (best >= 6) break;
  }
  return Math.min(480, 64 + 72 * best);
}

const slotHtml = (h: number, wide: boolean): string =>
  `<figure class="viz dg-fig${wide ? ' wide' : ''} pending" style="min-height:${h}px" aria-busy="true"></figure>`;

const styleOf = (m: Record<string, string>): string => css({ accent: m.accent, theme: m.theme, wide: m.width === 'wide' });

/** A unit as the renderer keeps it. */
interface U {
  /** Ordinal: the index of the unit's first block among the blocks after the masthead. */
  id: number;
  n: number;
  plan: Unit;
  blocks: Block[];
  /** The ids this unit started from, so it can be drawn again with the ids it had. */
  mark: CtxMark;
  html: string;
  diagrams: DiagramBlock[];
  /** Data names a chart, table or kpi in the unit reads. */
  reads: Set<string>;
  /** The unit holds a table, which reads the page's picks. */
  picks: boolean;
  /** A later drawing supersedes an earlier one that resolves after it. */
  version: number;
}

function diagramsOf(blocks: Block[]): DiagramBlock[] {
  return blocks.flatMap((b) => (b.type === 'diagram' ? [b] : b.type === 'grid' ? b.children.filter((c) => c.type === 'diagram') : []));
}

function scan(b: Block, f: (b: Block) => void): void {
  f(b);
  if (b.type === 'grid') for (const c of b.children) scan(c, f);
  if (b.type === 'cards') for (const c of b.items) for (const k of c.blocks) scan(k, f);
}

function readsOf(blocks: Block[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks)
    scan(b, (x) => {
      if (x.type === 'chart' || x.type === 'table') out.add(x.data);
      if (x.type === 'kpis') for (const k of x.items) if (k.ref) out.add(k.ref.split('.')[0]);
    });
  return out;
}

function usesPicks(blocks: Block[]): boolean {
  let hit = false;
  for (const b of blocks) scan(b, (x) => (hit ||= x.type === 'table'));
  return hit;
}

export function createIncremental(
  meta: () => Record<string, string>,
  data: () => Record<string, DataSet>,
  opts: IncrementalOptions = {},
): Incremental {
  return new Renderer(meta, data, opts);
}

class Renderer implements Incremental {
  private readonly meta: () => Record<string, string>;
  private readonly data: () => Record<string, DataSet>;
  private readonly renderOpts: RenderOptions;
  private readonly settleOn: boolean;
  private readonly now: () => number;
  private readonly ctx: Ctx;
  private readonly doc: LedeDocument;

  /** Every block pushed (but `data`), the blocks after the masthead, and the ones still held back (a suffix of `rest`). */
  private readonly all: Block[] = [];
  private readonly rest: Block[] = [];
  private readonly held: Block[] = [];
  private readonly heldAt: number[] = [];
  private readonly heldSeq: number[] = [];
  private seq = 0;

  private readonly units: U[] = [];
  private readonly byDiagram = new Map<DiagramBlock, U>();
  /** Diagrams shown as a slot; diagrams that have been drawn at least once; the height each slot has reached. */
  private readonly open = new Set<DiagramBlock>();
  private readonly drawn = new Set<DiagramBlock>();
  private readonly minH = new Map<DiagramBlock, number>();
  /** What `ctx.slot` answers: nothing, the open and flow diagrams of a unit that is not finished, or every diagram (the tail). */
  private mode: 'none' | 'unit' | 'tail' = 'none';

  private begun = false;
  private header = '';
  private startMeta: Record<string, string> = {};
  private titleBranch = false;
  private shiftDecided = false;
  private frontier: CtxMark;
  private lastTail = '';
  private readonly dataSeen = new Set<string>();
  private drawings: Promise<unknown>[] = [];

  private prose = false;
  private proseFrozen = false;
  private proseFlips = 0;
  private shiftAssumed = false;
  private repicks = 0;
  private reseals = 0;
  private renders = 0;
  private readonly holdMs: number[] = [];
  private readonly placeholderError: number[] = [];

  constructor(meta: () => Record<string, string>, data: () => Record<string, DataSet>, opts: IncrementalOptions) {
    this.meta = meta;
    this.data = data;
    const { settle, now, ...render } = opts;
    this.renderOpts = render;
    this.settleOn = settle ?? true;
    this.now = now ?? (() => performance.now());
    this.doc = {
      get meta() {
        return meta();
      },
      get data() {
        return data();
      },
      blocks: this.all,
      diagnostics: [],
    };
    this.ctx = new Ctx(this.doc, render);
    this.frontier = this.ctx.mark();
    this.ctx.slot = (d, wide) => {
      if (this.mode === 'none') return null;
      if (this.mode === 'unit' && d.kind === 'sequence' && !this.open.has(d)) return null;
      const h = Math.max(this.minH.get(d) ?? 0, estimateHeight(d));
      this.minH.set(d, h);
      return slotHtml(h, wide);
    };
  }

  // ------------------------------------------------------------------ pushing blocks

  push(block: Block): Pushed {
    if (block.type === 'data') {
      // Defining a name again replaces the rows every chart, table and kpi reading it sees.
      const again = this.dataSeen.has(block.name);
      this.dataSeen.add(block.name);
      return again ? this.update({ data: block.name }) : { ops: [] };
    }
    this.seq++;
    const ops: IncrementalOp[] = [];
    this.all.push(block);
    let consumed = false;
    if (!this.begun) {
      const r = this.begin(block);
      ops.push(...r.ops);
      consumed = r.consumed;
    }
    if (block.type === 'heading') this.decideShift(block);
    const pending = this.repick(block, ops);
    if (consumed) return withPending(ops, pending);
    this.rest.push(block);
    this.latchProse(block, ops);
    this.held.push(block);
    this.heldAt.push(this.now());
    this.heldSeq.push(this.seq);
    const pend: Promise<IncrementalOp[]>[] = pending ? [pending] : [];
    this.commit(ops, pend, false);
    return withPending(ops, merge(pend));
  }

  /** The first block decides the style and the masthead; a heading `#` the masthead takes is not part of the body. */
  private begin(first: Block): { ops: IncrementalOp[]; consumed: boolean } {
    this.begun = true;
    const m = this.meta();
    this.startMeta = { ...m };
    const ops: IncrementalOp[] = [{ op: 'style', css: styleOf(m) }];
    const mh = masthead({ meta: m, blocks: [first], data: {}, diagnostics: [] }, this.ctx);
    const consumed = mh.rest.length === 0;
    this.titleBranch = Boolean(m.title) && !consumed;
    this.header = mh.header;
    if (mh.header) ops.push({ op: 'masthead', html: mh.header });
    this.frontier = this.ctx.mark();
    return { ops, consumed };
  }

  /**
   * With an `@title` that no `#` heading repeats, the page's `#` headings are the page's own and every heading moves down a
   * level, so the page keeps one h1. The first heading decides: an h1 that is not the title shifts; a heading below h1 means
   * the page has no `#` of its own (the common page that has an `@title`), so no shift is assumed, and an h1 that comes after
   * it is a settle case (cause `shift`).
   */
  private decideShift(h: Block & { type: 'heading' }): void {
    if (!this.titleBranch || this.shiftDecided) return;
    this.shiftDecided = true;
    if (h.level === 1) {
      if (plain(h.text).trim() !== plain(this.meta().title ?? '').trim()) this.ctx.shift = 1;
    } else this.shiftAssumed = true;
  }

  /** The prose layout is evaluated until it first becomes true, or until a block that no essay holds arrives; then it is fixed. */
  private latchProse(block: Block, ops: IncrementalOp[]): void {
    if (this.proseFrozen || this.prose) return;
    if (DATA_LIKE.has(block.type)) {
      this.proseFrozen = true;
      return;
    }
    if (this.meta().width !== 'wide' && isProse(this.rest)) {
      this.prose = true;
      this.proseFlips++;
      ops.push({ op: 'prose', on: true });
    }
  }

  /** A note or paragraph under a heading can name the choice a table is about: draw the tables again when the picks change. */
  private repick(block: Block, ops: IncrementalOp[]): Promise<IncrementalOp[]> | undefined {
    if (block.type !== 'heading' && block.type !== 'note' && block.type !== 'paragraph') return undefined;
    const picks = picksOf(this.all);
    if (picks.length === this.ctx.picks.length && picks.every((p, i) => p === this.ctx.picks[i])) return undefined;
    this.ctx.picks = picks;
    const pend: Promise<IncrementalOp[]>[] = [];
    for (const u of this.units) {
      if (!u.picks) continue;
      this.repicks++;
      const r = this.redraw(u);
      ops.push(...r.ops);
      if (r.pending) pend.push(r.pending);
    }
    return merge(pend);
  }

  /**
   * Commit the units at the front of the held blocks. A block that is not a heading is its own unit at once. A heading may start
   * a grouped unit (a FAQ, option cards, a set, pros and cons, a recommendation) that the next blocks decide, so it and
   * everything after it stay held until `mayGroup` says no, or until every section the decision read has ended.
   */
  private commit(ops: IncrementalOp[], pend: Promise<IncrementalOp[]>[], atEnd: boolean): void {
    while (this.held.length) {
      const head = this.held[0];
      let unit: Unit = { kind: 'block', block: head };
      let n = 1;
      if (head.type === 'heading' && (atEnd || mayGroup(this.held, 0, this.prose))) {
        const probe: Probe = { open: false };
        const r = planAt(this.held, 0, this.prose, atEnd ? undefined : probe);
        if (probe.open) break;
        unit = r.unit;
        n = r.n;
      }
      this.commitUnit(unit, n, ops, pend);
    }
  }

  private commitUnit(unit: Unit, n: number, ops: IncrementalOp[], pend: Promise<IncrementalOp[]>[]): void {
    const id = this.rest.length - this.held.length;
    const blocks = this.held.splice(0, n);
    const at = this.heldAt.splice(0, n);
    const seqs = this.heldSeq.splice(0, n);
    const t = this.now();
    seqs.forEach((q, i) => {
      if (q < this.seq || this.atEnd) this.holdMs.push(t - at[i]);
    });
    const u: U = {
      id,
      n,
      plan: unit,
      blocks,
      mark: this.frontier,
      html: '',
      diagrams: diagramsOf(blocks),
      reads: readsOf(blocks),
      picks: usesPicks(blocks),
      version: 0,
    };
    for (const d of u.diagrams) {
      // A diagram sealed while its unit was held back is finished already.
      if (this.sealedEarly.has(d)) this.drawn.add(d);
      else this.open.add(d);
      this.byDiagram.set(d, u);
    }
    const unfinished = u.diagrams.some((d) => this.open.has(d));
    const slotted = unfinished || u.blocks.some(holdsFlow);
    this.mode = u.diagrams.length ? 'unit' : 'none';
    u.html = this.drawUnit(unit);
    this.mode = 'none';
    this.renders++;
    this.frontier = this.ctx.mark();
    this.units.push(u);
    if (slotted) ops.push({ op: 'placeholder', id, html: u.html, minHeight: Math.max(...u.diagrams.map((d) => this.minH.get(d) ?? 0)) });
    else ops.push({ op: 'append', id, html: u.html });
    // A flow diagram that is finished already is laid out now.
    if (!unfinished && slotted) {
      const r = this.redraw(u);
      ops.push(...r.ops);
      if (r.pending) pend.push(r.pending);
    }
  }

  /** Diagrams whose seal arrived before the unit that holds them was committed. */
  private readonly sealedEarly = new Set<DiagramBlock>();

  private atEnd = false;

  /** One unit as `render()` draws it, with every diagram `ctx.slot` claims left as a slot. */
  private drawUnit(unit: Unit): string {
    if (unit.kind !== 'block') return this.ctx.unitSync(unit);
    const b = unit.block;
    // A short paragraph straight after the title is the standfirst.
    if (b.type === 'paragraph' && b === this.rest[0] && this.header !== '' && (this.prose || plain(b.text).length <= 360)) {
      return `<p class="lead">${inline(b.text)}</p>`;
    }
    return this.ctx.blockSync(this.view(b), true);
  }

  /** A kpi that reads a data name has no value until the document ends: draw it from a copy that has been resolved against the rows so far. */
  private view(b: Block): Block {
    if (b.type === 'kpis') {
      if (!b.items.some((k) => k.ref)) return b;
      const copy = { ...b, items: b.items.map((k) => ({ ...k })) };
      resolve({ meta: {}, blocks: [copy], data: this.data(), diagnostics: [] });
      return copy;
    }
    if (b.type === 'grid') {
      const kids = b.children.map((c) => this.view(c));
      return kids.every((k, i) => k === b.children[i]) ? b : { ...b, children: kids };
    }
    if (b.type === 'cards') {
      const items = b.items.map((c) => {
        const kids = c.blocks.map((k) => this.view(k));
        return kids.every((k, i) => k === c.blocks[i]) ? c : { ...c, blocks: kids };
      });
      return items.every((c, i) => c === b.items[i]) ? b : { ...b, items };
    }
    return b;
  }

  // ------------------------------------------------------------------ the open blocks

  tail(blocks: Block[]): IncrementalOp[] {
    const ops: IncrementalOp[] = [];
    const shown = [...this.held, ...blocks];
    if (!this.begun && shown.length) ops.push(...this.begin(shown[0]).ops);
    this.ctx.rewind(this.frontier);
    this.mode = 'tail';
    const first = this.rest.length === 0 && this.held.length === 0 ? blocks[0] : undefined;
    const html = shown
      .map((b) => {
        if (b.type === 'grid' && b.children.length === 0) return '';
        if (b === first && b.type === 'paragraph' && this.header !== '' && (this.prose || plain(b.text).length <= 360)) {
          return `<p class="lead">${inline(b.text)}</p>`;
        }
        return this.ctx.blockSync(this.view(b), true);
      })
      .join('');
    this.mode = 'none';
    this.ctx.rewind(this.frontier);
    if (html !== this.lastTail) {
      this.lastTail = html;
      ops.push({ op: 'tail', html });
    }
    return ops;
  }

  // ------------------------------------------------------------------ updates, seals, drawings

  update(what: DiagramBlock | { data: string }): Pushed {
    if (!('type' in what)) {
      const ops: IncrementalOp[] = [];
      const pend: Promise<IncrementalOp[]>[] = [];
      for (const u of this.units) {
        if (!u.reads.has(what.data)) continue;
        const r = this.redraw(u);
        ops.push(...r.ops);
        if (r.pending) pend.push(r.pending);
      }
      return withPending(ops, merge(pend));
    }
    const u = this.byDiagram.get(what);
    // A diagram not on the page yet, or one that is drawn already (its next seal draws it again): nothing to show.
    if (!u || !this.open.has(what)) return { ops: [] };
    if (estimateHeight(what) <= (this.minH.get(what) ?? 0)) return { ops: [] };
    return this.redraw(u);
  }

  seal(d: DiagramBlock): Pushed {
    const u = this.byDiagram.get(d);
    if (!u) {
      this.sealedEarly.add(d);
      return { ops: [] };
    }
    if (this.drawn.has(d)) this.reseals++;
    this.open.delete(d);
    this.drawn.add(d);
    return this.redraw(u);
  }

  /** Draw a unit again, with the ids it had; a flow diagram that is finished draws asynchronously. */
  private redraw(u: U): Pushed {
    this.ctx.rewind(u.mark);
    try {
      const stillOpen = u.diagrams.some((d) => this.open.has(d));
      if (!stillOpen && u.blocks.some(holdsFlow)) return this.drawLater(u);
      this.mode = stillOpen ? 'unit' : 'none';
      const html = this.drawUnit(u.plan);
      this.renders++;
      if (html === u.html) return { ops: [] };
      u.html = html;
      if (!stillOpen) this.measure(u, html);
      return { ops: [{ op: 'replace', id: u.id, html }] };
    } finally {
      this.mode = 'none';
      this.ctx.rewind(this.frontier);
    }
  }

  /** The ids are taken now, in document order; the layout resolves later and the newest drawing of a unit wins. */
  private drawLater(u: U): Pushed {
    const version = ++u.version;
    const drawing = u.plan.kind === 'block' ? this.ctx.block(this.view(u.plan.block), true) : this.ctx.unit(u.plan);
    const pending = drawing.then((html): IncrementalOp[] => {
      if (u.version !== version) return [];
      this.renders++;
      u.html = html;
      this.measure(u, html);
      return [{ op: 'replace', id: u.id, html }];
    });
    this.drawings.push(pending);
    return { ops: [], pending };
  }

  /** How far the slot was from the drawing, for a diagram that is alone in its unit. */
  private measure(u: U, html: string): void {
    if (u.diagrams.length !== 1) return;
    const h = /<svg [^>]*viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(html);
    if (h) this.placeholderError.push((this.minH.get(u.diagrams[0]) ?? 0) - (Number(h[1]) + 34));
  }

  // ------------------------------------------------------------------ the end

  mainHtml(): string {
    return this.mainOf(
      this.prose,
      this.childrenNow().map((c) => c.html),
    );
  }

  private mainOf(prose: boolean, children: string[]): string {
    return `<main class="doc${prose ? ' prose' : ''}">\n${children.filter(Boolean).join('\n')}\n</main>`;
  }

  private childrenNow(): { id: number | null; html: string }[] {
    return [{ id: null, html: this.header }, ...this.units.map((u) => ({ id: u.id, html: u.html }))].filter((c) => c.html !== '');
  }

  async end(): Promise<IncrementalEnd> {
    const ops: IncrementalOp[] = [{ op: 'tail', html: '' }];
    this.lastTail = '';
    this.seq++;
    this.atEnd = true;
    // What is held can group now: every section has ended.
    const held: Promise<IncrementalOp[]>[] = [];
    this.commit(ops, held, true);
    // Diagrams still being written are finished: the stream ended.
    const mine: Promise<IncrementalOp[]>[] = [...held];
    for (const d of this.open) {
      const r = this.seal(d);
      ops.push(...r.ops);
      if (r.pending) mine.push(r.pending);
    }
    await Promise.all(this.drawings);
    for (const more of await Promise.all(mine)) ops.push(...more);
    this.drawings = [];

    const m = this.meta();
    const lateMeta = this.applyLateMeta(m, ops);
    const regroups = this.regroups();

    // Settle: the finished document through the whole-page renderer, compared child by child.
    const doc: LedeDocument = { meta: m, blocks: this.all, data: this.data(), diagnostics: [] };
    const whole = new Ctx(doc, this.renderOpts);
    const mh = masthead(doc, whole);
    const { body, prose } = await renderMain(doc, whole, mh);
    const theirUnits = body.slice(mh.header ? 1 : 0).filter(Boolean);
    const mineUnits = this.units.filter((u) => u.html !== '');
    const causes: SettleCause[] = [];
    const edits: IncrementalOp[] = [];
    let firstDiff: number | null = null;
    let settled = 0;
    const offset = this.header ? 1 : 0;

    if (normalize(this.header) !== normalize(mh.header)) {
      firstDiff = 0;
      settled++;
      causes.push('other');
      edits.push({ op: 'masthead', html: mh.header });
    }
    let f = 0;
    while (f < Math.min(mineUnits.length, theirUnits.length) && normalize(mineUnits[f].html) === normalize(theirUnits[f])) f++;
    const countMismatch = mineUnits.length !== theirUnits.length;
    if (countMismatch) {
      // The units no longer line up: replace from the first difference to the end.
      firstDiff ??= offset + f;
      settled += Math.max(mineUnits.length, theirUnits.length) - f;
      causes.push(this.causeOf(mineUnits[f], theirUnits[f] ?? '', whole, prose));
      const stale = mineUnits.slice(f).map((u) => u.id);
      if (stale.length) edits.push({ op: 'remove', ids: stale });
      theirUnits.slice(f).forEach((html, k) => edits.push({ op: 'append', id: this.rest.length + k, html }));
    } else {
      for (let i = f; i < mineUnits.length; i++) {
        if (normalize(mineUnits[i].html) === normalize(theirUnits[i])) continue;
        firstDiff ??= offset + i;
        settled++;
        causes.push(this.causeOf(mineUnits[i], theirUnits[i], whole, prose));
        edits.push({ op: 'replace', id: mineUnits[i].id, html: theirUnits[i] });
      }
    }
    const proseChanged = prose !== this.prose;
    if (proseChanged) {
      causes.push('prose');
      edits.push({ op: 'prose', on: prose });
    }
    const equal = settled === 0 && !proseChanged;
    if (this.settleOn) ops.push(...edits);
    return {
      ops,
      settled,
      countMismatch,
      firstDiff,
      causes,
      equal,
      regroups,
      repicks: this.repicks,
      reseals: this.reseals,
      lateMeta,
      proseFlips: this.proseFlips,
      shiftAssumed: this.shiftAssumed,
      holdMs: this.holdMs,
      placeholderError: this.placeholderError,
      renders: this.renders,
    };
  }

  /** Meta written after the first block: the style is rewritten and the masthead replaced if the page's own words changed. */
  private applyLateMeta(m: Record<string, string>, ops: IncrementalOp[]): number {
    if (!this.begun) return 0;
    const differs = (k: string) => (m[k] ?? '') !== (this.startMeta[k] ?? '');
    const lateMeta = [...STYLE_KEYS, ...MAST_KEYS].filter(differs).length;
    if (STYLE_KEYS.some(differs)) ops.push({ op: 'style', css: styleOf(m) });
    if (MAST_KEYS.some(differs)) {
      const doc: LedeDocument = { meta: m, blocks: this.all, data: {}, diagnostics: [] };
      const header = masthead(doc, new Ctx(doc, this.renderOpts)).header;
      if (header !== this.header) {
        this.header = header;
        ops.push({ op: 'masthead', html: header });
      }
    }
    return lateMeta;
  }

  /** Units committed whose extent the finished document, with the same prose layout, plans otherwise. */
  private regroups(): number {
    const kept = new Set(this.units.map((u) => `${u.id}:${u.n}`));
    let at = 0;
    let n = 0;
    for (const u of plan(this.rest, this.prose)) {
      const len = u.kind === 'block' ? 1 : span(u);
      if (!kept.has(`${at}:${len}`)) n++;
      at += len;
    }
    return n;
  }

  /** Why a unit differs from the whole-page render, judged from the two pieces of markup and the state they came from. */
  private causeOf(u: U | undefined, theirs: string, whole: Ctx, prose: boolean): SettleCause {
    if (!u) return 'other';
    const mine = u.html;
    if (mine.includes('class="lead"') !== theirs.includes('class="lead"')) return 'lead';
    const levels = (h: string) => h.replace(/<(\/?)h[1-4]\b/g, '<$1h');
    if (whole.shift !== this.ctx.shift && levels(mine) === levels(theirs)) return 'shift';
    const picked = whole.picks.length !== this.ctx.picks.length || whole.picks.some((p, i) => p !== this.ctx.picks[i]);
    if (u.picks && picked) return 'picks';
    if (prose !== this.prose) return 'prose';
    return 'other';
  }
}

function span(u: Exclude<Unit, { kind: 'block' }>): number {
  if (u.kind === 'rec') return 1 + u.section.body.length;
  if (u.kind === 'proscons') return 2 + u.pro.body.length + u.con.body.length;
  return u.sections.reduce((n, s) => n + 1 + s.body.length, 0);
}

function merge(list: Promise<IncrementalOp[]>[]): Promise<IncrementalOp[]> | undefined {
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  return Promise.all(list).then((parts) => parts.flat());
}

function withPending(ops: IncrementalOp[], pending: Promise<IncrementalOp[]> | undefined): Pushed {
  return pending ? { ops, pending } : { ops };
}
