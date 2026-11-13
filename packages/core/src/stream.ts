import type { Block, BucketBlock, DecisionBlock, DiagramBlock, LedeDocument } from './ast.ts';
import { LedeParser, type ParseOptions } from './parser.ts';
import { walkBlocks } from './walk.ts';

/**
 * What `LedeStream.events` returns, in line order.
 * - `block`: a block became final; the same blocks `write` returns.
 * - `update` with `block`: a `name:` line changed a diagram that was already returned (a diagram is a block that grows). A line
 *   the parser rejects, or one that repeats what the diagram has, is no update; it is still a statement of the diagram. The next
 *   non-blank line that is not another statement of it ends the growth with a `seal`; a statement after a seal that changes the
 *   diagram is an `update` again and a second `seal` follows (a reseal).
 * - `update` with `data`: `data NAME += rows` appended rows, or a run of `NAME: a | b` row lines did; charts, tables and kpi rows that
 *   read NAME changed. A run of row lines of one set is one update, given when the run ends: at the first non-blank line that is not a
 *   row of that set (before that line's own events), or at `end`. The rows are in `doc` and in `snapshot()` as each line is read.
 * - `seal`: no statement of this diagram is expected for now.
 * - `bucket-update` and `bucket-seal`: the same two events for a bucket set (spec §4.19), which grows by `NAME: ITEM | B` lines as a
 *   diagram does. They are kinds of their own so that `update` and `seal` always carry a diagram, as they did before bucket sets.
 * - `decision-update` and `decision-seal`: the same two events for a decision (spec §4.20), which grows by `NAME: option`, `question`
 *   and `role` lines.
 */
export type StreamEvent =
  | { kind: 'block'; block: Block }
  | { kind: 'update'; block: DiagramBlock }
  | { kind: 'update'; data: string }
  | { kind: 'seal'; block: DiagramBlock }
  | { kind: 'bucket-update'; block: BucketBlock }
  | { kind: 'bucket-seal'; block: BucketBlock }
  | { kind: 'decision-update'; block: DecisionBlock }
  | { kind: 'decision-seal'; block: DecisionBlock };

/** A block that is returned once and then gains lines: a diagram (statements), a bucket set (items) or a decision (options, questions, roles). */
type Growing = DiagramBlock | BucketBlock | DecisionBlock;

/** The `update` or `seal` event of a growing block, in the kind its type takes: `bucket-` and `decision-` prefixed, a diagram's bare. */
function eventOf(d: Growing, verb: 'update' | 'seal'): StreamEvent {
  if (d.type === 'bucket') return verb === 'update' ? { kind: 'bucket-update', block: d } : { kind: 'bucket-seal', block: d };
  if (d.type === 'decision') return verb === 'update' ? { kind: 'decision-update', block: d } : { kind: 'decision-seal', block: d };
  return verb === 'update' ? { kind: 'update', block: d } : { kind: 'seal', block: d };
}

/**
 * Feed model output as it arrives. `write` returns blocks that became final;
 * `events` returns those plus the updates and seals of diagrams, bucket sets and decisions, and the updates of data;
 * `tail` returns the block or blocks still being written, without ending the
 * document; `snapshot` returns a whole document for the text so far (the open
 * paragraph, list or fence included), which is what a live preview that
 * re-renders everything uses. A `cards` block is returned by `write` when its run
 * ends (a #/## heading, `---`, another `cards`, a `grid`, or `end`); `tail` and
 * `snapshot` already show the cards read so far. An inline `table [options] =` with a header and no rows of its own is returned
 * the same way, when the first line that is not one of its `: a | b` rows arrives (or at `end`); `tail` and `snapshot` show it
 * with the rows read so far.
 */
export class LedeStream {
  private parser: LedeParser;
  private buf = '';
  private lines: string[] = [];

  private readonly opts: ParseOptions;
  /**
   * Diagrams, bucket sets and decisions a statement line was written for, the ones among them it changed, and data names a `+=` line
   * appended to, since the last line began.
   */
  private touched = new Set<Growing>();
  private changed = new Set<Growing>();
  private appended: string[] = [];
  /** The data set a run of `NAME: a | b` row lines is appending to, whose update is given when the run ends; and this line's row, if any. */
  private rowRun: string | null = null;
  private row: string | null = null;
  /** Diagrams, bucket sets and decisions already returned in a `block` event, and the ones among them that may still receive statements. */
  private returned = new WeakSet<Growing>();
  private open = new Set<Growing>();

  constructor(opts: ParseOptions = {}) {
    this.opts = opts;
    this.parser = new LedeParser(opts, {
      onDiagramLine: (b, changed) => this.statement(b, changed),
      onBucketItem: (b, changed) => this.statement(b, changed),
      onDecisionLine: (b, changed) => this.statement(b, changed),
      onDataAppend: (name, row) => {
        if (row) this.row = name;
        else this.appended.push(name);
      },
    });
  }

  private statement(b: Growing, changed: boolean): void {
    this.touched.add(b);
    if (changed) this.changed.add(b);
  }

  write(chunk: string): Block[] {
    const out: Block[] = [];
    for (const e of this.events(chunk)) if (e.kind === 'block') out.push(e.block);
    return out;
  }

  /**
   * `write` plus what happened to blocks already returned: an `update` (`bucket-update` for a bucket set, `decision-update` for a
   * decision) for every diagram, bucket set or decision a line extended and an `update` with `data` for every `data NAME +=` line and
   * every run of `NAME: a | b` lines (given at the line that ends the run, ahead of its own events), a `seal` (`bucket-seal`, `decision-seal`) for one of them when a non-blank line that is not one of its
   * statements arrives (a blank line does not seal: writers space statements). Within one line the order is: its blocks, its data
   * updates, its updates, its seals.
   */
  events(chunk: string): StreamEvent[] {
    this.buf += chunk;
    const out: StreamEvent[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      this.lines.push(line);
      this.lineEvents(line, out);
    }
    return out;
  }

  /**
   * The blocks still open: what `snapshot()` shows beyond the blocks `events()` has returned. Does not end the parser. A `template`
   * fence that is still open is the template block with the text so far. A bucket set or a decision is here only inside an open `grid`
   * or `cards` run, with the lines read so far (the run is not returned yet, so it has no update events either); one written outside
   * such a run was returned on its declaration and grows by `bucket-update` or `decision-update`.
   */
  tail(): Block[] {
    return this.parser.peek();
  }

  /**
   * The document being built, live and not a copy: `meta` and `data` as read so far, the diagnostics reported so far and the
   * blocks returned so far. Read it; do not change it. (`snapshot()` re-parses; this does not.)
   */
  get doc(): LedeDocument {
    return this.parser.doc;
  }

  /** Document for everything complete so far. The partial last line is left out. */
  snapshot(): LedeDocument {
    const p = new LedeParser(this.opts);
    for (const l of this.lines) p.pushLine(l);
    return p.end();
  }

  /**
   * Finish the document: the partial last line is read as a line, the open block is flushed, and every diagram, bucket set and decision
   * still open is sealed. The blocks this adds are the document's blocks after the ones `events()` returned. `onEvent` receives the
   * events of this last step (the last line's, the blocks it finishes, the seals), which `events()` cannot.
   */
  end(onEvent?: (e: StreamEvent) => void): LedeDocument {
    const out: StreamEvent[] = [];
    if (this.buf) {
      this.lines.push(this.buf);
      const line = this.buf;
      this.buf = '';
      this.lineEvents(line, out);
    }
    this.endRun(out);
    const before = this.parser.doc.blocks.length;
    const doc = this.parser.end();
    for (const block of doc.blocks.slice(before)) {
      out.push({ kind: 'block', block });
      this.shown(block);
    }
    for (const d of this.open) out.push(eventOf(d, 'seal'));
    this.open.clear();
    if (onEvent) for (const e of out) onEvent(e);
    return doc;
  }

  private lineEvents(line: string, out: StreamEvent[]): void {
    this.touched.clear();
    this.changed.clear();
    this.appended.length = 0;
    this.row = null;
    const blocks = this.parser.pushLine(line);
    const from = out.length;
    // A run of rows ends at a line that is not blank and not a row of the same set: its update comes before this line's events.
    if (this.row !== this.rowRun && (this.row !== null || line.trim() !== '')) this.endRun(out);
    if (this.row !== null) this.rowRun = this.row;
    for (const block of blocks) out.push({ kind: 'block', block });
    // One update per data set per line: a run of `s: 3 | 4` rows ended by `data s += 5,6` is one update of s, not two.
    const sent = new Set(out.slice(from).flatMap((e) => (e.kind === 'update' && 'data' in e ? [e.data] : [])));
    for (const data of this.appended) {
      if (sent.has(data)) continue;
      sent.add(data);
      out.push({ kind: 'update', data });
    }
    for (const d of this.touched) {
      // A growing block inside a grid or card run that has not been returned yet is not on screen: nothing to update. A line
      // that changed nothing is not an update and does not reopen a sealed block; if the block is open, being touched keeps it so (below).
      if (!this.returned.has(d) || !this.changed.has(d)) continue;
      out.push(eventOf(d, 'update'));
      this.open.add(d);
    }
    if (line.trim() !== '') {
      for (const d of this.open) {
        if (this.touched.has(d)) continue;
        out.push(eventOf(d, 'seal'));
        this.open.delete(d);
      }
    }
    // A growing block returned by this line's blocks opens now, so its own declaration line never seals it.
    for (const block of blocks) this.shown(block);
  }

  /** The update of the run of row lines that is open, if one is. */
  private endRun(out: StreamEvent[]): void {
    if (this.rowRun !== null) out.push({ kind: 'update', data: this.rowRun });
    this.rowRun = null;
  }

  /** `block` was returned: the diagrams, bucket sets and decisions it holds (itself, or in a grid or a card) may now receive statements. */
  private shown(block: Block): void {
    walkBlocks([block], (b) => {
      if (b.type !== 'diagram' && b.type !== 'bucket' && b.type !== 'decision') return;
      this.returned.add(b);
      this.open.add(b);
    });
  }
}
