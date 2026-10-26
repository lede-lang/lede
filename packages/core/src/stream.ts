import type { Block, LedeDocument } from './ast.ts';
import { LedeParser, type ParseOptions } from './parser.ts';

/**
 * Feed model output as it arrives. `write` returns blocks that became final;
 * `snapshot` returns a whole document for the text so far (the open paragraph,
 * list or fence included), which is what a live preview renders. A `cards`
 * block is returned by `write` when its run ends (a #/## heading, `---`, another
 * `cards`, a `grid`, or `end`); `snapshot` already shows the cards read so far.
 */
export class LedeStream {
  private parser: LedeParser;
  private buf = '';
  private lines: string[] = [];

  private readonly opts: ParseOptions;

  constructor(opts: ParseOptions = {}) {
    this.opts = opts;
    this.parser = new LedeParser(opts);
  }

  write(chunk: string): Block[] {
    this.buf += chunk;
    const out: Block[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      this.lines.push(line);
      out.push(...this.parser.pushLine(line));
    }
    return out;
  }

  /** Document for everything complete so far. The partial last line is left out. */
  snapshot(): LedeDocument {
    const p = new LedeParser(this.opts);
    for (const l of this.lines) p.pushLine(l);
    return p.end();
  }

  end(): LedeDocument {
    if (this.buf) {
      this.lines.push(this.buf);
      this.parser.pushLine(this.buf);
      this.buf = '';
    }
    return this.parser.end();
  }
}
