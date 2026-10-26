import type {
  Block,
  CardItem,
  CardsBlock,
  ChartBlock,
  ChartKind,
  ChartMark,
  DataSet,
  Diagnostic,
  DiagramBlock,
  DiagramEdge,
  DiagramFrame,
  DiagramNode,
  GridBlock,
  Kpi,
  KpiBlock,
  ListItem,
  LedeDocument,
  Step,
  TableBlock,
} from './ast.ts';
import { num, parseInlineCsv, parseOpts, readQuoted, tokens } from './lex.ts';
import { AA_NON_TEXT, AA_TEXT, HEX_COLOR, accentContrast } from './contrast.ts';
import { browserUrl, imageSrcKind } from './url.ts';

export interface ParseOptions {
  /** Resolves `data name < path`. Without it, file data is an error (browsers, sandboxes). */
  loadFile?: (path: string) => string;
}

export const KEYWORDS = ['data', 'chart', 'table', 'kpi', 'diagram', 'image', 'grid', 'cards', 'step'] as const;
export const META_KEYS = ['title', 'subtitle', 'description', 'author', 'date', 'accent', 'theme', 'lang', 'width', 'fonts'];
const CHART_KINDS: ChartKind[] = ['line', 'area', 'bar', 'hbar', 'range'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEYWORD_RE = new RegExp(`^(${KEYWORDS.join('|')})(?=\\s|$)`);

type Acc =
  | { kind: 'paragraph'; lines: string[]; line: number }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[]; line: number }
  | { kind: 'quote'; lines: string[]; line: number }
  | { kind: 'kpis'; items: Kpi[]; line: number }
  | { kind: 'steps'; items: Step[]; line: number };

/** An open `cards` run: the block being built, the card that takes blocks now, and blocks shown after the cards. */
interface CardsRun {
  block: CardsBlock;
  card: CardItem | null;
  deferred: Block[];
}

interface Fence {
  ticks: number;
  lang: string;
  raw: boolean;
  lines: string[];
  line: number;
}

/**
 * Line-at-a-time parser. `pushLine` returns the top-level blocks that became
 * final with that line; a block never changes after it is returned, except a
 * diagram (later `name:` lines add to it) and a table/chart whose data gets
 * `+=` rows. Both are resolved again at render time. A `cards` run (v0.4) is
 * held back until it ends; blocks around it still stream as usual.
 */
export class LedeParser {
  readonly doc: LedeDocument = { meta: {}, blocks: [], data: {}, diagnostics: [] };
  private acc: Acc | null = null;
  private fence: Fence | null = null;
  private grid: GridBlock | null = null;
  private cards: CardsRun | null = null;
  private diagrams = new Map<string, DiagramBlock>();
  /** Node ids declared with their own line, per diagram (vs. created by first use in an edge). */
  private declared = new WeakMap<DiagramBlock, Set<string>>();
  /** The open alt/opt frame per sequence diagram, and how many rejected nested openers still await their `end`. */
  private seq = new WeakMap<DiagramBlock, { open: DiagramFrame | null; skip: number }>();
  private lineNo = 0;
  /** Where the last valid `@accent` was written; its contrast is checked in `end()`, once `@theme` is known. */
  private accentAt: { line: number; col: number } | null = null;
  private out: Block[] = [];
  private anon = 0;

  private readonly opts: ParseOptions;

  constructor(opts: ParseOptions = {}) {
    this.opts = opts;
  }

  pushLine(raw: string): Block[] {
    this.out = [];
    this.lineNo++;
    raw = raw.replace(/\r$/, '');
    if (this.fence) {
      this.fenceLine(raw);
      return this.out;
    }
    const lead = raw.length - raw.trimStart().length;
    const s = raw.trim();
    this.classify(s, lead);
    return this.out;
  }

  end(): LedeDocument {
    this.out = [];
    if (this.fence) {
      this.diag('warning', 'unclosed-fence', 'code fence is never closed; it ends at the end of the document', this.fence.line, 1);
      this.closeFence();
    }
    this.flush();
    if (this.cards) this.closeCards();
    if (this.grid) {
      const g = this.grid;
      if (g.children.length < g.count) {
        this.diag(
          'warning',
          'grid-unfilled',
          `grid expected ${g.count} blocks, got ${g.children.length}; put ${g.count} blocks after it or lower the count`,
          g.line,
          1,
        );
      }
      this.grid = null;
      this.doc.blocks.push(g);
    }
    this.checkAccent();
    resolve(this.doc);
    return this.doc;
  }

  // ------------------------------------------------------------ accent (D49)

  private accentMeta(v: string, L: number, col: number): void {
    if (HEX_COLOR.test(v)) {
      this.accentAt = { line: L, col };
      return;
    }
    this.accentAt = null;
    this.diag('warning', 'accent-value', `@accent takes a hex color such as #2357c6 (got "${v}"); the house accent is used`, L, col);
  }

  /**
   * The accent is link and label text, so it needs 4.5:1 on the theme's surfaces. With no `@theme`
   * it applies to the light theme only (dark mode keeps the house accent); `@theme dark` puts it on
   * the dark surfaces.
   */
  private checkAccent(): void {
    const accent = this.doc.meta.accent;
    if (!this.accentAt || !accent) return;
    const theme = this.doc.meta.theme === 'dark' ? 'dark' : 'light';
    const c = accentContrast(accent, theme);
    if (!c || c.ratio >= AA_TEXT) return;
    const surface = { bg: 'page background', surface: 'card surface', 'accent-tint': 'note tint' }[c.against] ?? c.against;
    const marks = c.ratio < AA_NON_TEXT ? `; borders and bars need ${AA_NON_TEXT}:1 and miss that too` : '';
    this.diag(
      'warning',
      'accent-contrast',
      `@accent ${accent} has ${c.ratio}:1 contrast on the ${theme} theme's ${surface}; link and label text needs ${AA_TEXT}:1${marks}. Pick a ${theme === 'dark' ? 'lighter' : 'darker'} accent`,
      this.accentAt.line,
      this.accentAt.col,
      { accent, theme, ratio: c.ratio, required: AA_TEXT, against: c.against },
    );
  }

  // ------------------------------------------------------------ dispatch

  private classify(s: string, lead: number): void {
    const L = this.lineNo;
    if (s === '') {
      this.flush();
      return;
    }
    if (s.startsWith('\\')) {
      this.textLine(s.slice(1));
      return;
    }
    const fm = /^(`{3,})\s*(=?)([\w+-]*)\s*$/.exec(s);
    if (fm) {
      this.flush();
      this.fence = { ticks: fm[1].length, raw: fm[2] === '=', lang: fm[3], lines: [], line: L };
      if (fm[2] === '=' && fm[3] !== 'html') {
        this.diag('error', 'raw-format', `raw fence must be \`\`\`=html, not =${fm[3]}`, L, lead + 1);
      }
      return;
    }
    const meta = /^@([A-Za-z][\w-]*)(?:\s+(.*))?$/.exec(s);
    if (meta) {
      this.flush();
      const key = meta[1];
      if (!META_KEYS.includes(key)) {
        this.diag('warning', 'unknown-meta', `unknown meta key @${key} (known: ${META_KEYS.join(', ')})`, L, lead + 1);
      }
      this.doc.meta[key] = (meta[2] ?? '').trim();
      if (key === 'accent') this.accentMeta(this.doc.meta[key], L, lead + 1);
      return;
    }
    const h = /^(#{1,6})(\s+(.*))?$/.exec(s);
    if (h && (h[2] !== undefined || s.length === h[1].length)) {
      this.flush();
      let level = h[1].length;
      if (level > 3) {
        this.diag('warning', 'heading-depth', `headings go to ### (got ${h[1]}); write ###, which is how it renders`, L, lead + 1);
        level = 3;
      }
      const text = (h[3] ?? '').trim();
      if (!text) this.diag('error', 'empty-heading', 'heading has no text', L, lead + 1);
      if (this.cards) {
        // Inside a `cards` run a ### starts the next card; # and ## end the run.
        if (level === 3) {
          const card: CardItem = { title: text, blocks: [], line: L };
          this.cards.block.items.push(card);
          this.cards.card = card;
          return;
        }
        this.closeCards();
      }
      if (this.grid) this.closeGrid(true, level);
      this.emit({ type: 'heading', level: level as 1 | 2 | 3, text, line: L });
      return;
    }
    const task = /^-\s+\[([ xX])\]\s+(.*)$/.exec(s);
    if (task) {
      this.listItem(false, 1, { text: task[2], checked: task[1] !== ' ' });
      return;
    }
    if (s.startsWith('- ') || s === '-') {
      this.listItem(false, 1, { text: s.slice(2).trim(), checked: null });
      return;
    }
    const sub = /^--\s+(.*)$/.exec(s);
    if (sub) {
      this.subItem(sub[1], lead);
      return;
    }
    const ol = /^(\d{1,9})[.)]\s+(.*)$/.exec(s);
    if (ol) {
      this.listItem(true, Number(ol[1]), { text: ol[2], checked: null });
      return;
    }
    const note = /^(!{1,3})\s+(.*)$/.exec(s);
    if (note) {
      this.flush();
      const tone = (['note', 'warn', 'danger'] as const)[note[1].length - 1];
      this.emit({ type: 'note', tone, text: note[2], line: L });
      return;
    }
    if (s.startsWith('>')) {
      const text = s.replace(/^>\s?/, '');
      if (this.acc?.kind !== 'quote') {
        this.flush();
        this.acc = { kind: 'quote', lines: [], line: L };
      }
      this.acc.lines.push(text);
      return;
    }
    if (/^-{3,}$/.test(s)) {
      this.flush();
      if (this.cards) this.closeCards();
      this.emit({ type: 'rule', line: L });
      return;
    }
    if (s.startsWith('html:')) {
      this.flush();
      this.emit({ type: 'html', html: s.slice(5).trim(), line: L });
      return;
    }
    const kw = KEYWORD_RE.exec(s);
    // `cards` takes nothing after it: `cards on the table` stays prose.
    if (kw && !(kw[1] === 'cards' && s !== 'cards')) {
      const rest = s.slice(kw[1].length).trim();
      const restCol = lead + 1 + s.indexOf(rest, kw[1].length);
      this.keyword(kw[1], rest, restCol, lead);
      return;
    }
    const dl = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(s);
    if (dl && this.diagrams.has(dl[1])) {
      this.flush();
      const col = lead + 1 + s.indexOf(':') + 1 + (s.slice(s.indexOf(':') + 1).length - s.slice(s.indexOf(':') + 1).trimStart().length);
      this.diagramLine(this.diagrams.get(dl[1])!, dl[2].trim(), col);
      return;
    }
    if (dl && /(-->|->|<->)/.test(dl[2])) {
      this.flush();
      this.diag(
        'error',
        'undeclared-diagram',
        `"${dl[1]}:" looks like a diagram line, but no diagram named ${dl[1]} is declared above it (write \`diagram ${dl[1]}\` first, or start the line with \\ to make it prose)`,
        L,
        lead + 1,
      );
      return;
    }
    this.textLine(s);
  }

  private textLine(s: string): void {
    if (this.acc?.kind !== 'paragraph') {
      this.flush();
      this.acc = { kind: 'paragraph', lines: [], line: this.lineNo };
    }
    this.acc.lines.push(s);
  }

  private listItem(ordered: boolean, n: number, item: ListItem): void {
    if (this.acc?.kind !== 'list' || this.acc.ordered !== ordered) {
      this.flush();
      this.acc = { kind: 'list', ordered, start: n, items: [], line: this.lineNo };
    }
    this.acc.items.push(item);
  }

  /** `-- text`, `-- 1. text`, `-- [x] text`: a sub-item of the last top-level item of the open list. */
  private subItem(body: string, lead: number): void {
    const ol = /^\d{1,9}[.)]\s+(.*)$/.exec(body);
    const task = /^\[([ xX])\]\s+(.*)$/.exec(body);
    const text = ol ? ol[1] : task ? task[2] : body;
    const checked = task ? task[1] !== ' ' : null;
    if (this.acc?.kind !== 'list') {
      this.diag(
        'error',
        'list-sub-orphan',
        'a `-- sub-item` needs a `- item` or `1. item` line directly above it; add the parent item, or start the line with \\ to make it prose',
        this.lineNo,
        lead + 1,
      );
      this.listItem(false, 1, { text, checked });
      return;
    }
    this.acc.items.push({ text, checked, level: 2, ordered: !!ol });
  }

  // ------------------------------------------------------------ accumulators

  private flush(): void {
    const a = this.acc;
    if (!a) return;
    this.acc = null;
    if (a.kind === 'paragraph') this.emit({ type: 'paragraph', text: a.lines.join(' '), line: a.line });
    else if (a.kind === 'list') this.emit({ type: 'list', ordered: a.ordered, start: a.start, items: a.items, line: a.line });
    else if (a.kind === 'kpis') this.emit({ type: 'kpis', items: a.items, line: a.line } satisfies KpiBlock);
    else if (a.kind === 'steps') this.emit({ type: 'steps', items: a.items, line: a.line });
    else {
      let cite: string | null = null;
      const lines = [...a.lines];
      const last = lines[lines.length - 1];
      if (lines.length > 1 && /^(—|--|–)\s*/.test(last)) {
        cite = last.replace(/^(—|--|–)\s*/, '');
        lines.pop();
      }
      this.emit({ type: 'quote', text: lines.join(' '), cite, line: a.line });
    }
  }

  private fenceLine(raw: string): void {
    const f = this.fence!;
    const t = raw.trim();
    if (/^`{3,}$/.test(t) && t.length >= f.ticks) {
      this.closeFence();
      return;
    }
    f.lines.push(raw);
  }

  private closeFence(): void {
    const f = this.fence!;
    this.fence = null;
    // Strip the common indentation so an indented fence reads like an unindented one.
    const ind = Math.min(...f.lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length), Infinity);
    const body = f.lines.map((l) => (Number.isFinite(ind) ? l.slice(ind) : l)).join('\n');
    if (f.raw) this.emit({ type: 'html', html: body, line: f.line });
    else this.emit({ type: 'code', lang: f.lang, text: body, line: f.line });
  }

  private emit(b: Block): void {
    // An open `cards` run takes blocks once its first ### has arrived. Content before that is
    // emitted as usual. Diagrams cannot sit in a card: they are shown after the cards block.
    // (A grid is never open inside a run: a `grid` line ends the run.)
    const c = this.cards;
    if (c?.card && b.type !== 'data') {
      if (b.type === 'diagram') {
        this.diag('warning', 'cards-content', `diagram ${b.name} cannot sit inside a card; it is shown after the cards`, b.line, 1);
        c.deferred.push(b);
      } else {
        c.card.blocks.push(b);
      }
      return;
    }
    if (this.grid && b.type !== 'data') {
      this.grid.children.push(b);
      if (this.grid.children.length >= this.grid.count) this.closeGrid(false);
      return;
    }
    this.doc.blocks.push(b);
    this.out.push(b);
  }

  /** End the open `cards` run: emit the cards block (or warn when it has no ### section), then deferred blocks. */
  private closeCards(): void {
    const c = this.cards!;
    this.cards = null;
    if (c.block.items.length === 0) {
      this.diag('warning', 'cards-empty', '`cards` needs `### Title` sections after it; ignored', c.block.line, 1);
    } else {
      this.emit(c.block);
    }
    for (const b of c.deferred) this.emit(b);
  }

  /** `heading` is the level of the heading that closed the grid early, if one did. */
  private closeGrid(early: boolean, heading?: number): void {
    const g = this.grid!;
    this.grid = null;
    if (early && g.children.length < g.count) {
      // `grid 3` then three ### sections is the commonest slip: the writer wanted `cards`.
      const hint =
        heading === 3 && g.children.length === 0
          ? 'to set ### sections side by side, write `cards` instead'
          : `put ${g.count} blocks between \`grid\` and the next heading, or lower the count`;
      this.diag(
        'warning',
        'grid-unfilled',
        `grid expected ${g.count} blocks but a ${heading ? 'heading' : 'new grid or cards'} came after ${g.children.length}; ${hint}`,
        g.line,
        1,
      );
    }
    this.doc.blocks.push(g);
    this.out.push(g);
  }

  // ------------------------------------------------------------ keywords

  private keyword(kw: string, rest: string, col: number, lead: number): void {
    const L = this.lineNo;
    if (kw === 'kpi') {
      this.kpiLine(rest, col);
      return;
    }
    if (kw === 'step') {
      this.stepLine(rest, col);
      return;
    }
    this.flush();
    switch (kw) {
      case 'cards': {
        if (this.cards) this.closeCards();
        if (this.grid) this.closeGrid(true);
        this.cards = { block: { type: 'cards', items: [], line: L }, card: null, deferred: [] };
        return;
      }
      case 'data':
        return this.dataLine(rest, col);
      case 'chart':
        return this.chartLine(rest, col);
      case 'table':
        return this.tableLine(rest, col);
      case 'image':
        return this.imageLine(rest, col);
      case 'grid': {
        const o = parseOpts(rest);
        const n = Number(o.words[0]);
        if (!Number.isInteger(n) || n < 1 || n > 4) {
          this.diag('error', 'grid-columns', 'grid needs a column count from 1 to 4, e.g. `grid 2`', L, col);
          return;
        }
        const count = o.kv.count !== undefined ? Number(o.kv.count) : n;
        if (!Number.isInteger(count) || count < 1) {
          this.diag('error', 'grid-count', 'grid count= must be a positive integer', L, col);
          return;
        }
        if (this.cards) {
          if (this.cards.card)
            this.diag('warning', 'cards-content', 'a grid cannot sit inside a card; it ends the cards above it', L, lead + 1);
          this.closeCards();
        }
        if (this.grid) this.closeGrid(true);
        this.grid = { type: 'grid', columns: n, count, children: [], line: L };
        return;
      }
      case 'diagram':
        return this.diagramDecl(rest, col);
    }
    this.diag('error', 'unknown-keyword', `unknown keyword ${kw}`, L, lead + 1);
  }

  private dataLine(rest: string, col: number): void {
    const L = this.lineNo;
    const m = /^([A-Za-z_][\w-]*)\s*(\+=|=|<)\s*(.*)$/.exec(rest);
    if (!m) {
      this.diag(
        'error',
        'data-syntax',
        'data needs `data name = col,col; v,v`, `data name += v,v` or `data name < file.csv` (start the line with \\ if it is prose)',
        L,
        col,
      );
      return;
    }
    const [, name, op, body] = m;
    const bodyCol = col + rest.indexOf(body, name.length + op.length);
    if (op === '<') {
      if (!this.opts.loadFile) {
        this.diag('error', 'data-file', `cannot read ${body}: file data is not available here`, L, bodyCol);
        return;
      }
      let text: string;
      try {
        text = this.opts.loadFile(body.trim());
      } catch (e) {
        this.diag('error', 'data-file', `cannot read ${body}: ${e instanceof Error ? e.message : String(e)}`, L, bodyCol);
        return;
      }
      const rows = text
        .split(/\r?\n/)
        .filter((r) => r.trim())
        .map((r) => parseInlineCsv(r).rows[0] ?? []);
      this.defineData(
        name,
        rows,
        rows.map(() => 0),
        bodyCol,
      );
      return;
    }
    const csv = parseInlineCsv(body);
    if (csv.unclosedAt !== null) this.diag('error', 'csv-quote', 'unclosed " in data', L, bodyCol + csv.unclosedAt);
    if (op === '=') {
      this.defineData(name, csv.rows, csv.offsets, bodyCol);
      return;
    }
    const d = this.doc.data[name];
    if (!d) {
      this.diag(
        'error',
        'unknown-data',
        `data ${name} += before \`data ${name} = ...\`; the first line for ${name} uses = and starts with the header`,
        L,
        col,
      );
      return;
    }
    this.addRows(d, csv.rows, csv.offsets, bodyCol);
  }

  private defineData(name: string, rows: string[][], offsets: number[], bodyCol: number): void {
    const L = this.lineNo;
    if (rows.length === 0 || rows[0].every((c) => c === '')) {
      this.diag('error', 'data-empty', `data ${name} has no header row`, L, bodyCol);
      return;
    }
    if (this.doc.data[name])
      this.diag('warning', 'data-redefined', `data ${name} is redefined; the new definition replaces it`, L, bodyCol);
    if (this.diagrams.has(name))
      this.diag('error', 'name-clash', `${name} is already a diagram name; rename the diagram (e.g. \`diagram ${name}-flow\`)`, L, bodyCol);
    const columns = rows[0].map((c) => c.trim());
    const dup = columns.find((c, i) => columns.indexOf(c) !== i);
    if (dup) this.diag('error', 'data-dup-column', `data ${name} has two columns named ${dup}`, L, bodyCol);
    const d: DataSet = { name, columns, rows: [], line: L };
    this.addRows(d, rows.slice(1), offsets.slice(1), bodyCol);
    this.doc.data[name] = d;
    this.emit({ type: 'data', name, line: L });
  }

  private addRows(d: DataSet, rows: string[][], offsets: number[], bodyCol: number): void {
    rows.forEach((r, i) => {
      if (r.length > d.columns.length) {
        // An unquoted thousands separator splits one number in two: "$1,450" -> "$1" "450".
        const fixed = mergeThousands(r, d.columns.length);
        if (fixed) {
          this.diag(
            'warning',
            'csv-thousands',
            `read "${fixed.merged.join('", "')}" as one number each; quote numbers that contain commas: ${fixed.merged.map((m) => `"${m}"`).join(', ')}`,
            this.lineNo,
            bodyCol + (offsets[i] ?? 0),
            { fields: r.length, want: d.columns.length, name: d.name },
          );
          r = fixed.row;
        }
      }
      if (r.length !== d.columns.length) {
        // A header cell split at a thousands comma (`left of $400,000`) makes every row look one short.
        const split = d.columns.findIndex((c, k) => /\d$/.test(c) && /^\d{3}$/.test(d.columns[k + 1] ?? ''));
        const hint =
          r.length > d.columns.length
            ? 'put a cell that contains , in double quotes ("like, this")'
            : split >= 0
              ? `the header cell "${d.columns[split]}" / "${d.columns[split + 1]}" looks split at a thousands comma: quote it ("${d.columns[split]},${d.columns[split + 1]}")`
              : 'a ; ends the row, so put a cell that contains ; in double quotes ("like; this"), or add the missing cells';
        this.diag(
          'error',
          'data-row-width',
          `row "${r.join(',')}" has ${r.length} fields; ${d.name} has ${d.columns.length} columns (${d.columns.join(',')}); ${hint}`,
          this.lineNo,
          bodyCol + (offsets[i] ?? 0),
          { fields: r.length, want: d.columns.length, name: d.name },
        );
        r = r.slice(0, d.columns.length);
        while (r.length < d.columns.length) r.push('');
      }
      d.rows.push(r);
    });
  }

  private requireData(name: string | undefined, col: number): DataSet | null {
    if (!name) {
      this.diag('error', 'missing-data', 'expected a data name', this.lineNo, col);
      return null;
    }
    const d = this.doc.data[name];
    if (!d) {
      const known = Object.keys(this.doc.data);
      this.diag(
        'error',
        'unknown-data',
        `no data named ${name} is declared above this line${known.length ? ` (known: ${known.join(', ')})` : ''}; declare it first with \`data ${name} = col,col; value,value\``,
        this.lineNo,
        col,
      );
      return null;
    }
    return d;
  }

  private requireCol(d: DataSet, c: string, col: number): boolean {
    if (findCol(d, c) !== null) return true;
    const guess = suggestColumn(d.columns, c);
    const hint = guess ? `; did you mean ${guess}?` : '; name one of them';
    this.diag('error', 'unknown-column', `${d.name} has no column ${c} (columns: ${d.columns.join(', ')})${hint}`, this.lineNo, col, {
      column: c,
      columns: d.columns,
    });
    return false;
  }

  private chartLine(rest: string, col: number): void {
    const L = this.lineNo;
    const t = tokens(rest);
    const kind = t[0]?.text as ChartKind | undefined;
    if (!kind || t[0].key !== undefined || !CHART_KINDS.includes(kind)) {
      this.diag('error', 'chart-kind', `chart needs a kind: ${CHART_KINDS.join(', ')} (e.g. \`chart line runs\`)`, L, col);
      return;
    }
    const dname = t[1] && t[1].key === undefined ? t[1].text : undefined;
    const d = this.requireData(dname, col + (t[1]?.offset ?? rest.length));
    if (!d) return;
    const optStr = rest.slice(t[2]?.offset ?? rest.length);
    if (kind === 'range') {
      this.rangeChart(d, optStr, col);
      return;
    }
    const o = parseOpts(optStr, ['stack', 'labels'], ['x', 'y', 'focus']);
    for (const w of [...o.words, ...o.quoted]) this.diag('warning', 'chart-option', `ignored chart option "${w}"`, L, col);
    const xRaw = o.kv.x ?? d.columns[0];
    if (!this.requireCol(d, xRaw, col)) return;
    const x = findCol(d, xRaw)!;
    let y: string[];
    if (o.kv.y) {
      y = o.kv.y
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      if (!y.every((c) => this.requireCol(d, c, col))) return;
      y = y.map((c) => findCol(d, c)!);
    } else {
      y = d.columns.filter((c) => c !== x && d.rows.some((r) => num(r[d.columns.indexOf(c)]) !== null));
      if (y.length === 0) {
        this.diag('error', 'chart-no-series', `${d.name} has no numeric column besides ${x}; set y=`, L, col);
        return;
      }
    }
    for (const c of y) {
      const bad = d.rows.filter((r) => num(r[d.columns.indexOf(c)]) === null && r[d.columns.indexOf(c)] !== '');
      if (bad.length)
        this.diag(
          'warning',
          'non-numeric',
          `${d.name}.${c} has non-numeric values (${bad
            .map((r) => r[d.columns.indexOf(c)])
            .slice(0, 3)
            .join(', ')}); they are left out`,
          L,
          col,
        );
    }
    const n = (k: string): number | null => {
      if (o.kv[k] === undefined) return null;
      const v = num(o.kv[k]);
      if (v === null) this.diag('error', 'chart-option', `${k}= must be a number`, L, col);
      return v;
    };
    if (o.kv.focus && findCol(d, o.kv.focus)) o.kv.focus = findCol(d, o.kv.focus)!;
    // focus names a series, or (for a single emphasized bar or point) one value of the x column.
    if (o.kv.focus && !y.includes(o.kv.focus) && !d.rows.some((r) => r[d.columns.indexOf(x)] === o.kv.focus)) {
      this.diag('warning', 'chart-option', `focus=${o.kv.focus} is not one of the series (${y.join(', ')}) or a value of ${x}`, L, col);
    }
    // target=99.9 or target="99.9 SLO": a dashed reference line, optionally labeled.
    let target: ChartBlock['target'] = null;
    if (o.kv.target !== undefined) {
      const tm = /^\s*([-+]?[\d.,]+)\s*(.*)$/.exec(o.kv.target);
      const tv = tm ? num(tm[1]) : null;
      if (tv === null) this.diag('error', 'chart-option', 'target= must start with a number, e.g. target="99.9 SLO"', L, col);
      else target = { value: tv, label: tm![2].trim() };
    }
    // mark="W3 deploy" (repeatable): an x category, then a label. The longest category that is a
    // prefix of the value, followed by a space or the end, wins ("Week 3" beats "Week").
    const marks: ChartMark[] = [];
    const markToks = tokens(rest.slice(t[2]?.offset ?? rest.length)).filter((k) => k.key === 'mark');
    if (markToks.length && kind === 'hbar') {
      this.diag('warning', 'chart-option', 'mark= applies to line, area and bar charts; ignored on hbar', L, col);
    } else if (markToks.length) {
      const xi = d.columns.indexOf(x);
      const cats = [...new Set(d.rows.map((r) => r[xi]).filter((c) => c !== ''))];
      for (const k of markToks) {
        const v = k.text.trim();
        const cat = cats.filter((c) => v === c || v.startsWith(`${c} `)).toSorted((a, b) => b.length - a.length)[0];
        if (cat === undefined) {
          const shown = cats.slice(0, 8).join(', ') + (cats.length > 8 ? ', …' : '');
          this.diag(
            'error',
            'chart-mark',
            `mark="${v}" does not start with a category of ${d.name}.${x} (${shown}); write mark="CATEGORY label" and quote it`,
            L,
            col,
          );
          continue;
        }
        marks.push({ x: cat, label: v.slice(cat.length).trim() });
      }
    }
    // labels=end / labels=all (v0.4): `labels` stays true; the mode says which values to print.
    let labels = o.flags.includes('labels');
    let labelMode: ChartBlock['labelMode'];
    if (o.kv.labels !== undefined) {
      if (o.kv.labels === 'end' || o.kv.labels === 'all') {
        labels = true;
        labelMode = o.kv.labels;
      } else this.diag('warning', 'chart-option', `labels= must be end or all (got "${o.kv.labels}"); ignored`, L, col);
    }
    const hatch = this.hatchOpt(d, x, optStr, col);
    const block: ChartBlock = {
      type: 'chart',
      kind,
      data: d.name,
      x,
      y,
      title: o.kv.title ?? null,
      stack: o.flags.includes('stack'),
      labels,
      unit: o.kv.unit ?? null,
      min: n('min'),
      max: n('max'),
      focus: o.kv.focus ?? null,
      target,
      line: L,
    };
    if (marks.length) block.marks = marks;
    if (labelMode !== undefined) block.labelMode = labelMode;
    if (hatch.length) block.hatch = hatch;
    if (block.stack && kind === 'line') this.diag('warning', 'chart-option', 'stack applies to bar, hbar and area charts', L, col);
    this.emit(block);
  }

  /** `hatch="x value"` (repeatable): values of the x column drawn striped. Anything else: W chart-option. */
  private hatchOpt(d: DataSet, x: string, optStr: string, col: number): string[] {
    const xi = d.columns.indexOf(x);
    const out: string[] = [];
    for (const k of tokens(optStr).filter((tk) => tk.key === 'hatch')) {
      const v = k.text.trim();
      if (!d.rows.some((r) => r[xi] === v)) {
        this.diag('warning', 'chart-option', `hatch="${v}" is not a value of ${d.name}.${x}; ignored`, this.lineNo, col);
        continue;
      }
      if (!out.includes(v)) out.push(v);
    }
    return out;
  }

  /**
   * `chart range DATA from=col to=col [at=col] [target="V label"] [bands=a,b,c] [unit=] [title=]` (v0.4).
   * One bar per row from `from` to `to`. All from/to/at cells are numbers, or all ISO dates.
   * `y` is always [] (the span columns are `from`/`to`); `stack` and `labels` mean nothing here.
   */
  private rangeChart(d: DataSet, optStr: string, col: number): void {
    const L = this.lineNo;
    const o = parseOpts(optStr, ['stack', 'labels'], ['x', 'from', 'to', 'at', 'focus']);
    for (const w of [...o.words, ...o.quoted]) this.diag('warning', 'chart-option', `ignored chart option "${w}"`, L, col);
    const xRaw = o.kv.x ?? d.columns[0];
    if (!this.requireCol(d, xRaw, col)) return;
    const x = findCol(d, xRaw)!;
    if (!o.kv.from || !o.kv.to) {
      this.diag('error', 'unknown-column', `chart range needs from=col and to=col (columns of ${d.name}: ${d.columns.join(', ')})`, L, col);
      return;
    }
    const named = [o.kv.from, o.kv.to, ...(o.kv.at ? [o.kv.at] : [])];
    if (!named.every((c) => this.requireCol(d, c, col))) return;
    const [from, to, at] = named.map((c) => findCol(d, c)!);
    // Every non-empty from/to/at cell must be a number, or every one an ISO date.
    const kindOf = (v: string): 'number' | 'date' | null =>
      ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? 'date' : num(v) !== null ? 'number' : null;
    let rk: 'number' | 'date' | null = null;
    const spanCols = [from, to, at].filter((c): c is string => !!c);
    for (const c of spanCols) {
      const ci = d.columns.indexOf(c);
      for (const r of d.rows) {
        const v = r[ci].trim();
        if (v === '') continue;
        const k = kindOf(v);
        if (k === null || (rk !== null && k !== rk)) {
          this.diag(
            'error',
            'chart-range-kind',
            `${d.name}.${c} has "${v}"; chart range needs every ${spanCols.join('/')} cell to be a number, or every one an ISO date (2026-03-01)`,
            L,
            col,
          );
          return;
        }
        rk = k;
      }
    }
    const kind = rk ?? 'number';
    // target="V label": V is a number, or an ISO date (stored as UTC epoch milliseconds) on a date axis.
    let target: ChartBlock['target'] = null;
    if (o.kv.target !== undefined) {
      const tm =
        kind === 'date' ? /^\s*(\d{4}-\d{2}-\d{2})(?:\s+(.*))?$/.exec(o.kv.target) : /^\s*([-+]?[\d.,]+)\s*(.*)$/.exec(o.kv.target);
      // On a number axis a date-looking target ("2026-01-01 x") is an error, not 2026.
      const tv = !tm
        ? null
        : kind === 'date'
          ? kindOf(tm[1]) === 'date'
            ? Date.parse(`${tm[1]}T00:00:00Z`)
            : null
          : /^\s*\d{4}-\d{2}-\d{2}/.test(o.kv.target)
            ? null
            : num(tm[1]);
      if (tv === null)
        this.diag(
          'error',
          'chart-option',
          kind === 'date'
            ? 'target= must start with an ISO date on a date range, e.g. target="2026-03-15 launch"'
            : 'target= must start with a number, e.g. target="99.9 SLO"',
          L,
          col,
        );
      else target = { value: tv, label: (tm![2] ?? '').trim() };
    }
    // bands=a,b,c: threshold ticks, as written, of the axis kind; at most 4.
    let bands: string[] = [];
    if (o.kv.bands !== undefined) {
      for (const v of o.kv.bands
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean)) {
        if (kindOf(v) === kind) bands.push(v);
        else
          this.diag(
            'warning',
            'chart-option',
            `bands value "${v}" is not ${kind === 'date' ? 'an ISO date' : 'a number'}; ignored`,
            L,
            col,
          );
      }
      if (bands.length > 4) {
        this.diag('warning', 'bands-limit', `bands= takes at most 4 values; ${bands.slice(4).join(', ')} ignored`, L, col);
        bands = bands.slice(0, 4);
      }
    }
    const n = (k: string): number | null => {
      if (o.kv[k] === undefined) return null;
      if (kind === 'date') {
        this.diag('warning', 'chart-option', `${k}= is not used on a date range; ignored`, L, col);
        return null;
      }
      const v = num(o.kv[k]);
      if (v === null) this.diag('error', 'chart-option', `${k}= must be a number`, L, col);
      return v;
    };
    if (tokens(optStr).some((k) => k.key === 'mark'))
      this.diag('warning', 'chart-option', 'mark= applies to line, area and bar charts; ignored on range', L, col);
    const focus: string | null = o.kv.focus ?? null;
    if (focus !== null && !d.rows.some((r) => r[d.columns.indexOf(x)] === focus)) {
      this.diag('warning', 'chart-option', `focus=${focus} is not a value of ${x}`, L, col);
    }
    const hatch = this.hatchOpt(d, x, optStr, col);
    const block: ChartBlock = {
      type: 'chart',
      kind: 'range',
      data: d.name,
      x,
      y: [],
      title: o.kv.title ?? null,
      stack: false,
      labels: false,
      unit: o.kv.unit ?? null,
      min: n('min'),
      max: n('max'),
      focus,
      target,
      from,
      to,
      line: L,
    };
    if (at !== undefined) block.at = at;
    if (bands.length) block.bands = bands;
    if (hatch.length) block.hatch = hatch;
    this.emit(block);
  }

  private tableLine(rest: string, col: number): void {
    const L = this.lineNo;
    // Anonymous inline table: `table [opts] = h,h; v,v`
    const eq = /(^|\s)=(\s|$)/.exec(rest);
    let d: DataSet | null;
    let optStr: string;
    if (eq) {
      optStr = rest.slice(0, eq.index);
      const body = rest.slice(eq.index + eq[0].length);
      const name = `_table${++this.anon}`;
      const csv = parseInlineCsv(body);
      const bodyCol = col + eq.index + eq[0].length;
      if (csv.unclosedAt !== null) this.diag('error', 'csv-quote', 'unclosed " in table', L, bodyCol + csv.unclosedAt);
      if (csv.rows.length === 0) {
        this.diag('error', 'data-empty', 'inline table has no header row', L, bodyCol);
        return;
      }
      d = { name, columns: csv.rows[0], rows: [], line: L };
      this.addRows(d, csv.rows.slice(1), csv.offsets.slice(1), bodyCol);
      this.doc.data[name] = d;
    } else {
      const t = tokens(rest);
      d = this.requireData(t[0]?.key === undefined ? t[0]?.text : undefined, col);
      optStr = rest.slice(t[1]?.offset ?? rest.length);
    }
    if (!d) return;
    const o = parseOpts(optStr, ['heat'], ['cols', 'sort', 'heat', 'bar', 'target']);
    for (const w of [...o.words, ...o.quoted]) {
      // `table vendors = ...` names an inline table, which has no name: say how to get one.
      const hint =
        eq && w === o.words[0] && /^[A-Za-z_][\w-]*$/.test(w) && !TABLE_OPTIONS.includes(w)
          ? `; an inline table has no name: write \`table = ...\`, or \`data ${w} = ...\` then \`table ${w}\``
          : ' (options: cols= sort= limit= title= heat bar= target=)';
      this.diag('warning', 'table-option', `ignored table option "${w}"${hint}`, L, col);
    }
    let cols: string[] | null = null;
    if (o.kv.cols) {
      cols = o.kv.cols
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (!cols.every((c) => this.requireCol(d, c, col))) return;
      cols = cols.map((c) => findCol(d, c)!);
    }
    let sort: TableBlock['sort'] = null;
    if (o.kv.sort) {
      const desc = o.kv.sort.startsWith('-');
      const c = o.kv.sort.replace(/^[-+]/, '');
      if (!this.requireCol(d, c, col)) return;
      sort = { col: findCol(d, c)!, desc };
    }
    // heat / heat=a,b tints numeric cells by rank; bar=a,b draws a proportional bar behind a column's numbers.
    // A column that does not exist is an error; one that is not numeric is ignored with a warning.
    const numericCol = (c: string) => {
      const i = d.columns.indexOf(c);
      return d.rows.some((r) => num(r[i]) !== null) && d.rows.every((r) => r[i] === '' || num(r[i]) !== null);
    };
    const pickCols = (list: string): string[] | null => {
      const named = list
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (!named.every((c) => this.requireCol(d, c, col))) return null;
      return named
        .map((c) => findCol(d, c)!)
        .filter((c) => {
          if (numericCol(c)) return true;
          this.diag('warning', 'table-option', `${c} is not a numeric column; it is ignored`, L, col);
          return false;
        });
    };
    let heat: TableBlock['heat'];
    if (o.kv.heat !== undefined) {
      const cs = pickCols(o.kv.heat);
      if (cs === null) return;
      if (cs.length) heat = cs;
    } else if (o.flags.includes('heat')) heat = true;
    let bars: TableBlock['bars'];
    if (o.kv.bar !== undefined) {
      const cs = pickCols(o.kv.bar);
      if (cs === null) return;
      if (cs.length) bars = cs;
    }
    // target=col (v0.4): each row's tick on its bar= bar. Misuse is a warning and the option is dropped.
    let targetCol: string | undefined;
    if (o.kv.target !== undefined) {
      const c = findCol(d, o.kv.target.trim());
      if (!bars) this.diag('warning', 'table-option', 'target= needs bar= (a numeric bar column) on the same table; ignored', L, col);
      else if (!c) this.diag('warning', 'table-option', `${d.name} has no column ${o.kv.target} for target=; ignored`, L, col);
      else if (!numericCol(c)) this.diag('warning', 'table-option', `target=${c} is not a numeric column; ignored`, L, col);
      else targetCol = c;
    }
    let limit: number | null = null;
    if (o.kv.limit !== undefined) {
      limit = Number(o.kv.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        this.diag('error', 'table-option', 'limit= must be a positive integer', L, col);
        limit = null;
      }
    }
    const block: TableBlock = { type: 'table', data: d.name, cols, sort, limit, title: o.kv.title ?? null, line: L };
    if (heat !== undefined) block.heat = heat;
    if (bars !== undefined) block.bars = bars;
    if (targetCol !== undefined) block.targetCol = targetCol;
    this.emit(block);
  }

  private kpiLine(rest: string, col: number): void {
    const L = this.lineNo;
    if (!rest.includes('|')) {
      this.flush();
      this.diag('error', 'kpi-syntax', 'kpi needs `kpi Label | value | delta` (start the line with \\ if it is prose)', L, col);
      return;
    }
    // v0.4: a field exactly `bar` after the value asks for a progress bar; it is not a tone or a note.
    let bar = false;
    const parts = rest
      .split('|')
      .map((p) => p.trim())
      .filter((p, i) => {
        if (i >= 2 && p === 'bar') {
          bar = true;
          return false;
        }
        return true;
      });
    const [label, value = '', delta = '', extra = ''] = parts;
    if (parts.length > 4) this.diag('warning', 'kpi-syntax', 'kpi takes at most 4 fields: label | value | delta | tone-or-note', L, col);
    if (!label || !value) this.diag('error', 'kpi-syntax', 'kpi needs a label and a value', L, col);
    const tone = /^(good|bad|neutral)$/.test(extra) ? (extra as Kpi['tone']) : null;
    const ref = value.startsWith('=') ? value.slice(1).trim() : null;
    if (ref) {
      const m = /^([A-Za-z_][\w-]*)\.(.+)$/.exec(ref);
      const d = m ? this.doc.data[m[1]] : undefined;
      if (!m) this.diag('error', 'kpi-ref', `kpi reference must be =data.column, got =${ref}`, L, col);
      else if (!d) this.requireData(m[1], col);
      else this.requireCol(d, m[2], col);
    }
    if (bar) {
      // The bar needs a percent or a number from 0 to 100. A reference is checked against the rows so far.
      let v = value;
      if (ref) {
        const m = /^([A-Za-z_][\w-]*)\.(.+)$/.exec(ref);
        const d = m ? this.doc.data[m[1]] : undefined;
        const c = d && m ? findCol(d, m[2]) : null;
        v = d && c ? (d.rows.map((r) => r[d.columns.indexOf(c)]).findLast((x) => x !== '') ?? '') : '';
      }
      const pm = /^([-+]?(?:\d+\.?\d*|\.\d+))\s*%?$/.exec(v.trim());
      const pv = pm ? Number(pm[1]) : NaN;
      if (!(pv >= 0 && pv <= 100)) {
        // Writers put the count in the value and the percent in the change; say which way round it goes.
        const pct = !ref && PERCENT.test(delta) ? delta : '';
        const hint = pct
          ? `write the percent as the value: \`kpi ${label} | ${pct} | ${value} | bar\``
          : `make the value a percent from 0 to 100${value && !ref ? ` and move ${value} to the change field` : ''}, or drop bar`;
        this.diag(
          'warning',
          'kpi-bar',
          `bar needs a value that is a percent or a number from 0 to 100 (got "${v}"); no bar drawn; ${hint}`,
          L,
          col,
        );
        bar = false;
      }
    }
    if (this.acc?.kind !== 'kpis') {
      this.flush();
      this.acc = { kind: 'kpis', items: [], line: L };
    }
    const k: Kpi = { label, value: ref ? '' : value, delta, tone, note: tone ? '' : extra, ref };
    if (bar) k.bar = true;
    this.acc.items.push(k);
  }

  /** `step Title | deadline | note` (v0.4). Consecutive step lines form one steps block. */
  private stepLine(rest: string, col: number): void {
    const L = this.lineNo;
    const [title = '', due = '', ...more] = rest.split('|').map((p) => p.trim());
    if (!title) {
      this.diag(
        'warning',
        'step-syntax',
        'step needs a title: `step Title | deadline | note` (start the line with \\ if it is prose); ignored',
        L,
        col,
      );
      return;
    }
    if (this.acc?.kind !== 'steps') {
      this.flush();
      this.acc = { kind: 'steps', items: [], line: L };
    }
    this.acc.items.push({ title, due, note: more.join(' | '), line: L });
  }

  private imageLine(rest: string, col: number): void {
    const L = this.lineNo;
    const t = tokens(rest);
    const src = t[0] && t[0].key === undefined && !t[0].quoted ? t[0].text : '';
    if (!src) {
      this.diag('error', 'image-syntax', 'image needs `image path-or-url "alt text"`', L, col);
      return;
    }
    const alt = t.find((x) => x.quoted && x.key === undefined)?.text ?? t.find((x) => x.key === 'alt')?.text;
    if (alt === undefined || alt.trim() === '') {
      this.diag('error', 'image-alt', 'image needs alt text in quotes: image chart.png "Weekly deploys, rising"', L, col);
      return;
    }
    // Allowed: relative paths, http(s) URLs (loaded only if the host opts in) and data:image URIs.
    // `//host/x.png` is a remote URL that borrows the page's scheme; treat it like one. Both checks
    // read the URL as the browser will (`\` as `/`, control characters dropped).
    if (browserUrl(src).startsWith('//') || src.startsWith('\\')) {
      this.diag('error', 'image-src', 'write remote images as https://… (protocol-relative // URLs are not allowed)', L, col);
      return;
    }
    if (imageSrcKind(src) === 'bad') {
      this.diag('error', 'image-src', 'image src must be a path, https: URL or data:image URI', L, col);
      return;
    }
    this.emit({ type: 'image', src, alt, caption: t.find((x) => x.key === 'caption')?.text ?? null, line: L });
  }

  // ------------------------------------------------------------ diagrams

  private diagramDecl(rest: string, col: number): void {
    const L = this.lineNo;
    const t = tokens(rest);
    const name = t[0] && t[0].key === undefined && !t[0].quoted ? t[0].text : '';
    if (!/^[A-Za-z][\w-]*$/.test(name)) {
      this.diag('error', 'diagram-name', 'diagram needs a name: `diagram flow` then lines like `flow: a -> b`', L, col);
      return;
    }
    if ((KEYWORDS as readonly string[]).includes(name) || name === 'html') {
      this.diag('error', 'diagram-name', `${name} is a keyword and cannot name a diagram`, L, col);
      return;
    }
    if (this.diagrams.has(name)) {
      this.diag('error', 'diagram-redeclared', `diagram ${name} is already declared on line ${this.diagrams.get(name)!.line}`, L, col);
      return;
    }
    if (this.doc.data[name])
      this.diag('error', 'name-clash', `${name} is already a data name; rename the diagram (e.g. \`diagram ${name}-flow\`)`, L, col, {
        diagram: name,
      });
    const o = parseOpts(rest.slice(t[1]?.offset ?? rest.length), ['flow', 'sequence']);
    for (const w of o.words) this.diag('warning', 'diagram-option', `ignored diagram option "${w}"`, L, col);
    const kind = o.flags.includes('sequence') ? 'sequence' : 'flow';
    const dirRaw = (o.kv.dir ?? (kind === 'sequence' ? 'LR' : 'TB')).toUpperCase();
    const dir = (['LR', 'TB', 'RL', 'BT'].includes(dirRaw) ? dirRaw : 'TB') as DiagramBlock['dir'];
    if (dirRaw !== dir) this.diag('warning', 'diagram-option', `dir must be LR, TB, RL or BT`, L, col);
    const d: DiagramBlock = {
      type: 'diagram',
      name,
      kind,
      dir,
      title: o.kv.title ?? null,
      nodes: [],
      edges: [],
      groups: [],
      notes: [],
      line: L,
    };
    this.diagrams.set(name, d);
    this.emit(d);
  }

  private node(d: DiagramBlock, id: string): DiagramNode {
    let n = d.nodes.find((x) => x.id === id);
    if (!n) {
      n = { id, label: id, kind: null, sub: null, focus: false };
      d.nodes.push(n);
    }
    return n;
  }

  /** alt/opt/else/end in a sequence diagram. Frames are flat: one open at a time, positions are edge indexes. */
  private frameLine(d: DiagramBlock, word: 'alt' | 'opt' | 'else' | 'end', rest: string, col: number): void {
    const L = this.lineNo;
    const st = this.seq.get(d) ?? { open: null, skip: 0 };
    this.seq.set(d, st);
    const at = d.edges.length;
    const cond = rest.startsWith('"') ? readQuoted(rest, 0).value : rest;
    if (word === 'alt' || word === 'opt') {
      if (st.open || st.skip) {
        st.skip++;
        this.diag(
          'error',
          'diagram-block-nested',
          `${word} inside the ${st.open?.kind ?? 'alt/opt'} block${st.open ? ` opened on line ${st.open.line}` : ''}: blocks cannot nest. Write \`${d.name}: end\` to close it first (this ${word} and its end are ignored)`,
          L,
          col,
        );
        return;
      }
      if (!cond)
        this.diag(
          'error',
          'diagram-block-syntax',
          `${word} needs a condition, e.g. \`${d.name}: ${word} "cache hit"\` (the block is still opened)`,
          L,
          col,
        );
      const f: DiagramFrame = {
        kind: word,
        branches: [{ label: cond, from: at, to: null, line: L }],
        from: at,
        to: null,
        line: L,
        endLine: null,
      };
      (d.frames ??= []).push(f);
      st.open = f;
      return;
    }
    if (st.skip) {
      if (word === 'end') st.skip--;
      return;
    }
    const f = st.open;
    if (!f) {
      this.diag(
        'error',
        'diagram-block-stray',
        word === 'end'
          ? `end closes nothing: no alt or opt is open in ${d.name}. Remove it, or open the block above with \`${d.name}: alt "condition"\``
          : `else belongs inside an alt block: no alt is open in ${d.name}. Open one above with \`${d.name}: alt "condition"\``,
        L,
        col,
      );
      return;
    }
    if (word === 'else') {
      if (f.kind === 'opt') {
        this.diag(
          'error',
          'diagram-block-stray',
          `opt has no else (opened on line ${f.line}): use \`${d.name}: alt "condition"\` for a block with branches`,
          L,
          col,
        );
        return;
      }
      f.branches[f.branches.length - 1].to = at;
      f.branches.push({ label: cond, from: at, to: null, line: L });
      return;
    }
    if (rest) this.diag('warning', 'diagram-block-syntax', `end takes nothing after it; "${rest}" is ignored`, L, col);
    f.branches[f.branches.length - 1].to = at;
    f.to = at;
    f.endLine = L;
    st.open = null;
  }

  private diagramLine(d: DiagramBlock, s: string, col: number): void {
    const L = this.lineNo;
    const ID = /^[A-Za-z0-9_][\w.-]*$/;
    if (s === '') {
      this.diag('warning', 'diagram-empty-line', `empty ${d.name}: line`, L, col);
      return;
    }

    // NAME: legend (v0.4): a key of node kinds and arrow styles. Flow diagrams only.
    if (s === 'legend') {
      if (d.kind === 'sequence')
        this.diag('warning', 'legend-kind', `legend applies to flow diagrams; ignored on sequence diagram ${d.name}`, L, col);
      else d.legend = true;
      return;
    }

    // alt "cond" / opt "cond" / else ["cond"] / end   (sequence only). A line that starts with one of
    // these words and then an arrow or a comma is still an edge from a participant of that name.
    if (d.kind === 'sequence') {
      const bm = /^(alt|opt|else|end)(?:\s+(.*))?$/.exec(s);
      if (bm && !/^(<->|-->|->|,)/.test(bm[2] ?? '')) {
        this.frameLine(d, bm[1] as 'alt' | 'opt' | 'else' | 'end', (bm[2] ?? '').trim(), col);
        return;
      }
    }

    // note a[, b] : text   (sequence)
    const nm = /^note\s+([^:]+):\s*(.*)$/.exec(s);
    if (nm) {
      const over = nm[1]
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (!over.every((x) => ID.test(x))) {
        this.diag('error', 'diagram-syntax', 'note needs `note id : text`', L, col);
        return;
      }
      if (d.kind !== 'sequence') this.diag('warning', 'diagram-note', 'notes only render in sequence diagrams', L, col);
      over.forEach((x) => this.node(d, x));
      // `after` places the note between messages: it follows the first `after` edges.
      d.notes.push({ over, text: nm[2].trim(), after: d.edges.length, line: L });
      return;
    }

    // group [id] "Label" a, b, c
    if (/^group(\s|$)/.test(s)) {
      const body = s.slice(5).trim();
      let id: string | null = null;
      let i = 0;
      const im = /^([A-Za-z0-9_][\w.-]*)\s+(?=")/.exec(body);
      if (im) {
        id = im[1];
        i = im[0].length;
      }
      if (body[i] !== '"') {
        this.diag('error', 'diagram-syntax', 'group needs `group [id] "Label" member, member`', L, col);
        return;
      }
      const q = readQuoted(body, i);
      const members = body
        .slice(q.end)
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!members.length) {
        this.diag('error', 'diagram-syntax', `group "${q.value}" has no members`, L, col);
        return;
      }
      const gid = id ?? `group${d.groups.length + 1}`;
      const declared = this.declared.get(d) ?? new Set<string>();
      if (d.groups.some((g) => g.id === gid) || (id && declared.has(gid))) {
        this.diag('error', 'diagram-syntax', `group id ${gid} is already used`, L, col);
        return;
      }
      // An id first used in an edge (`prodvpc -> tgw`) and later declared as a group is that group:
      // its edges attach to the group's boundary.
      if (id) d.nodes = d.nodes.filter((n) => n.id !== gid);
      for (const m of members) {
        if (!ID.test(m)) {
          this.diag('error', 'diagram-syntax', `bad member id "${m}"`, L, col);
          return;
        }
        if (!d.groups.some((g) => g.id === m)) this.node(d, m);
      }
      const owner = d.groups.find((g) => members.some((m) => g.members.includes(m) && !d.groups.some((x) => x.id === m)));
      if (owner)
        this.diag('warning', 'diagram-group', `a node is in both "${owner.label}" and "${q.value}"; it is drawn in the first`, L, col);
      d.groups.push({ id: gid, label: q.value, members });
      return;
    }

    // edges: a -> b, c --> d : label
    if (/(-->|->|<->|\s-x-\s)/.test(s)) {
      const ci = s.indexOf(':');
      const chain = ci >= 0 ? s.slice(0, ci) : s;
      const label = ci >= 0 ? s.slice(ci + 1).trim() : '';
      // `-x-` needs spaces around it so ids such as `a-x-b` stay ids; `-x->` is unambiguous.
      const parts = chain.split(/(\s+-x-\s+|\s*(?:<->|-->|-x->|->)\s*)/).map((p, i) => (i % 2 ? p.trim() : p));
      const steps: string[][] = [];
      const ops: string[] = [];
      parts.forEach((p, i) => (i % 2 ? ops.push(p) : steps.push(p.split(',').map((x) => x.trim()))));
      for (const ids of steps) {
        for (const id of ids) {
          if (!ID.test(id)) {
            const hint = id.includes('"') ? ' (declare labels on their own line: `x "Label"`)' : '';
            this.diag('error', 'diagram-syntax', `bad node id "${id}" in edge${hint}`, L, col);
            return;
          }
        }
      }
      if (d.kind === 'sequence' && steps.some((x) => x.length > 1)) {
        this.diag('error', 'diagram-syntax', 'sequence messages go between exactly two participants', L, col);
        return;
      }
      for (let i = 0; i < ops.length; i++) {
        for (const a of steps[i])
          for (const b of steps[i + 1]) {
            if (!d.groups.some((g) => g.id === a)) this.node(d, a);
            if (!d.groups.some((g) => g.id === b)) this.node(d, b);
            // In a chain the label belongs to the last hop: `commit -> build -> deploy : on green`.
            const e: DiagramEdge = {
              from: a,
              to: b,
              label: i === ops.length - 1 ? label : '',
              style: ops[i] === '-->' ? 'dashed' : ops[i] === '-x-' || ops[i] === '-x->' ? 'blocked' : 'solid',
              both: ops[i] === '<->',
              line: L,
            };
            d.edges.push(e);
          }
      }
      return;
    }

    // node: id "Label" [kind] [focus] ["sub label"]
    const t = tokens(s);
    const id = t[0]?.text;
    if (!id || t[0].quoted || t[0].key !== undefined || !ID.test(id)) {
      this.diag(
        'error',
        'diagram-syntax',
        `cannot read "${s}": expected \`id "Label" [kind]\`, \`a -> b : label\`, \`group "Label" a, b\` or \`note a : text\``,
        L,
        col,
      );
      return;
    }
    if (d.groups.some((g) => g.id === id)) {
      this.diag('error', 'diagram-syntax', `${id} is a group id`, L, col);
      return;
    }
    const n = this.node(d, id);
    if (!this.declared.has(d)) this.declared.set(d, new Set());
    this.declared.get(d)!.add(id);
    const q = t.slice(1).filter((x) => x.quoted && x.key === undefined);
    if (q[0]) n.label = q[0].text;
    if (q[1]) n.sub = q[1].text;
    for (const w of t.slice(1).filter((x) => !x.quoted && x.key === undefined)) {
      if (w.text === 'focus' || w.text === '*') n.focus = true;
      else if (/^[a-z][\w-]*$/.test(w.text) && !n.kind) n.kind = w.text;
      else this.diag('warning', 'diagram-option', `ignored "${w.text}" on node ${id}`, L, col + w.offset);
    }
    for (const kv of t.filter((x) => x.key !== undefined)) {
      if (kv.key === 'sub') n.sub = kv.text;
      else if (kv.key === 'kind') n.kind = kv.text;
      else this.diag('warning', 'diagram-option', `ignored ${kv.key}= on node ${id}`, L, col + kv.offset);
    }
  }

  private diag(
    severity: Diagnostic['severity'],
    code: string,
    message: string,
    line: number,
    col: number,
    detail?: Diagnostic['detail'],
  ): void {
    this.doc.diagnostics.push({ severity, code, message, line, col: Math.max(1, col), ...(detail ? { detail } : {}) });
  }
}

export function mergeThousands(r: string[], want: number): { row: string[]; merged: string[] } | null {
  const row = [...r];
  const merged: string[] = [];
  for (let i = 1; i < row.length && row.length > want; i++) {
    if (/^\d{3}(\.\d+)?%?$/.test(row[i]) && /^[-+$€£]?\d{1,3}(,\d{3})*$/.test(row[i - 1])) {
      row.splice(i - 1, 2, `${row[i - 1]},${row[i]}`);
      merged.push(row[i - 1]);
      i--;
    }
  }
  return row.length === want ? { row, merged } : null;
}

/** The option names of a `table` line; a bare one (`table bar = ...`) is a slip in the option, not a name for the table. */
export const TABLE_OPTIONS = ['cols', 'sort', 'limit', 'title', 'heat', 'bar', 'target'];

/** A plain percent from 0 to 100, the value a kpi bar takes (`63.0%`); a signed change (`+3%`) is not one. */
export const PERCENT = /^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)\s*%$/;

const colKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The one column a mistyped name most likely meant: the single column it is a prefix of (`delay` for
 * `delay ms`), or the longest column it starts with before a stray word (`customers sort` for
 * `customers`). The message suggests it and `check --fix` repairs the line to it.
 */
export function suggestColumn(columns: string[], name: string): string | null {
  const want = colKey(name);
  const longer = columns.filter((c) => colKey(c).startsWith(want) && colKey(c) !== want);
  if (longer.length === 1) return longer[0];
  const shorter = columns.filter((c) => want.startsWith(`${colKey(c)} `)).toSorted((a, b) => b.length - a.length);
  return shorter[0] ?? null;
}

/** Resolve a column reference: exact match first, then ignoring case and repeated spaces. */
export function findCol(d: DataSet, name: string): string | null {
  if (d.columns.includes(name)) return name;
  return d.columns.find((c) => colKey(c) === colKey(name)) ?? null;
}

/** Post-parse resolution: kpi references and diagram sanity checks. Idempotent. */
export function resolve(doc: LedeDocument): void {
  const visit = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.type === 'grid') visit(b.children);
      if (b.type === 'cards') for (const c of b.items) visit(c.blocks);
      if (b.type === 'kpis') for (const k of b.items) resolveKpi(doc, k);
      if (b.type === 'diagram') {
        if (b.nodes.length === 0) {
          doc.diagnostics.push({
            severity: 'warning',
            code: 'diagram-empty',
            message: `diagram ${b.name} has no nodes (lines must start with \`${b.name}:\`)`,
            line: b.line,
            col: 1,
          });
        }
        for (const f of b.frames ?? []) {
          if (f.to === null) {
            doc.diagnostics.push({
              severity: 'error',
              code: 'diagram-block-unclosed',
              message: `${f.kind} opened on line ${f.line} is never closed; add \`${b.name}: end\` after its last message`,
              line: f.line,
              col: 1,
            });
          }
        }
        const gids = new Set(b.groups.map((g) => g.id));
        // Group cycles: a group may not contain itself through nesting.
        for (const g of b.groups) {
          const seen = new Set<string>();
          const walk = (id: string): boolean => {
            if (seen.has(id)) return true;
            seen.add(id);
            const gg = b.groups.find((x) => x.id === id);
            return !!gg && gg.members.some((m) => gids.has(m) && walk(m));
          };
          if (walk(g.id) && g.members.some((m) => gids.has(m))) {
            const cyc = g.members.find((m) => gids.has(m) && b.groups.find((x) => x.id === m)!.members.includes(g.id));
            if (cyc)
              doc.diagnostics.push({
                severity: 'error',
                code: 'diagram-group-cycle',
                message: `groups ${g.id} and ${cyc} contain each other`,
                line: b.line,
                col: 1,
              });
          }
        }
      }
    }
  };
  visit(doc.blocks);
}

function resolveKpi(doc: LedeDocument, k: Kpi): void {
  if (!k.ref) return;
  const m = /^([A-Za-z_][\w-]*)\.(.+)$/.exec(k.ref);
  const d = m && doc.data[m[1]];
  const cname = m && d ? findCol(d, m[2]) : null;
  if (!m || !d || !cname) return;
  const ci = d.columns.indexOf(cname);
  const vals = d.rows.map((r) => r[ci]).filter((v) => v !== '');
  const last = vals[vals.length - 1] ?? '';
  k.value = last;
  if (!k.delta && vals.length > 1) {
    const a = num(vals[vals.length - 2]);
    const b = num(last);
    if (a !== null && b !== null) {
      const diff = b - a;
      const dec = Math.max(decimals(vals[vals.length - 2]), decimals(last));
      k.delta = diff === 0 ? '0' : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(dec)}`;
    }
  }
}

function decimals(v: string): number {
  const m = /\.(\d+)/.exec(v);
  return m ? m[1].length : 0;
}

export function parse(src: string, opts: ParseOptions = {}): LedeDocument {
  const p = new LedeParser(opts);
  for (const line of src.split('\n')) p.pushLine(line);
  return p.end();
}
