// The incremental renderer (internal spec, lede-lang/meta): blocks go in one at a time as they become final, DOM operations come
// out with the HTML of the unit they touch, and the markup that results is the markup `render()` writes for the whole page.
// Six decisions in `render()` read the whole document; each has a rule below (prose layout, grouping, the standfirst, the
// heading shift, picks, late meta). The question words and the editor words add a seventh, the `export` (see `reexport`), and a
// block that grows besides the diagram, the bucket set (see `grew`). `end()` checks the result against the whole-page render and
// corrects what the rules missed (the settle); the tests and the bench switch the correction off, so they measure the rules and not
// the safety net.
import type { Block, BucketBlock, DataSet, DiagramBlock, LedeDocument, PresetBlock, QuestionBlock } from '@lede-lang/core';
import { FIELD_KINDS, resolve, walkBlocks } from '@lede-lang/core';
import {
  Ctx,
  NOT_ESSAY,
  holdsFlow,
  isWide,
  masthead,
  mayGroup,
  pickStep,
  planAt,
  proseShape,
  renderMain,
  standfirst,
  styleOf,
  tallyProse,
  type CtxMark,
  type Masthead,
  type PickScan,
  type Probe,
  type ProseTally,
  type RenderOptions,
  type Section,
  type Unit,
} from './index.ts';
import { usesEditors } from './question.ts';
import { plain } from './util.ts';

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

/**
 * Why a child of `<main>` was settled. `masthead`: the header, or the heading that carries the subtitle and byline, which the
 * first block alone could not decide (the first `#` heading came later and rules out or moves the header).
 */
export type SettleCause = 'prose' | 'shift' | 'lead' | 'picks' | 'masthead' | 'other';

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
  /** Of the blocks that waited, how many were committed inside a grouped unit, and how many as plain blocks (the wait bought nothing). */
  heldGrouped: number;
  heldPlain: number;
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
  /** A diagram gained statements, a bucket set gained an item, or a `data NAME +=` appended rows. */
  update(what: DiagramBlock | BucketBlock | { data: string }): Pushed;
  /** No statement of this diagram is expected for now: draw it. A bucket set is drawn in full by every update, so its seal adds nothing. */
  seal(d: DiagramBlock | BucketBlock): Pushed;
  /** Commit what is held, draw what is open, apply late meta, settle. Call after the stream's own `end()`. */
  end(): Promise<IncrementalEnd>;
}

/**
 * The options of `render()`. Its `shell` has no effect here: the viewer draws the ordinary page, which is what `render()` writes for a
 * `fragment` (the shell never acts on one). Handing the page to the shell runtime after `end()` is later work (internal spec,
 * lede-lang/meta).
 */
export interface IncrementalOptions extends RenderOptions {
  /** Correct the page against the whole-page render at `end()`. Default true; the tests and the bench pass false. */
  settle?: boolean;
  /** The clock for hold times. Default `performance.now()`. */
  now?: () => number;
}

/** The comparison every check uses: whitespace between tags is not content; nothing else is normalized. */
export const normalize = (html: string): string => html.replace(/>\s+</g, '><').trim();

const STYLE_KEYS = ['accent', 'theme', 'width'] as const;
const MAST_KEYS = ['title', 'subtitle', 'author', 'date'] as const;

/**
 * The height of the slot a diagram holds until it is drawn. A sequence diagram is 72 + 36 per message + 24 per alt/opt frame. A
 * flow diagram is 64 + 72 per layer, a layer being a step of the longest simple chain of edges so far, capped at 480. It
 * only has to be close: the figure takes `min-height`, so a taller drawing grows it once.
 */
function estimateHeight(d: DiagramBlock): number {
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

/** A unit as the renderer keeps it. */
interface U {
  /** Ordinal: the index of the unit's first block among the blocks after the masthead. */
  id: number;
  plan: Unit;
  blocks: Block[];
  /** The ids this unit started from, so it can be drawn again with the ids it had. */
  mark: CtxMark;
  html: string;
  diagrams: DiagramBlock[];
  /** The bucket sets in the unit, which gain items from later lines. */
  buckets: BucketBlock[];
  /** Data names a chart, table or kpi in the unit reads. */
  reads: Set<string>;
  /** The unit holds a table, which reads the page's picks. */
  picks: boolean;
  /** The unit holds an `export`, which lists the page's question fields and its title. */
  exports: boolean;
  /** The fields and title (`exportKey()`) the unit's last drawing listed. */
  exportKey: string;
  /** A later drawing supersedes an earlier one that resolves after it. */
  version: number;
}

/** What a unit's blocks hold, grids and cards included. */
function inspect(blocks: Block[]): Pick<U, 'diagrams' | 'buckets' | 'reads' | 'picks' | 'exports'> {
  const diagrams: DiagramBlock[] = [];
  const buckets: BucketBlock[] = [];
  const reads = new Set<string>();
  let picks = false;
  let exports = false;
  walkBlocks(blocks, (b) => {
    if (b.type === 'diagram') diagrams.push(b);
    else if (b.type === 'bucket') buckets.push(b);
    else if (b.type === 'export') exports = true;
    else if (b.type === 'chart') reads.add(b.data);
    else if (b.type === 'table') {
      reads.add(b.data);
      picks = true;
    } else if (b.type === 'kpis') for (const k of b.items) if (k.ref) reads.add(k.ref.split('.')[0]);
  });
  return { diagrams, buckets, reads, picks, exports };
}

/** The question fields, the `preset` blocks and whether an `export` is among a block and the blocks it holds, found in one walk. */
function questionsIn(block: Block): { fields: QuestionBlock[]; presets: PresetBlock[]; hasExport: boolean } {
  const fields: QuestionBlock[] = [];
  const presets: PresetBlock[] = [];
  let hasExport = false;
  walkBlocks([block], (b) => {
    if (Object.hasOwn(FIELD_KINDS, b.type)) fields.push(b as QuestionBlock);
    else if (b.type === 'preset') presets.push(b);
    else if (b.type === 'export') hasExport = true;
  });
  return { fields, presets, hasExport };
}

/** The ops, and the drawings still pending, of several units drawn in one step. */
class Batch {
  readonly ops: IncrementalOp[] = [];
  readonly pend: Promise<IncrementalOp[]>[] = [];

  add(r: Pushed): void {
    this.ops.push(...r.ops);
    if (r.pending) this.pend.push(r.pending);
  }

  /** The ops so far, with one promise for every drawing pending. */
  result(): Pushed {
    const { ops, pend } = this;
    if (pend.length === 0) return { ops };
    return { ops, pending: pend.length === 1 ? pend[0] : Promise.all(pend).then((parts) => parts.flat()) };
  }
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
  private readonly byBucket = new Map<BucketBlock, U>();
  /**
   * Diagrams the stream has sealed at least once, even before their unit was committed. A diagram of a committed unit that is
   * not in it is shown as a slot; one that is in it is drawn, and a seal after the first draws it again (a reseal).
   */
  private readonly sealed = new Set<DiagramBlock>();
  /** The height each diagram's slot has reached. */
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
  /** The drawings still in flight; each leaves when it settles, so the set stays as small as the layouts waiting on the engine. */
  private readonly drawings = new Set<Promise<unknown>>();

  /** `picksOf` over every block pushed, one block at a time. */
  private readonly pickScan: PickScan = { picks: [], underRec: false };

  /**
   * The question fields of every block pushed, in source order: the array `ctx.fields` is, so an `export` lists the fields read so
   * far. `controls`: a field or an `export` has arrived, so the stylesheet carries the controls' rules (as `render()`'s does).
   * `editors`: an editor word (`param`, `toggle`, `bucket`, `template` or `preset`) has, so it carries theirs too.
   */
  private readonly fields: QuestionBlock[] = [];
  private controls = false;
  private editors = false;
  /** The bucket items of those fields, kept as the sets grow (`countItems`): what `exportKey()` reads, so it costs nothing per call. */
  private items = 0;
  private readonly counted = new Map<BucketBlock, number>();
  /** The committed units that hold an `export`. */
  private readonly exportUnits: U[] = [];

  private prose = false;
  private proseFrozen = false;
  /** The essay test's counts over the blocks read so far, while the layout is still undecided. */
  private readonly tally: ProseTally = { paras: 0, pchars: 0, all: 0 };
  private proseFlips = 0;
  private shiftAssumed = false;
  private repicks = 0;
  private reseals = 0;
  private renders = 0;
  private readonly holdMs: number[] = [];
  private heldGrouped = 0;
  private heldPlain = 0;
  private readonly placeholderError: number[] = [];

  constructor(meta: () => Record<string, string>, data: () => Record<string, DataSet>, opts: IncrementalOptions) {
    this.meta = meta;
    this.data = data;
    // `shell` is dropped: see `IncrementalOptions`.
    const { settle, now, shell: _shell, ...render } = opts;
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
    this.ctx = new Ctx(this.doc, render, this.fields);
    this.ctx.cacheLayouts = true;
    this.frontier = this.ctx.mark();
    this.ctx.slot = (d, wide) => {
      if (this.mode === 'none') return null;
      // A diagram with nothing in it is drawn as nothing (`render()` writes nothing for it), so once its statements are done
      // there is no drawing to wait for: a slot here would never be replaced.
      if (d.nodes.length === 0 && this.sealed.has(d)) return null;
      if (this.mode === 'unit' && d.kind === 'sequence' && this.sealed.has(d)) return null;
      const h = Math.max(this.minH.get(d) ?? 0, estimateHeight(d));
      this.minH.set(d, h);
      return slotHtml(h, wide);
    };
  }

  // ------------------------------------------------------------------ pushing blocks

  push(block: Block): Pushed {
    // Defining a name, or defining it again, changes what every chart, table and kpi reading it sees; the first definition can come
    // after a reader that was drawn without rows.
    if (block.type === 'data') return this.update({ data: block.name });
    this.seq++;
    const out = new Batch();
    this.all.push(block);
    const gained = this.takeQuestions(block);
    let consumed = false;
    if (!this.begun) {
      const r = this.begin(block);
      out.ops.push(...r.ops);
      consumed = r.consumed;
    } else if (gained) out.ops.push({ op: 'style', css: this.style(this.startMeta) });
    if (block.type === 'heading') this.decideShift(block);
    this.repick(block, out);
    if (consumed) {
      this.reexport(out);
      return out.result();
    }
    this.rest.push(block);
    this.latchProse(block, out.ops);
    this.held.push(block);
    this.heldAt.push(this.now());
    this.heldSeq.push(this.seq);
    this.commit(out, false);
    this.reexport(out);
    return out.result();
  }

  /**
   * A question field joins `fields`. The first field or `export` of the page adds the controls' rules to the stylesheet, and the
   * first editor word (a `preset` too, which is no field) adds the editors'; true when this block did either, so the caller emits
   * the style (the first block's style is `begin`'s).
   */
  private takeQuestions(block: Block, temporary = false): boolean {
    const { fields: found, presets, hasExport } = questionsIn(block);
    this.fields.push(...found);
    // The bucket items an `export` lists are counted for the fields that stay; a temporary field (below) is dropped again.
    if (!temporary) for (const f of found) if (f.type === 'bucket') this.countItems(f);
    const controls = !this.controls && (found.length > 0 || hasExport);
    const editors = !this.editors && usesEditors(found, presets);
    if (controls) this.controls = true;
    if (editors) this.editors = true;
    return controls || editors;
  }

  /** Bring the running count of bucket items up to the items `set` has now. Counting a set again, or one that has not grown, adds nothing. */
  private countItems(set: BucketBlock): void {
    const n = set.items.length;
    this.items += n - (this.counted.get(set) ?? 0);
    this.counted.set(set, n);
  }

  /** The page stylesheet for `meta`, with the controls' and the editors' rules once a field, an `export` or an editor word has arrived. */
  private style(meta: Record<string, string>): string {
    return styleOf(meta, this.controls, this.editors);
  }

  /**
   * An `export` draws the answer template of the whole page: every question field, whether it comes before or after the export,
   * and the page title, which can come from a `#` heading or an `@title` read later. Neither is known when the export arrives, so it
   * is drawn with what has been read, like a table with the picks, and drawn again in place (`replace`) when a field arrives, a
   * bucket set gains an item or the title changes; `end()` does so once more with the finished page. The ids do not move, since the
   * export takes none. A page with no `export` pays nothing (internal spec, lede-lang/meta).
   */
  private reexport(out: Batch): void {
    if (this.exportUnits.length === 0) return;
    const key = this.exportKey();
    for (const u of this.exportUnits) {
      if (u.exportKey === key) continue;
      u.exportKey = key;
      out.add(this.redraw(u));
    }
  }

  /** What an `export` lists: the number of fields and of bucket items (they only ever grow) and the title. */
  private exportKey(): string {
    return `${this.fields.length}:${this.items}:${this.ctx.page ?? ''}`;
  }

  /**
   * The first block decides the style and the masthead; a heading `#` the masthead takes is not part of the body. `render()`
   * reads the first `#` heading anywhere, so a page whose first block is not one decides on a guess: the header from the
   * `@title`, or from the subtitle and byline. The guess is right unless a `#` heading comes later and either repeats the
   * `@title` (the page has no header) or, with no `@title`, takes the subtitle and byline to follow it. Holding the header
   * back until that heading arrives would leave the title off the page for the whole stream on the many pages that never
   * have one, so the guess is shown and `end()` settles it (cause `masthead`): the header, and the one heading unit, are
   * replaced and nothing else (internal spec, lede-lang/meta).
   */
  private begin(first: Block): { ops: IncrementalOp[]; consumed: boolean } {
    this.begun = true;
    const m = this.meta();
    this.startMeta = { ...m };
    const ops: IncrementalOp[] = [{ op: 'style', css: this.style(m) }];
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
    if (NOT_ESSAY.has(block.type)) {
      this.proseFrozen = true;
      return;
    }
    tallyProse(this.tally, block);
    if (!isWide(this.meta()) && proseShape(this.tally)) {
      this.prose = true;
      this.proseFlips++;
      ops.push({ op: 'prose', on: true });
    }
  }

  /** A note or paragraph under a heading can name the choice a table is about: draw the tables again when the picks change. */
  private repick(block: Block, out: Batch): void {
    if (block.type !== 'heading' && block.type !== 'note' && block.type !== 'paragraph') return;
    pickStep(this.pickScan, block);
    // The names found only ever grow, so a different count is the whole comparison.
    if (this.pickScan.picks.length === this.ctx.picks.length) return;
    this.ctx.picks = [...this.pickScan.picks];
    for (const u of this.units) {
      if (!u.picks) continue;
      this.repicks++;
      out.add(this.redraw(u));
    }
  }

  /**
   * Commit the units at the front of the held blocks. A block that is not a heading is its own unit at once. A heading may start
   * a grouped unit (a FAQ, option cards, a set, pros and cons, a recommendation) that the next blocks decide, so it and
   * everything after it stay held until `mayGroup` says no, or until every section the decision read has ended.
   */
  private commit(out: Batch, atEnd: boolean): void {
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
      this.commitUnit(unit, n, out);
    }
  }

  private commitUnit(unit: Unit, n: number, out: Batch): void {
    const id = this.rest.length - this.held.length;
    const blocks = this.held.splice(0, n);
    const at = this.heldAt.splice(0, n);
    const seqs = this.heldSeq.splice(0, n);
    const t = this.now();
    seqs.forEach((q, i) => {
      if (q >= this.seq) return;
      this.holdMs.push(t - at[i]);
      if (unit.kind === 'block') this.heldPlain++;
      else this.heldGrouped++;
    });
    const u: U = { id, plan: unit, blocks, mark: this.frontier, html: '', ...inspect(blocks), exportKey: '', version: 0 };
    for (const d of u.diagrams) this.byDiagram.set(d, u);
    for (const b of u.buckets) this.byBucket.set(b, u);
    if (u.exports) {
      u.exportKey = this.exportKey();
      this.exportUnits.push(u);
    }
    // A diagram sealed while its unit was held back is finished already.
    const unfinished = u.diagrams.some((d) => !this.sealed.has(d));
    const slotted = unfinished || blocks.some(holdsFlow);
    this.mode = u.diagrams.length ? 'unit' : 'none';
    u.html = this.drawUnit(unit);
    this.mode = 'none';
    this.renders++;
    this.frontier = this.ctx.mark();
    this.units.push(u);
    if (slotted)
      out.ops.push({ op: 'placeholder', id, html: u.html, minHeight: Math.max(...u.diagrams.map((d) => this.minH.get(d) ?? 0)) });
    else out.ops.push({ op: 'append', id, html: u.html });
    // A flow diagram that is finished already is laid out now.
    if (!unfinished && slotted) out.add(this.redraw(u));
  }

  /** One unit as `render()` draws it, with every diagram `ctx.slot` claims left as a slot. */
  private drawUnit(unit: Unit): string {
    if (unit.kind !== 'block') return this.ctx.unitSync(this.viewUnit(unit));
    const b = unit.block;
    return standfirst(b, this.rest[0], this.header, this.prose) ?? this.ctx.blockSync(this.view(b), true);
  }

  /** A grouped unit whose sections hold the `view` of their blocks: a kpi in an FAQ answer has its value like any other. */
  private viewUnit(unit: Exclude<Unit, { kind: 'block' }>): Exclude<Unit, { kind: 'block' }> {
    const sec = (s: Section): Section => {
      const body = s.body.map((b) => this.view(b));
      return body.every((b, i) => b === s.body[i]) ? s : { h: s.h, body };
    };
    if (unit.kind === 'rec') return { ...unit, section: sec(unit.section) };
    if (unit.kind === 'proscons') return { ...unit, pro: sec(unit.pro), con: sec(unit.con) };
    return { ...unit, sections: unit.sections.map(sec) };
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
    // The fields of an open grid or cards run count for an `export` drawn beside them, for as long as the run is open: they are
    // dropped again below, and added for good when the run is pushed.
    const known = this.fields.length;
    let gained = false;
    for (const b of blocks) gained = this.takeQuestions(b, true) || gained;
    if (!this.begun && shown.length) ops.push(...this.begin(shown[0]).ops);
    else if (gained) ops.push({ op: 'style', css: this.style(this.startMeta) });
    this.mode = 'tail';
    const first = this.rest.length === 0 && this.held.length === 0 ? blocks[0] : undefined;
    let html: string;
    try {
      html = shown
        .map((b) => {
          if (b.type === 'grid' && b.children.length === 0) return '';
          return standfirst(b, first, this.header, this.prose) ?? this.ctx.blockSync(this.view(b), true);
        })
        .join('');
    } finally {
      this.fields.length = known;
      this.mode = 'none';
    }
    this.ctx.rewind(this.frontier);
    if (html !== this.lastTail) {
      this.lastTail = html;
      ops.push({ op: 'tail', html });
    }
    return ops;
  }

  // ------------------------------------------------------------------ updates, seals, drawings

  update(what: DiagramBlock | BucketBlock | { data: string }): Pushed {
    if (!('type' in what)) {
      const out = new Batch();
      for (const u of this.units) if (u.reads.has(what.data)) out.add(this.redraw(u));
      return out.result();
    }
    if (what.type === 'bucket') return this.grew(what);
    const u = this.byDiagram.get(what);
    // A diagram not on the page yet, or one that is drawn already (its next seal draws it again): nothing to show.
    if (!u || this.sealed.has(what)) return { ops: [] };
    if (estimateHeight(what) <= (this.minH.get(what) ?? 0)) return { ops: [] };
    return this.redraw(u);
  }

  /**
   * A bucket set gained an item. Its unit is drawn again in place, with the set as it stands: the rows and the counts are static
   * markup, so each item is a whole drawing and there is nothing to wait for. A set whose unit is still held, or is in a grid or
   * cards run not pushed yet, is drawn when that unit is, from the set as it stands then. The `export` lists the items either way.
   */
  private grew(set: BucketBlock): Pushed {
    const out = new Batch();
    if (this.counted.has(set)) this.countItems(set);
    const u = this.byBucket.get(set);
    if (u) {
      out.add(this.redraw(u));
      // That drawing lists the fields and items as they stand, so an `export` in the same unit is current: `reexport` skips it.
      if (u.exports) u.exportKey = this.exportKey();
    }
    this.reexport(out);
    return out.result();
  }

  seal(d: DiagramBlock | BucketBlock): Pushed {
    // A bucket set has no drawing to finish: every update drew it in full.
    if (d.type === 'bucket') return { ops: [] };
    const again = this.sealed.has(d);
    this.sealed.add(d);
    const u = this.byDiagram.get(d);
    // Sealed before its unit was committed: it is drawn finished when it is.
    if (!u) return { ops: [] };
    if (again) this.reseals++;
    return this.redraw(u);
  }

  /** Draw a unit again, with the ids it had; a flow diagram that is finished draws asynchronously. */
  private redraw(u: U): Pushed {
    this.ctx.rewind(u.mark);
    try {
      const stillOpen = u.diagrams.some((d) => !this.sealed.has(d));
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
    const drawing = u.plan.kind === 'block' ? this.ctx.block(this.view(u.plan.block), true) : this.ctx.unit(this.viewUnit(u.plan));
    const pending = drawing.then((html): IncrementalOp[] => {
      if (u.version !== version) return [];
      this.renders++;
      u.html = html;
      this.measure(u, html);
      return [{ op: 'replace', id: u.id, html }];
    });
    this.drawings.add(pending);
    // Settled either way; the rejection itself reaches whoever holds `pending`.
    const forget = () => this.drawings.delete(pending);
    pending.then(forget, forget);
    return { ops: [], pending };
  }

  /** How far the slot was from the drawing, for a diagram that is alone in its unit. */
  private measure(u: U, html: string): void {
    if (u.diagrams.length !== 1) return;
    const h = /<svg [^>]*viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(html);
    if (h) this.placeholderError.push((this.minH.get(u.diagrams[0]) ?? 0) - (Number(h[1]) + 34));
  }

  // ------------------------------------------------------------------ the end

  async end(): Promise<IncrementalEnd> {
    const batch = new Batch();
    const ops = batch.ops;
    ops.push({ op: 'tail', html: '' });
    this.lastTail = '';
    this.seq++;
    // What is held can group now: every section has ended.
    this.commit(batch, true);
    // The fields and the title are final: an `export` drawn before the last of them is drawn again. A consumer that did not pass on the
    // updates of a bucket set has not had the running count of its items kept, so it is made right here.
    for (const set of this.counted.keys()) this.countItems(set);
    this.reexport(batch);
    // Diagrams still being written are finished: the stream ended.
    for (const d of this.byDiagram.keys()) if (!this.sealed.has(d)) batch.add(this.seal(d));
    await Promise.all(this.drawings);
    for (const more of await Promise.all(batch.pend)) ops.push(...more);

    const m = this.meta();
    const lateMeta = this.applyLateMeta(m, ops);
    const regroups = this.regroups();

    // Settle: the finished document through the whole-page renderer, compared child by child.
    const doc: LedeDocument = { meta: m, blocks: this.all, data: this.data(), diagnostics: [] };
    const whole = new Ctx(doc, this.renderOpts);
    whole.cacheLayouts = true;
    const mh = masthead(doc, whole);
    const { body, prose, h1At } = await renderMain(doc, whole, mh);
    // The subtitle and byline that follow the first `#` heading are children of `<main>` of their own in `render()`, and part of
    // that heading's unit here: the heading is the one unit a late masthead decision changes.
    if (h1At >= 0) body.splice(h1At, 3, body[h1At] + body[h1At + 1] + body[h1At + 2]);
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
      causes.push('masthead');
      edits.push({ op: 'masthead', html: mh.header });
    }
    let f = 0;
    while (f < Math.min(mineUnits.length, theirUnits.length) && normalize(mineUnits[f].html) === normalize(theirUnits[f])) f++;
    const countMismatch = mineUnits.length !== theirUnits.length;
    if (countMismatch) {
      // The units no longer line up: replace from the first difference to the end.
      firstDiff ??= offset + f;
      settled += Math.max(mineUnits.length, theirUnits.length) - f;
      causes.push(this.causeOf(mineUnits[f], theirUnits[f], whole, prose, mh));
      const stale = mineUnits.slice(f).map((u) => u.id);
      if (stale.length) edits.push({ op: 'remove', ids: stale });
      theirUnits.slice(f).forEach((html, k) => edits.push({ op: 'append', id: this.rest.length + k, html }));
    } else {
      for (let i = f; i < mineUnits.length; i++) {
        if (normalize(mineUnits[i].html) === normalize(theirUnits[i])) continue;
        firstDiff ??= offset + i;
        settled++;
        causes.push(this.causeOf(mineUnits[i], theirUnits[i], whole, prose, mh));
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
      heldGrouped: this.heldGrouped,
      heldPlain: this.heldPlain,
      placeholderError: this.placeholderError,
      renders: this.renders,
    };
  }

  /** Meta written after the first block: the style is rewritten and the masthead replaced if the page's own words changed. */
  private applyLateMeta(m: Record<string, string>, ops: IncrementalOp[]): number {
    if (!this.begun) return 0;
    const differs = (k: string) => (m[k] ?? '') !== (this.startMeta[k] ?? '');
    const lateMeta = [...STYLE_KEYS, ...MAST_KEYS].filter(differs).length;
    if (STYLE_KEYS.some(differs)) ops.push({ op: 'style', css: this.style(m) });
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
    const kept = new Set(this.units.map((u) => `${u.id}:${u.blocks.length}`));
    let n = 0;
    for (let at = 0; at < this.rest.length;) {
      const step = planAt(this.rest, at, this.prose).n;
      if (!kept.has(`${at}:${step}`)) n++;
      at += step;
    }
    return n;
  }

  /**
   * Why a unit differs from the whole-page render, judged from the two pieces of markup and the state they came from. When the
   * counts differ, the first unit that only one side has is judged from the side that has it.
   */
  private causeOf(u: U | undefined, theirs: string | undefined, whole: Ctx, prose: boolean, mh: Masthead): SettleCause {
    if (u && mh.firstH1 && u.blocks.includes(mh.firstH1)) return 'masthead';
    const mine = u?.html ?? '';
    const other = theirs ?? '';
    if (mine.includes('class="lead"') !== other.includes('class="lead"')) return 'lead';
    const levels = (h: string) => h.replace(/<(\/?)h[1-4]\b/g, '<$1h');
    // Two headings a level apart are the same unit moved by the shift; a heading only one side has is the shift moving it into
    // or out of the body (a late `@title` becomes the page heading, and the `#` heading the masthead had taken moves into the body).
    const heading = u && theirs !== undefined ? levels(mine) === levels(other) : /^<h[1-4]\b/.test(mine || other);
    if (whole.shift !== this.ctx.shift && heading) return 'shift';
    const picked = whole.picks.length !== this.ctx.picks.length || whole.picks.some((p, i) => p !== this.ctx.picks[i]);
    if ((u ? u.picks : /<table\b/.test(other)) && picked) return 'picks';
    if (prose !== this.prose) return 'prose';
    return 'other';
  }
}
