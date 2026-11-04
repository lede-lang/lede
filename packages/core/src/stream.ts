import type { Block, BucketBlock, DiagramBlock, LedeDocument } from './ast.ts';
import { LedeParser, type ParseOptions } from './parser.ts';
import { walkBlocks } from './walk.ts';

/**
 * What `LedeStream.events` returns, in line order.
 * - `block`: a block became final; the same blocks `write` returns.
 * - `update` with `block`: a `name:` line changed a diagram that was already returned (a diagram is a block that grows), or
 *   a `NAME: ITEM | B` line added an item to a bucket set that was already returned (a bucket set grows the same way). A line
 *   the parser rejects, or one that repeats what the block has, is no update; it is still a statement of the block.
 *   The next non-blank line that is not another statement of it ends the growth with a `seal`; a statement after a seal
 *   that changes the block is an `update` again and a second `seal` follows (a reseal).
 * - `update` with `data`: `data NAME += rows` appended rows; charts, tables and kpi rows that read NAME changed.
 * - `seal`: no statement of this diagram or bucket set is expected for now.
 */
export type StreamEvent =
  | { kind: 'block'; block: Block }
  | { kind: 'update'; block: DiagramBlock | BucketBlock }
  | { kind: 'update'; data: string }
  | { kind: 'seal'; block: DiagramBlock | BucketBlock };

/** A block that is returned once and then gains lines: a diagram (statements) or a bucket set (items). */
type Growing = DiagramBlock | BucketBlock;

/**
 * Feed model output as it arrives. `write` returns blocks that became final;
 * `events` returns those plus the updates and seals of diagrams, bucket sets and data;
 * `tail` returns the block or blocks still being written, without ending the
 * document; `snapshot` returns a whole document for the text so far (the open
 * paragraph, list or fence included), which is what a live preview that
 * re-renders everything uses. A `cards` block is returned by `write` when its run
 * ends (a #/## heading, `---`, another `cards`, a `grid`, or `end`); `tail` and
 * `snapshot` already show the cards read so far.
 */
export class LedeStream {
  private parser: LedeParser;
  private buf = '';
  private lines: string[] = [];

  private readonly opts: ParseOptions;
  /**
   * Diagrams and bucket sets a statement line was written for, the ones among them it changed, and data names a `+=` line appended
   * to, since the last line began.
   */
  private touched = new Set<Growing>();
  private changed = new Set<Growing>();
  private appended: string[] = [];
  /** Diagrams and bucket sets already returned in a `block` event, and the ones among them that may still receive statements. */
  private returned = new WeakSet<Growing>();
  private open = new Set<Growing>();

  constructor(opts: ParseOptions = {}) {
    this.opts = opts;
    this.parser = new LedeParser(opts, {
      onDiagramLine: (b, changed) => this.statement(b, changed),
      onBucketItem: (b, changed) => this.statement(b, changed),
      onDataAppend: (name) => this.appended.push(name),
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
   * `write` plus what happened to blocks already returned: an `update` for every diagram or bucket set a line extended and for
   * every `data NAME +=` line, a `seal` for a diagram or bucket set when a non-blank line that is not one of its statements
   * arrives (a blank line does not seal: writers space statements). Within one line the order is: its blocks, its data updates,
   * its diagram or bucket update, its seals.
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
   * fence that is still open is the template block with the text so far; a bucket set is never here (it was returned on its
   * declaration and grows by `update`).
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
   * Finish the document: the partial last line is read as a line, the open block is flushed, and every diagram and bucket set
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
    const before = this.parser.doc.blocks.length;
    const doc = this.parser.end();
    for (const block of doc.blocks.slice(before)) {
      out.push({ kind: 'block', block });
      this.shown(block);
    }
    for (const d of this.open) out.push({ kind: 'seal', block: d });
    this.open.clear();
    if (onEvent) for (const e of out) onEvent(e);
    return doc;
  }

  private lineEvents(line: string, out: StreamEvent[]): void {
    this.touched.clear();
    this.changed.clear();
    this.appended.length = 0;
    const blocks = this.parser.pushLine(line);
    for (const block of blocks) out.push({ kind: 'block', block });
    for (const data of this.appended) out.push({ kind: 'update', data });
    for (const d of this.touched) {
      // A diagram or bucket set inside a grid or card run that has not been returned yet is not on screen: nothing to update. A line
      // that changed nothing is not an update and does not reopen a sealed block; if the block is open, being touched keeps it so (below).
      if (!this.returned.has(d) || !this.changed.has(d)) continue;
      out.push({ kind: 'update', block: d });
      this.open.add(d);
    }
    if (line.trim() !== '') {
      for (const d of this.open) {
        if (this.touched.has(d)) continue;
        out.push({ kind: 'seal', block: d });
        this.open.delete(d);
      }
    }
    // A diagram or bucket set returned by this line's blocks opens now, so its own declaration line never seals it.
    for (const block of blocks) this.shown(block);
  }

  /** `block` was returned: the diagrams and bucket sets it holds (itself, or in a grid or a card) may now receive statements. */
  private shown(block: Block): void {
    walkBlocks([block], (b) => {
      if (b.type !== 'diagram' && b.type !== 'bucket') return;
      this.returned.add(b);
      this.open.add(b);
    });
  }
}
