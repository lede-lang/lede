// A string model of the page a viewer keeps, and a driver that feeds source text through LedeStream into the incremental renderer
// and applies its operations to the model (internal spec, lede-lang/meta). Shared by the incremental tests and
// bench/src/incremental-report.ts. No browser: the model is an ordered array of child strings plus a tail string.
import { LedeStream, type StreamEvent } from '../../packages/core/src/index.ts';
import type { ParseOptions } from '../../packages/core/src/index.ts';
import {
  createIncremental,
  mainElement,
  type Incremental,
  type IncrementalEnd,
  type IncrementalOp,
  type IncrementalOptions,
  type Pushed,
} from '../../packages/render-html/src/index.ts';

export { normalize } from '../../packages/render-html/src/incremental.ts';

export class StringModel {
  header = '';
  prose = false;
  dash = false;
  css = '';
  tail = '';
  /** The units in order. */
  readonly units: { id: number; html: string }[] = [];
  /** Every op applied, for tests that read the sequence. */
  readonly log: IncrementalOp[] = [];

  apply(ops: IncrementalOp[]): void {
    for (const op of ops) {
      this.log.push(op);
      switch (op.op) {
        case 'masthead':
          this.header = op.html;
          break;
        case 'prose':
          this.prose = op.on;
          break;
        case 'dash':
          this.dash = op.on;
          break;
        case 'append':
        case 'placeholder':
          this.units.push({ id: op.id, html: op.html });
          break;
        case 'replace': {
          const u = this.units.find((x) => x.id === op.id);
          if (!u) throw new Error(`replace of unit ${op.id}, which is not on the page`);
          u.html = op.html;
          break;
        }
        case 'remove': {
          for (const id of op.ids) {
            const at = this.units.findIndex((x) => x.id === id);
            if (at < 0) throw new Error(`remove of unit ${id}, which is not on the page`);
            this.units.splice(at, 1);
          }
          break;
        }
        case 'tail':
          this.tail = op.html;
          break;
        case 'style':
          this.css = op.css;
          break;
      }
    }
  }

  /** The children of `<main>`, the header first, empty ones left out. */
  children(): string[] {
    return [this.header, ...this.units.map((u) => u.html)].filter(Boolean);
  }

  /** `<main>` as `render(..., { fragment: true })` writes it, plus the tail. */
  main(): string {
    return mainElement([...this.children(), this.tail], this.prose ? 'prose' : this.dash ? 'dashboard' : 'document');
  }
}

export interface Driven {
  model: StringModel;
  end: IncrementalEnd;
  inc: Incremental;
  /** The document the stream finished with. */
  doc: ReturnType<LedeStream['end']>;
  /** Every op batch in the order it was applied, with the chunk index that caused it (-1 for the end). */
  batches: { chunk: number; ops: IncrementalOp[] }[];
}

export interface DriveOptions extends IncrementalOptions {
  /** Bytes per chunk (default 7). */
  chunk?: number;
  /** Call `tail()` after every chunk (default true). */
  tails?: boolean;
  /** When pending drawings are applied: after the chunk that started them ('chunk'), or after the last chunk ('end', default). */
  flush?: 'chunk' | 'end';
  /** A virtual clock for hold times: each chunk arrives this many milliseconds after the one before. Default: the real clock. */
  msPerChunk?: number;
  parse?: ParseOptions;
}

/**
 * Stream `src` in chunks into a fresh LedeStream and renderer, applying every batch of ops to a model. Drawings that are
 * pending are applied in the order they were returned, after the chunk that started them (the viewer's single-flight chain),
 * and before the end's operations.
 */
export async function drive(src: string, o: DriveOptions = {}): Promise<Driven> {
  const { chunk = 7, tails = true, flush = 'end', msPerChunk, parse, ...ro } = o;
  let clock = 0;
  const stream = new LedeStream(parse);
  const inc = createIncremental(
    () => stream.doc.meta,
    () => stream.doc.data,
    { settle: false, ...(msPerChunk === undefined ? {} : { now: () => clock }), ...ro },
  );
  const model = new StringModel();
  const batches: Driven['batches'] = [];
  const pendings: Promise<IncrementalOp[]>[] = [];
  let at = 0;
  const apply = (ops: IncrementalOp[]) => {
    if (!ops.length) return;
    batches.push({ chunk: at, ops });
    model.apply(ops);
  };
  const take = (r: Pushed) => {
    apply(r.ops);
    if (r.pending) pendings.push(r.pending);
  };
  const handle = (e: StreamEvent) => {
    if (e.kind === 'block') take(inc.push(e.block));
    else if (e.kind === 'seal' || e.kind === 'bucket-seal' || e.kind === 'decision-seal') take(inc.seal(e.block));
    else if ('data' in e) take(inc.update({ data: e.data }));
    else take(inc.update(e.block));
  };
  for (let i = 0; i < src.length; i += chunk) {
    at = i / chunk;
    clock = at * (msPerChunk ?? 0);
    for (const e of stream.events(src.slice(i, i + chunk))) handle(e);
    if (tails) apply(inc.tail(stream.tail()));
    if (flush === 'chunk') {
      for (const p of pendings.splice(0)) {
        apply(await p);
      }
    }
  }
  at = -1;
  clock = Math.ceil(src.length / chunk) * (msPerChunk ?? 0);
  const doc = stream.end(handle);
  const end = await inc.end();
  for (const p of pendings) apply(await p);
  apply(end.ops);
  return { model, end, inc, doc, batches };
}
