import type {
  Block,
  BucketBlock,
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
  EdgeTone,
  ExportBlock,
  GridBlock,
  Kpi,
  KpiBlock,
  ListItem,
  LedeDocument,
  ParamBlock,
  PresetBlock,
  QuestionBlock,
  Step,
  TableBlock,
  TemplateBlock,
  ToggleBlock,
} from './ast.ts';
import { cellNum, num, parseCsvFile, parseInlineCsv, parseOpts, pipeOutsideQuotes, readQuoted, tokens, type Opts } from './lex.ts';
import { EMPTY, FIELD_KINDS, NOT_CHOSEN, SLOT_RE } from './fields.ts';
import { AA_NON_TEXT, AA_TEXT, HEX_COLOR, accentContrast, accentTheme } from './contrast.ts';
import { browserUrl, imageSrcKind } from './url.ts';
import { walkBlocks } from './walk.ts';

/**
 * Callbacks for a streaming consumer, the second argument of `new LedeParser` (`LedeStream.events` installs them). Each runs after
 * the line has been applied. They are not a `ParseOptions` field, so `parse` and the snapshot parser cannot take them.
 */
export interface ParseHooks {
  /**
   * A `name:` line was read for the diagram `block` declared earlier. `changed` is false when the line was rejected or repeated what
   * the diagram already has (its nodes, edges, groups, notes, frames and legend are as they were); it is still a line of the diagram.
   */
  onDiagramLine(block: DiagramBlock, changed: boolean): void;
  /**
   * A `NAME: ITEM | BUCKET` line was read for the bucket set `block` declared earlier (spec §4.19). `changed` is true when the item
   * was added, and false when the line was rejected (no text, no bucket, an unknown bucket) or repeated an item the set has. The
   * line is a statement of the set either way, as a rejected line is a statement of a diagram. Optional, so a hooks object written
   * before bucket sets existed keeps working.
   */
  onBucketItem?(block: BucketBlock, changed: boolean): void;
  /** `data NAME += rows` appended rows to the data set `name`. */
  onDataAppend(name: string): void;
}

export interface ParseOptions {
  /** Resolves `data name < path`. Without it, file data is an error (browsers, sandboxes). */
  loadFile?: (path: string) => string;
}

export const KEYWORDS = [
  'data',
  'chart',
  'table',
  'kpi',
  'diagram',
  'image',
  'grid',
  'cards',
  'step',
  'ask',
  'choose',
  'confirm',
  'export',
  'param',
  'toggle',
  'bucket',
  'template',
  'preset',
] as const;
/** The words an edge or message line's last ` | ` field may be (spec §4.17, D80). */
export const EDGE_TONES: readonly EdgeTone[] = ['good', 'bad', 'warn', 'info', 'neutral'];
export const META_KEYS = ['title', 'subtitle', 'description', 'author', 'date', 'accent', 'theme', 'lang', 'width', 'fonts'];
const CHART_KINDS: ChartKind[] = ['line', 'area', 'bar', 'hbar', 'range'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEYWORD_RE = new RegExp(`^(${KEYWORDS.join('|')})(?=\\s|$)`);
/** A question or diagram name. */
const NAME_RE = /^[A-Za-z][\w-]*$/;
/**
 * A C0 control character other than tab (U+0009), as a `choose` option may not hold one (spec §4.18): a browser rewrites NUL and CR in a form
 * control's value, so the exported option would differ from the written one. DEL and the C1 controls are not C0 and stay allowed.
 */
// oxlint-disable-next-line no-control-regex -- the control characters are what this pattern is for
const OPTION_CONTROL_RE = /[\u0000-\u0008\u000A-\u001F]/;
/** The same pattern as source text, to build the line shapes below from. */
const NAME = NAME_RE.source.slice(1, -1);
/**
 * An editor word's line: the word, a name, then anything up to a `|` on the same line, or else one of the `alt` openings (a regex source:
 * the options that make a line a keyword line before any `|` is written, so that the missing `|` fails loudly).
 */
const editorShape = (word: string, alt = ''): RegExp => new RegExp(`^${word}\\s+${NAME}(?:(?=[\\s|])[^|]*\\|${alt ? `|${alt}` : ''})`);
/**
 * Keyword lines that are keyword lines only in their shape (spec §4.18, §4.19), because prose may start with the word: `cards` takes
 * nothing after it and `export` at most one word, and an editor word needs its name and then, somewhere on the line, a `|` (for `param`
 * also `unit=`, for `toggle` also `on`, `off` or `needs=`, which fail loudly without one). `cards on the table`, `export the data` and
 * `toggle the flag on Monday` are prose. Any other keyword is a keyword line whatever follows.
 */
const SHAPES: Partial<Record<string, RegExp>> = {
  cards: /^cards$/,
  export: /^export(?:\s+\S+)?$/,
  param: editorShape('param', '\\s+unit='),
  toggle: editorShape('toggle', '\\s+(?:on|off)(?=[\\s|]|$)|\\s+needs='),
  bucket: editorShape('bucket'),
  template: editorShape('template'),
  preset: editorShape('preset'),
};
/** Marks a `bucket` name the export would write for something else (`choose` reserves `(not chosen)` the same way). */
const BUCKET_RESERVED = [NOT_CHOSEN, EMPTY];
type Space = 'data' | 'diagram' | 'bucket';
const SPACES: readonly Space[] = ['data', 'diagram', 'bucket'];
/** How a message names the kind of name that is taken. */
const NOUN: Record<Space, string> = { data: 'data', diagram: 'diagram', bucket: 'bucket set' };
const RENAME_DIAGRAM = (name: string) => `rename the diagram (e.g. \`diagram ${name}-flow\`)`;
/**
 * A name declared as one kind when another already has it, keyed `declared>had`: what the message says to rename, and the key of the
 * diagnostic's `detail` (the name itself under that key), if it has one. `lede check --fix` reads the `diagram` key.
 */
const CLASH: Record<string, [fix: (name: string) => string, key: 'diagram' | 'bucket' | null]> = {
  'data>diagram': [RENAME_DIAGRAM, null],
  'data>bucket': [(name) => `rename the data (e.g. \`data ${name}-rows\`)`, 'bucket'],
  'diagram>data': [RENAME_DIAGRAM, 'diagram'],
  'diagram>bucket': [RENAME_DIAGRAM, 'bucket'],
  'bucket>data': [() => 'rename the bucket set', 'bucket'],
  'bucket>diagram': [() => 'rename the bucket set', 'bucket'],
};
/** Tolerance when a number is tested against a step grid or the 1,000-step cap. */
const EPS = 1e-9;

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
  /** Set when the fence is a `template`'s body; closing it emits the template, not a code block. */
  template?: PendingTemplate;
}

/** A `template NAME | LABEL` line waiting for its fence: it takes its name when the fence closes. */
interface PendingTemplate {
  name: string;
  text: string;
  line: number;
  col: number;
}

/** The block an accumulator (paragraph, list, quote, kpi row, step run) becomes when it is flushed. */
function accBlock(a: Acc): Block {
  if (a.kind === 'paragraph') return { type: 'paragraph', text: a.lines.join(' '), line: a.line };
  if (a.kind === 'list') return { type: 'list', ordered: a.ordered, start: a.start, items: a.items, line: a.line };
  if (a.kind === 'kpis') return { type: 'kpis', items: a.items, line: a.line } satisfies KpiBlock;
  if (a.kind === 'steps') return { type: 'steps', items: a.items, line: a.line };
  let cite: string | null = null;
  const lines = [...a.lines];
  const last = lines[lines.length - 1];
  if (lines.length > 1 && /^(—|--|–)\s*/.test(last)) {
    cite = last.replace(/^(—|--|–)\s*/, '');
    lines.pop();
  }
  return { type: 'quote', text: lines.join(' '), cite, line: a.line };
}

/**
 * An accumulator the block `peek` builds from it can own. A list, kpi row or step run hands its items to the block it becomes, and
 * the parser keeps adding to them, so those are copied (each item is a flat object of strings and flags); a paragraph and a quote
 * become new strings.
 */
function copyAcc(a: Acc): Acc {
  return 'items' in a ? ({ ...a, items: a.items.map((i) => ({ ...i })) } as Acc) : a;
}

/** The lines a fence holds, with the common indentation stripped so an indented fence reads like an unindented one. */
function fenceBody(f: Fence): string {
  // A loop, not `Math.min(...)`: a fence may hold more lines than a call takes arguments.
  let ind = Infinity;
  for (const l of f.lines) if (l.trim()) ind = Math.min(ind, l.length - l.trimStart().length);
  return f.lines.map((l) => (Number.isFinite(ind) ? l.slice(ind) : l)).join('\n');
}

/** The `code` (or raw `html`) block a fence becomes with the lines it holds. */
function fenceBlock(f: Fence): Block {
  const body = fenceBody(f);
  return f.raw ? { type: 'html', html: body, line: f.line } : { type: 'code', lang: f.lang, text: body, line: f.line };
}

/**
 * Line-at-a-time parser. `pushLine` returns the top-level blocks that became
 * final with that line; a block never changes after it is returned, except a
 * diagram or a bucket set (later `name:` lines add to it) and a table/chart whose data gets
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
  /** The level of the last heading as written (before the `heading-depth` clamp), for W `heading-skip`; null before the first. */
  private lastHeading: number | null = null;
  /** The `export` formats seen, to the line that first used each. */
  private exports = new Map<string, number>();
  /**
   * The fields (spec §4.18, §4.19) by name, in source order: the block, and where the text after its word started, for the checks
   * `end()` makes. A Map, so `constructor` is an ordinary name. A preset has a name but no value in the export, so it is kept apart.
   */
  private fields = new Map<string, { block: QuestionBlock; col: number }>();
  private presetNames = new Map<string, number>();
  private tpl: PendingTemplate | null = null;
  /** Where the last valid `@accent` was written; its contrast is checked in `end()`, once `@theme` is known. */
  private accentAt: { line: number; col: number } | null = null;
  private out: Block[] = [];
  private anon = 0;

  private readonly opts: ParseOptions;
  private readonly hooks: ParseHooks | undefined;

  constructor(opts: ParseOptions = {}, hooks?: ParseHooks) {
    this.opts = opts;
    this.hooks = hooks;
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
    this.checkEditors();
    this.checkAccent();
    this.checkExport();
    resolve(this.doc);
    return this.doc;
  }

  /**
   * The blocks `end()` would still add, without ending the parser or changing anything: the open paragraph, list, quote, kpi
   * row, step run or fence, the `cards` run and the `grid` as they stand. The result is what a snapshot of the lines so
   * far shows beyond the blocks already returned by `pushLine`. Costs the size of the open block. A keyword line is never
   * part of it (it is a block or a diagnostic on its own line), but the fence a `template` line opened is: it is the template
   * block, with the text so far as its body. A `template` line with no fence yet adds nothing.
   */
  peek(): Block[] {
    const f = this.fence;
    // An open `template` fence is the template block the lines so far make (not registered: only its closing fence does that).
    let open: Block | null = f
      ? f.template
        ? this.templateBlock(f, f.template, this.scanTemplate(f).slots)
        : fenceBlock(f)
      : this.acc
        ? accBlock(copyAcc(this.acc))
        : null;
    const out: Block[] = [];
    const c = this.cards;
    // `emit` hands the open block to the open card, else the open grid, else the page.
    if (open && !c?.card && !this.grid) {
      out.push(open);
      open = null;
    }
    if (c && c.block.items.length > 0) {
      const items = [...c.block.items];
      if (c.card && open) {
        items[items.length - 1] = { ...c.card, blocks: [...c.card.blocks, open] };
        open = null;
      }
      out.push({ ...c.block, items }, ...c.deferred);
    }
    if (this.grid) {
      out.push({ ...this.grid, children: open ? [...this.grid.children, open] : [...this.grid.children] });
    }
    return out;
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
    const theme = accentTheme(this.doc.meta.theme);
    const c = accentContrast(accent, theme);
    if (!c || c.ratio >= AA_TEXT) return;
    const surface = { bg: 'page background', surface: 'card surface', 'accent-tint': 'note tint' }[c.against] ?? c.against;
    const marks = c.ratio < AA_NON_TEXT ? `; borders and bars need ${AA_NON_TEXT}:1 and miss that too` : '';
    this.diag(
      'warning',
      'accent-contrast',
      `@accent ${accent} has ${c.ratio}:1 contrast on the ${theme} theme's ${surface}; link and label text needs ${AA_TEXT}:1${marks}; the house accent is used. Pick a ${theme === 'dark' ? 'lighter' : 'darker'} accent`,
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
    const fm = /^(`{3,})\s*(=?)([\w+-]*)\s*$/.exec(s);
    // A `template` line takes the next non-blank line as its fence; any other line, or a raw html fence, leaves it without one.
    const template = this.tpl ?? undefined;
    if (template) {
      this.tpl = null;
      if (!fm || fm[2] === '=') this.templateFence(template);
    }
    if (s.startsWith('\\')) {
      this.textLine(s.slice(1));
      return;
    }
    if (fm) {
      this.flush();
      this.fence = { ticks: fm[1].length, raw: fm[2] === '=', lang: fm[3], lines: [], line: L };
      if (template && fm[2] !== '=') this.fence.template = template;
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
      // Compared at the level as written, before the clamp below; the first heading of a document has nothing above it.
      if (this.lastHeading !== null && level > this.lastHeading + 1) {
        this.diag(
          'warning',
          'heading-skip',
          `heading jumps from ${'#'.repeat(this.lastHeading)} to ${h[1]}; use ${'#'.repeat(this.lastHeading + 1)}, one level deeper than the heading above`,
          L,
          lead + 1,
          { from: this.lastHeading, to: level },
        );
      }
      this.lastHeading = level;
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
    // Some keywords start a keyword line only in their shape; the rest of the time the line is prose (see SHAPES).
    if (kw && (SHAPES[kw[1]]?.test(s) ?? true)) {
      const rest = s.slice(kw[1].length).trim();
      const restCol = lead + 1 + s.indexOf(rest, kw[1].length);
      this.keyword(kw[1], rest, restCol, lead);
      return;
    }
    const dl = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(s);
    // A `NAME:` line binds to a bucket set before it can bind to a diagram (a set and a diagram never share a name).
    const owner = dl ? (this.bucketSet(dl[1]) ?? this.diagrams.get(dl[1])) : undefined;
    if (dl && owner) {
      this.flush();
      const col = lead + 1 + s.indexOf(':') + 1 + (s.slice(s.indexOf(':') + 1).length - s.slice(s.indexOf(':') + 1).trimStart().length);
      if (owner.type === 'bucket') {
        const changed = this.bucketItem(owner, dl[2].trim(), col);
        this.hooks?.onBucketItem?.(owner, changed);
      } else {
        const changed = this.diagramLine(owner, dl[2].trim(), col);
        this.hooks?.onDiagramLine(owner, changed);
      }
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
    this.emit(accBlock(a));
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
    if (f.template) this.closeTemplate(f, f.template);
    else this.emit(fenceBlock(f));
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
      case 'ask':
      case 'choose':
      case 'confirm':
        return this.questionLine(kw, rest, col);
      case 'export':
        return this.exportLine(rest, col);
      case 'param':
        return this.paramLine(rest, col);
      case 'toggle':
        return this.toggleLine(rest, col);
      case 'bucket':
        return this.bucketLine(rest, col);
      case 'template':
        return this.templateLine(rest, col);
      case 'preset':
        return this.presetLine(rest, col);
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

  /**
   * `ask NAME [lines=N] | text`, `choose NAME | options [| text]`, `confirm NAME | text` (spec §4.18). A line with an
   * error makes no block and takes no name, so what reaches the page is only what parsed.
   */
  private questionLine(word: 'ask' | 'choose' | 'confirm', rest: string, col: number): void {
    const L = this.lineNo;
    const usage = `${word} NAME | text`;
    const bar = this.bar(word, usage, rest, col);
    if (bar < 0) return;
    const o = parseOpts(rest.slice(0, bar));
    const right = rest.slice(bar + 1);
    const name = o.words[0] ?? '';
    let bad = this.badName(word, name, usage, col);
    const fail = (code: string, message: string, detail?: Record<string, unknown>) => {
      bad = true;
      this.diag('error', code, message, L, col, detail);
    };
    this.ignoreOptions(word, name, { ...o, words: o.words.slice(1) }, word === 'ask' ? ['lines'] : [], col);
    let lines = 1;
    if (word === 'ask' && o.kv.lines !== undefined) {
      const n = /^\d+$/.test(o.kv.lines) ? Number(o.kv.lines) : NaN;
      if (n >= 1 && n <= 12) lines = n;
      else fail('ask-lines', `lines= must be a whole number from 1 to 12 (got "${o.kv.lines}")`, { value: o.kv.lines });
    }
    let block: QuestionBlock;
    if (word === 'choose') {
      const list = this.nameList(right, 'choose options', col);
      bad ||= list.unclosed;
      for (const t of list.dups) {
        this.diag('warning', 'choose-dup-option', `choose ${name} lists "${t}" twice; the first is kept`, L, col, { option: t });
      }
      const options = list.items;
      const dirty = options.find((opt) => OPTION_CONTROL_RE.test(opt));
      if (dirty !== undefined) {
        const char = `U+${dirty.charCodeAt(dirty.search(OPTION_CONTROL_RE)).toString(16).toUpperCase().padStart(4, '0')}`;
        fail(
          'choose-options',
          `choose ${name}: option ${JSON.stringify(dirty)} holds the control character ${char}; remove it (a tab is the only control character an option may hold)`,
          { kind: 'control', option: dirty, char },
        );
      }
      const reserved = options.includes(NOT_CHOSEN);
      if (list.empty || reserved || options.length < 2) {
        const why = list.empty
          ? 'an option is empty (check for a doubled or trailing comma)'
          : reserved
            ? `${NOT_CHOSEN} is reserved`
            : 'choose needs at least two different options';
        fail('choose-options', `choose ${name}: ${why}; write \`choose ${name} | one, two\``, {
          count: options.length,
          empty: list.empty,
          reserved,
        });
      }
      block = { type: 'choose', name, text: list.text, options, line: L };
    } else {
      const text = right.trim();
      if (!text) fail('question-syntax', `${word} ${name} needs text after the |`, { word });
      block = word === 'ask' ? { type: 'ask', name, text, lines, line: L } : { type: 'confirm', name, text, line: L };
    }
    if (bad) return;
    this.register(block, col);
  }

  /** `export [json|markdown|prompt]`: one per format. A bare `export` is markdown. */
  private exportLine(rest: string, col: number): void {
    const L = this.lineNo;
    const format = rest === '' ? 'markdown' : rest;
    if (format !== 'json' && format !== 'markdown' && format !== 'prompt') {
      this.diag(
        'error',
        'export-format',
        `export takes json, markdown or prompt (got "${rest}"); start the line with \\ if it is prose`,
        L,
        col,
        {
          format: rest,
        },
      );
      return;
    }
    const first = this.exports.get(format);
    if (first !== undefined) {
      this.diag('warning', 'export-dup', `export ${format} is already on line ${first}; this one is ignored`, L, col, { format, first });
      return;
    }
    this.exports.set(format, L);
    const b: ExportBlock = { type: 'export', format, line: L };
    this.emit(b);
  }

  /** Whole-page checks for the question words; they run in `end()`, so a snapshot of a prefix may warn about an `export` still to come. */
  private checkExport(): void {
    const fields = this.fields.size;
    if (fields > 0 && this.exports.size === 0) {
      this.diag(
        'warning',
        'export-missing',
        'this page asks questions but has no export line, so the answers cannot be copied; add `export json` or `export markdown`',
        Math.min(...[...this.fields.values()].map((d) => d.block.line)),
        1,
        { fields },
      );
    } else if (fields === 0 && this.exports.size > 0) {
      this.diag(
        'warning',
        'export-orphan',
        'export has no ask, choose, confirm, param, toggle, bucket or template line to export',
        Math.min(...this.exports.values()),
        1,
      );
    }
  }

  // ------------------------------------------------------------ editor words (spec §4.19)

  /** The line that first used a name: a field, or a preset (which has a name but no value in the export). */
  private taken(name: string): number | undefined {
    return this.fields.get(name)?.block.line ?? this.presetNames.get(name);
  }

  /** Names of the fields a `{slot}` or a `preset` key may name, in source order. */
  private fillable(): string[] {
    return [...this.fields.values()].filter((d) => FIELD_KINDS[d.block.type].fillable).map((d) => d.block.name);
  }

  /** The fields of one kind, in source order. */
  private fieldsOfKind<T extends QuestionBlock['type']>(type: T): { block: Extract<QuestionBlock, { type: T }>; col: number }[] {
    return [...this.fields.values()].filter((d): d is { block: Extract<QuestionBlock, { type: T }>; col: number } => d.block.type === type);
  }

  private bucketSet(name: string): BucketBlock | undefined {
    const block = this.fields.get(name)?.block;
    return block?.type === 'bucket' ? block : undefined;
  }

  /** The index of the `|` that ends the head of a question or editor line, or -1 after reporting that the line has none. */
  private bar(word: string, usage: string, rest: string, col: number): number {
    const bar = barOutsideQuotes(rest);
    if (bar < 0)
      this.diag('error', 'question-syntax', `${word} needs \`${usage}\` (start the line with \\ if it is prose)`, this.lineNo, col, {
        word,
      });
    return bar;
  }

  /** Reports why `name` cannot name a field (it is missing, not a name, or taken) and returns true, or returns false when it can. */
  private badName(word: string, name: string, usage: string, col: number): boolean {
    const L = this.lineNo;
    if (!name) {
      this.diag('error', 'question-syntax', `${word} needs a name before the |: \`${usage}\``, L, col, { word });
      return true;
    }
    if (!NAME_RE.test(name)) {
      this.diag('error', 'question-name', `${name} is not a name: use a letter, then letters, digits, _ or -`, L, col, { word, name });
      return true;
    }
    const first = this.taken(name);
    if (first === undefined) return false;
    this.diag('error', 'question-dup', `${name} is already used on line ${first}; every question needs its own name`, L, col, {
      name,
      first,
    });
    return true;
  }

  /**
   * The part every editor word shares: the text before the first `|` is `NAME` and options, and the name must be free. Returns the
   * name, the option text and the text after the `|`, or null after reporting why the line is no block.
   */
  private editorHead(word: string, rest: string, col: number, usage: string): { name: string; opts: string; right: string } | null {
    const bar = this.bar(word, usage, rest, col);
    if (bar < 0) return null;
    const left = rest.slice(0, bar).trim();
    const cut = left.search(/\s/);
    const name = cut < 0 ? left : left.slice(0, cut);
    if (this.badName(word, name, usage, col)) return null;
    return { name, opts: cut < 0 ? '' : left.slice(cut).trim(), right: rest.slice(bar + 1) };
  }

  /**
   * W `<kind>-option` for each word the options of a chart or diagram line do not take, saying what was probably meant when the
   * word spilled out of an unquoted value, and for a `"` that is never closed.
   */
  private strayOptions(kind: 'chart' | 'diagram', o: Opts, stray: string[], col: number): void {
    for (const w of spilled(o, stray))
      this.diag('warning', `${kind}-option`, `ignored ${kind} option "${w.text}"${w.hint}`, this.lineNo, col);
    this.openQuotes(kind, o, col);
  }

  /** W `<kind>-option` for a `"` in an option list that is never closed: the options after it were read as its text. */
  private openQuotes(kind: 'chart' | 'table' | 'diagram', o: Opts, col: number): void {
    if (o.unclosed !== null)
      this.diag(
        'warning',
        `${kind}-option`,
        `a " is never closed, so the rest of the line, ${JSON.stringify(o.unclosed)}, is read as one value; close it before the next option`,
        this.lineNo,
        col,
      );
  }

  /**
   * W `csv-quote` when text follows the closing quote of a cell (`"Smith, J" (PM)`, `"Planned" bar=done`). The text stays in the
   * cell, which is right for the first and not for the second, so the writer is told either way.
   */
  private afterQuote(csv: { afterQuoteAt: number | null }, col: number): void {
    if (csv.afterQuoteAt === null) return;
    const message =
      'text after a closing " stays in the cell; move it inside the quotes, or take it off the line if it was meant as an option';
    this.diag('warning', 'csv-quote', message, this.lineNo, col);
  }

  /** W `question-option` for every option before the `|` that the word does not take. */
  private ignoreOptions(word: string, name: string, o: ReturnType<typeof parseOpts>, keep: string[], col: number): void {
    const L = this.lineNo;
    for (const w of [...o.words, ...o.flags, ...o.quoted.map((q) => `"${q}"`)])
      this.diag('warning', 'question-option', `ignored ${w} before the | of ${word} ${name}`, L, col, { option: w });
    for (const k of Object.keys(o.kv)) {
      if (!keep.includes(k)) this.diag('warning', 'question-option', `ignored ${k}= on ${word} ${name}`, L, col, { option: `${k}=` });
    }
  }

  /**
   * `A, B, C [| TEXT]` as `choose` and `bucket` read it: the names up to the first `|` outside quotes, trimmed, and what follows it.
   * `items` keeps the first of each name; `dups` has one entry per later repeat, and `empty` says a name was blank. An unclosed
   * quote is reported here, as `what` (the words of its message).
   */
  private nameList(right: string, what: string, col: number) {
    const cut = pipeOutsideQuotes(right);
    const csv = parseInlineCsv(cut < 0 ? right : right.slice(0, cut));
    const unclosed = csv.unclosedAt !== null;
    if (unclosed) this.diag('error', 'csv-quote', `unclosed " in ${what}`, this.lineNo, col);
    this.afterQuote(csv, col);
    const items: string[] = [];
    const dups: string[] = [];
    let empty = false;
    for (const t of csv.rows.flat().map((x) => x.trim())) {
      if (t === '') empty = true;
      else if (items.includes(t)) dups.push(t);
      else items.push(t);
    }
    const text = cut < 0 ? '' : right.slice(cut + 1).trim();
    return { items, dups, empty, unclosed, text: text || null };
  }

  /** Records a field once its block parsed: its name is taken, and `end()` and the `preset` and `template` checks can find it. */
  private register(block: QuestionBlock, col: number): void {
    this.fields.set(block.name, { block, col });
    this.emit(block);
  }

  /** `param NAME [unit=U] | LABEL | DEFAULT MIN MAX STEP` (spec §4.19). */
  private paramLine(rest: string, col: number): void {
    const L = this.lineNo;
    const usage = 'param NAME [unit=U] | LABEL | DEFAULT MIN MAX STEP';
    const h = this.editorHead('param', rest, col, usage);
    if (!h) return;
    const { name } = h;
    const o = parseOpts(h.opts);
    this.ignoreOptions('param', name, o, ['unit'], col);
    const bar = h.right.lastIndexOf('|');
    const text = bar < 0 ? '' : h.right.slice(0, bar).trim();
    if (bar < 0 || !text) {
      this.diag('error', 'question-syntax', `${name}: write \`${usage}\` (the label and the four numbers are each after a |)`, L, col, {
        word: 'param',
      });
      return;
    }
    const words = h.right
      .slice(bar + 1)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const nums = words.map((w) => paramNumber(w));
    if (nums.length !== 4 || nums.some((n) => n === null)) {
      const comma = words.some((w) => w.includes(',') && paramNumber(w) === null);
      this.diag(
        'error',
        'question-syntax',
        `param ${name} needs four numbers after the last |: DEFAULT MIN MAX STEP (got "${words.join(' ')}")${
          comma ? '; a comma only separates thousands (1,500), so write a decimal point, not 1,5' : ''
        }`,
        L,
        col,
        { word: 'param' },
      );
      return;
    }
    const [value, min, max, step] = nums as [number, number, number, number];
    // The first rule that fails, in this order, is the one reported.
    const rules: [rule: string, failed: boolean, why: string][] = [
      ['order', !(min < max), `MIN ${min} must be below MAX ${max}`],
      ['step', !(step > 0), `STEP ${step} must be above 0`],
      ['range', value < min || value > max, `DEFAULT ${value} must lie from MIN ${min} to MAX ${max}`],
      ['grid', !onGrid(value - min, step), `DEFAULT ${value} must be MIN ${min} plus a whole number of steps of ${step}`],
      [
        'grid-max',
        !onGrid(max - min, step),
        `MAX ${max} must be MIN ${min} plus a whole number of steps of ${step} (the last one ends at ${lastStep(min, step, max)}); change MAX or STEP`,
      ],
      ['count', (max - min) / step > 1000 + EPS, `MIN ${min} to MAX ${max} is more than 1000 steps of ${step}; raise STEP`],
    ];
    const broken = rules.find(([, failed]) => failed);
    if (broken) {
      const [rule, , why] = broken;
      this.diag('error', 'param-range', `param ${name}: ${why}`, L, col, { value, min, max, step, rule });
      return;
    }
    const unit = o.kv.unit ?? '';
    this.register({ type: 'param', name, text, value, min, max, step, ...(unit ? { unit } : {}), line: L } satisfies ParamBlock, col);
  }

  /** `toggle NAME [on|off] [needs=A,B] | LABEL` (spec §4.19). `needs` is checked in `end()`, so it may name a later toggle. */
  private toggleLine(rest: string, col: number): void {
    const L = this.lineNo;
    const usage = 'toggle NAME [on|off] [needs=A,B] | LABEL';
    const h = this.editorHead('toggle', rest, col, usage);
    if (!h) return;
    const { name } = h;
    const o = parseOpts(h.opts, ['on', 'off']);
    // The first state word wins; a second is an option that does nothing.
    this.ignoreOptions('toggle', name, { ...o, flags: o.flags.slice(1) }, ['needs'], col);
    const text = h.right.trim();
    if (!text) {
      this.diag('error', 'question-syntax', `toggle ${name} needs text after the |: \`${usage}\``, L, col, { word: 'toggle' });
      return;
    }
    const needs = [
      ...new Set(
        (o.kv.needs ?? '')
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean),
      ),
    ];
    const block: ToggleBlock = { type: 'toggle', name, text, on: o.flags[0] === 'on', ...(needs.length ? { needs } : {}), line: L };
    this.register(block, col);
  }

  /** `bucket NAME | B1, B2 … [| QUESTION]` declares a bucket set; `NAME: ITEM | B` lines then fill it (spec §4.19). */
  private bucketLine(rest: string, col: number): void {
    const L = this.lineNo;
    const h = this.editorHead('bucket', rest, col, 'bucket NAME | B1, B2 … [| QUESTION]');
    if (!h) return;
    const { name } = h;
    // A `html: …` line is a raw block before any `NAME:` line is tried, so a set called html could never take an item (diagramDecl too).
    if (name === 'html') {
      this.diag(
        'error',
        'question-name',
        'html cannot name a bucket set: a line starting `html:` is a raw HTML block, so it could never be an item; pick another name',
        L,
        col,
        { word: 'bucket', name },
      );
      return;
    }
    this.ignoreOptions('bucket', name, parseOpts(h.opts), [], col);
    const list = this.nameList(h.right, 'bucket names', col);
    const buckets = list.items;
    let bad = list.unclosed;
    const dup = list.dups.length > 0;
    const reserved = buckets.some((b) => BUCKET_RESERVED.includes(b));
    if (list.empty || dup || reserved || buckets.length < 2 || buckets.length > 8) {
      bad = true;
      const why = list.empty
        ? 'a bucket name is empty (check for a doubled or trailing comma)'
        : dup
          ? 'a bucket name is repeated'
          : reserved
            ? `${BUCKET_RESERVED.join(' and ')} are reserved`
            : 'a bucket set needs two to eight buckets';
      this.diag('error', 'bucket-names', `bucket ${name}: ${why}; write \`bucket ${name} | Now, Next, Later\``, L, col, {
        count: buckets.length,
        empty: list.empty,
        dup,
        reserved,
      });
    }
    // A bucket set that clashes is refused, and one error says so.
    if (this.clash('bucket', name, col, true).length > 0) bad = true;
    if (bad) return;
    this.register({ type: 'bucket', name, text: list.text, buckets, items: [], line: L } satisfies BucketBlock, col);
  }

  /**
   * `NAME: ITEM TEXT | B` where NAME is a bucket set. The item is added to the emitted block, as a diagram gains statements; true
   * when it was added, false when the line was rejected or repeated an item.
   */
  private bucketItem(set: BucketBlock, rest: string, col: number): boolean {
    const L = this.lineNo;
    const hint = `\`${set.name}: ITEM TEXT | ${set.buckets[0]}\`; the buckets are ${set.buckets.join(', ')}. Start the line with \\ if it is prose`;
    let text = '';
    let target = '';
    let found = false;
    // A quoted item text may hold a |; otherwise the item runs to the last |.
    if (rest.startsWith('"')) {
      const q = readQuoted(rest, 0);
      const after = q.closed ? rest.slice(q.end).trimStart() : '';
      if (after.startsWith('|') && !after.includes('|', 1)) {
        text = q.value.trim();
        target = after.slice(1).trim();
        found = true;
      }
    }
    if (!found) {
      const cut = rest.lastIndexOf('|');
      if (cut >= 0) {
        text = rest.slice(0, cut).trim();
        target = rest.slice(cut + 1).trim();
      }
    }
    if (!text || !target) {
      this.diag('error', 'bucket-item', `${set.name}: an item needs its text and its bucket after a |: ${hint}`, L, col, {
        name: set.name,
      });
      return false;
    }
    if (!set.buckets.includes(target)) {
      this.diag(
        'error',
        'bucket-unknown',
        `${set.name}: "${target}" is not one of its buckets (${set.buckets.join(', ')}); the name must match exactly`,
        L,
        col,
        {
          bucket: target,
          buckets: set.buckets,
        },
      );
      return false;
    }
    const first = set.items.find((i) => i.text === text);
    if (first) {
      this.diag('warning', 'bucket-dup-item', `${set.name} lists "${text}" twice; the first, on line ${first.line}, is kept`, L, col, {
        text,
        first: first.line,
      });
      return false;
    }
    set.items.push({ text, bucket: target, line: L });
    return true;
  }

  /** `template NAME | LABEL`: the next non-blank line must open a fence, which becomes the body (spec §4.19). */
  private templateLine(rest: string, col: number): void {
    const usage = 'template NAME | LABEL';
    const h = this.editorHead('template', rest, col, usage);
    if (!h) return;
    this.ignoreOptions('template', h.name, parseOpts(h.opts), [], col);
    const text = h.right.trim();
    if (!text) {
      this.diag(
        'error',
        'question-syntax',
        `template ${h.name} needs text after the |: \`${usage}\` and a fence on the next line`,
        this.lineNo,
        col,
        {
          word: 'template',
        },
      );
      return;
    }
    this.tpl = { name: h.name, text, line: this.lineNo, col };
  }

  /** The fence a `template` waited for did not come. */
  private templateFence(t: PendingTemplate): void {
    this.diag(
      'error',
      'template-fence',
      `template ${t.name} needs a code fence on the next line: \`\`\`text … \`\`\` holds its body`,
      t.line,
      t.col,
      {
        name: t.name,
      },
    );
  }

  /**
   * The slots of a template's fence as it stands: each `{name}` that is a fillable field declared above, once and in the order of
   * first use, and each other word between braces, once, with where it is. Reads the fields as they are now and changes nothing.
   */
  private scanTemplate(f: Fence): { slots: string[]; stray: { word: string; line: number; col: number }[]; fields: string[] } {
    const fields = this.fillable();
    const slots: string[] = [];
    const stray: { word: string; line: number; col: number }[] = [];
    f.lines.forEach((raw, k) => {
      for (const m of raw.matchAll(SLOT_RE)) {
        const word = m[1];
        if (fields.includes(word)) {
          if (!slots.includes(word)) slots.push(word);
        } else if (!stray.some((x) => x.word === word)) {
          stray.push({ word, line: f.line + 1 + k, col: m.index + 1 });
        }
      }
    });
    return { slots, stray, fields };
  }

  private templateBlock(f: Fence, t: PendingTemplate, slots: string[]): TemplateBlock {
    return {
      type: 'template',
      name: t.name,
      text: t.text,
      body: fenceBody(f),
      ...(f.lang ? { lang: f.lang } : {}),
      slots,
      line: t.line,
    };
  }

  /** The fence of a `template` closed: warn about braces that name nothing and about a body with no slot, and emit the block. */
  private closeTemplate(f: Fence, t: PendingTemplate): void {
    const { slots, stray, fields } = this.scanTemplate(f);
    for (const { word, line, col } of stray) {
      this.diag(
        'warning',
        'template-slot',
        `{${word}} names no ask, choose, param or toggle declared above, so it stays as written (fields: ${fields.join(', ') || 'none'})`,
        line,
        col,
        { slot: word, fields },
      );
    }
    if (slots.length === 0)
      this.diag('warning', 'template-empty', `template ${t.name} has no {slot}, so its text is shown as written`, t.line, t.col, {
        name: t.name,
      });
    this.register(this.templateBlock(f, t, slots), t.col);
  }

  /** `preset NAME | LABEL | key=value; key=value`: sets fields declared above it. A bad assignment makes no block. */
  private presetLine(rest: string, col: number): void {
    const L = this.lineNo;
    const usage = 'preset NAME | LABEL | key=value; key=value';
    const h = this.editorHead('preset', rest, col, usage);
    if (!h) return;
    const { name } = h;
    this.ignoreOptions('preset', name, parseOpts(h.opts), [], col);
    const bar = h.right.indexOf('|');
    const text = bar < 0 ? '' : h.right.slice(0, bar).trim();
    const pairs = bar < 0 ? [] : assignments(h.right.slice(bar + 1));
    if (!text || pairs.length === 0 || pairs.some((p) => p.value === null || p.key === '')) {
      this.diag(
        'error',
        'question-syntax',
        `preset ${name} needs a label and at least one key=value after the second |: \`${usage}\``,
        L,
        col,
        {
          word: 'preset',
        },
      );
      return;
    }
    const fields = this.fillable();
    const values: { name: string; value: string }[] = [];
    let bad = false;
    for (const { key, value: raw } of pairs) {
      const given = raw ?? '';
      if (values.some((v) => v.name === key)) {
        this.diag('warning', 'question-option', `preset ${name} sets ${key} twice; the first is kept`, L, col, { option: `${key}=` });
        continue;
      }
      const field = this.fields.get(key)?.block;
      if (!field || !FIELD_KINDS[field.type].fillable) {
        bad = true;
        this.diag(
          'error',
          'preset-key',
          `preset ${name}: ${key} is not an ask, choose, param or toggle declared above it (fields: ${fields.join(', ') || 'none'})`,
          L,
          col,
          { key, fields },
        );
        continue;
      }
      const value = presetValue(field, given);
      if (value === null) {
        bad = true;
        this.diag('error', 'preset-value', `preset ${name}: "${given}" is not a value for ${key}; ${presetHint(field, given)}`, L, col, {
          key,
          value: given,
          kind: field.type,
        });
        continue;
      }
      values.push({ name: key, value });
    }
    if (bad) return;
    this.presetNames.set(name, L);
    this.emit({ type: 'preset', name, text, values, line: L } satisfies PresetBlock);
  }

  /** Whole-document checks for the editor words; they run in `end()`, so a snapshot of a prefix may report what a later line settles. */
  private checkEditors(): void {
    const toggles = this.fieldsOfKind('toggle');
    const names = toggles.map((t) => t.block.name);
    for (const { block, col } of toggles) {
      for (const need of block.needs ?? []) {
        if (need !== block.name && names.includes(need)) continue;
        const why =
          need === block.name ? 'a toggle cannot need itself' : `${need} is not a toggle on this page (toggles: ${names.join(', ')})`;
        this.diag('error', 'toggle-needs', `toggle ${block.name} needs ${need}: ${why}`, block.line, col, {
          name: block.name,
          needs: need,
          toggles: names,
        });
      }
    }
    for (const { block: b, col } of this.fieldsOfKind('bucket')) {
      if (b.items.length === 0)
        this.diag(
          'warning',
          'bucket-empty',
          `bucket ${b.name} has no item; add lines like \`${b.name}: ITEM TEXT | ${b.buckets[0]}\``,
          b.line,
          col,
          {
            name: b.name,
          },
        );
    }
    if (this.tpl) {
      this.templateFence(this.tpl);
      this.tpl = null;
    }
  }

  // ------------------------------------------------------------ names shared by data, diagrams and bucket sets

  /** Whether a data set, a diagram or a bucket set already has the name. */
  private holds(space: Space, name: string): boolean {
    // Own property only: `constructor` or `toString` is on the prototype of any object, not a data set.
    return space === 'data' ? Object.hasOwn(this.doc.data, name) : space === 'diagram' ? this.diagrams.has(name) : !!this.bucketSet(name);
  }

  /**
   * Data sets, diagrams and bucket sets share one namespace, since a `NAME:` line must mean one of them. Reports `name` as an error for
   * each of the other two that already has it (`once`: only the first) and returns those it found. The caller decides whether the
   * declaration goes on.
   */
  private clash(declaring: Space, name: string, col: number, once = false): Space[] {
    const held = SPACES.filter((s) => s !== declaring && this.holds(s, name));
    for (const had of once ? held.slice(0, 1) : held) {
      const [fix, key] = CLASH[`${declaring}>${had}`];
      this.diag(
        'error',
        'name-clash',
        `${name} is already a ${NOUN[had]} name; ${fix(name)}`,
        this.lineNo,
        col,
        key ? { [key]: name } : undefined,
      );
    }
    return held;
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
      const { rows, unclosedLine } = parseCsvFile(text);
      if (unclosedLine !== null) this.diag('error', 'csv-quote', `unclosed " on line ${unclosedLine} of ${body.trim()}`, L, bodyCol);
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
    this.afterQuote(csv, bodyCol + (csv.afterQuoteAt ?? 0));
    if (op === '=') {
      this.defineData(name, csv.rows, csv.offsets, bodyCol);
      return;
    }
    const d = dataSet(this.doc, name);
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
    this.hooks?.onDataAppend(name);
  }

  private defineData(name: string, rows: string[][], offsets: number[], bodyCol: number): void {
    const L = this.lineNo;
    if (rows.length === 0 || rows[0].every((c) => c === '')) {
      this.diag('error', 'data-empty', `data ${name} has no header row`, L, bodyCol);
      return;
    }
    if (dataSet(this.doc, name))
      this.diag('warning', 'data-redefined', `data ${name} is redefined; the new definition replaces it`, L, bodyCol);
    this.clash('data', name, bodyCol);
    const columns = rows[0].map((c) => c.trim());
    const dup = columns.find((c, i) => columns.indexOf(c) !== i);
    if (dup) this.diag('error', 'data-dup-column', `data ${name} has two columns named ${dup}`, L, bodyCol);
    const d: DataSet = { name, columns, rows: [], line: L };
    this.addRows(d, rows.slice(1), offsets.slice(1), bodyCol);
    storeData(this.doc, name, d);
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
    const d = dataSet(this.doc, name);
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
    this.strayOptions('chart', o, [...o.words, ...o.quoted], col);
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
      ...this.axisRange(n('min'), n('max'), col),
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

  /** `min=` and `max=` of a chart. A pair that leaves no range (`min=10 max=10`, `min=10 max=2`) is reported and neither is kept. */
  private axisRange(min: number | null, max: number | null, col: number): { min: number | null; max: number | null } {
    if (min === null || max === null || min < max) return { min, max };
    this.diag(
      'warning',
      'chart-option',
      `min=${min} is not below max=${max}, so the axis has no range; both are ignored (give min a smaller number than max)`,
      this.lineNo,
      col,
    );
    return { min: null, max: null };
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
    this.strayOptions('chart', o, [...o.words, ...o.quoted], col);
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
      ...this.axisRange(n('min'), n('max'), col),
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
      this.afterQuote(csv, bodyCol + (csv.afterQuoteAt ?? 0));
      if (csv.rows.length === 0) {
        this.diag('error', 'data-empty', 'inline table has no header row', L, bodyCol);
        return;
      }
      d = { name, columns: csv.rows[0], rows: [], line: L };
      this.addRows(d, csv.rows.slice(1), csv.offsets.slice(1), bodyCol);
      storeData(this.doc, name, d);
    } else {
      const t = tokens(rest);
      d = this.requireData(t[0]?.key === undefined ? t[0]?.text : undefined, col);
      optStr = rest.slice(t[1]?.offset ?? rest.length);
    }
    if (!d) return;
    const o = parseOpts(optStr, ['heat'], ['cols', 'sort', 'heat', 'bar', 'target']);
    for (const { text: w, hint: spill } of spilled(o, [...o.words, ...o.quoted])) {
      // `table vendors = ...` names an inline table, which has no name: say how to get one.
      const named = !spill && eq && w === o.words[0] && /^[A-Za-z_][\w-]*$/.test(w) && !TABLE_OPTIONS.includes(w);
      const hint = named
        ? `; an inline table has no name: write \`table = ...\`, or \`data ${w} = ...\` then \`table ${w}\``
        : spill || ' (options: cols= sort= limit= title= heat bar= target=)';
      this.diag('warning', 'table-option', `ignored table option "${w}"${hint}`, L, col);
    }
    this.openQuotes('table', o, col);
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
      return d.rows.some((r) => cellNum(r[i]) !== null) && d.rows.every((r) => r[i] === '' || cellNum(r[i]) !== null);
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
      const d = m ? dataSet(this.doc, m[1]) : undefined;
      if (!m) this.diag('error', 'kpi-ref', `kpi reference must be =data.column, got =${ref}`, L, col);
      else if (!d) this.requireData(m[1], col);
      else this.requireCol(d, m[2], col);
    }
    if (bar) {
      // The bar needs a percent or a number from 0 to 100. A reference is checked against the rows so far.
      let v = value;
      if (ref) {
        const m = /^([A-Za-z_][\w-]*)\.(.+)$/.exec(ref);
        const d = m ? dataSet(this.doc, m[1]) : undefined;
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
    if (!NAME_RE.test(name)) {
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
    this.clash('diagram', name, col);
    const o = parseOpts(rest.slice(t[1]?.offset ?? rest.length), ['flow', 'sequence']);
    this.strayOptions('diagram', o, o.words, col);
    const kind = o.flags.includes('sequence') ? 'sequence' : 'flow';
    const dirRaw = (o.kv.dir ?? (kind === 'sequence' ? 'LR' : 'TB')).toUpperCase();
    const dir = (['LR', 'TB', 'RL', 'BT'].includes(dirRaw) ? dirRaw : 'TB') as DiagramBlock['dir'];
    if (dirRaw !== dir) this.diag('warning', 'diagram-option', `dir must be LR, TB, RL or BT`, L, col);
    const d: DiagramBlock = {
      type: 'diagram',
      name,
      kind,
      dir,
      ...(o.kv.dir !== undefined && dirRaw === dir ? { dirExplicit: true as const } : {}),
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

  /** alt/opt/else/end in a sequence diagram. Frames are flat: one open at a time, positions are edge indexes. True when a frame was opened, got a branch or was closed. */
  private frameLine(d: DiagramBlock, word: 'alt' | 'opt' | 'else' | 'end', rest: string, col: number): boolean {
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
        return false;
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
      return true;
    }
    if (st.skip) {
      if (word === 'end') st.skip--;
      return false;
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
      return false;
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
        return false;
      }
      f.branches[f.branches.length - 1].to = at;
      f.branches.push({ label: cond, from: at, to: null, line: L });
      return true;
    }
    if (rest) this.diag('warning', 'diagram-block-syntax', `end takes nothing after it; "${rest}" is ignored`, L, col);
    f.branches[f.branches.length - 1].to = at;
    f.to = at;
    f.endLine = L;
    st.open = null;
    return true;
  }

  /** Apply a `name:` line to the diagram. True when it changed the diagram: a rejected line, and one that repeats what is there, did not. */
  private diagramLine(d: DiagramBlock, s: string, col: number): boolean {
    const L = this.lineNo;
    const ID = /^[A-Za-z0-9_][\w.-]*$/;
    if (s === '') {
      this.diag('warning', 'diagram-empty-line', `empty ${d.name}: line`, L, col);
      return false;
    }

    // NAME: legend (v0.4): a key of node kinds and arrow styles. Flow diagrams only.
    if (s === 'legend') {
      if (d.kind === 'sequence')
        this.diag('warning', 'legend-kind', `legend applies to flow diagrams; ignored on sequence diagram ${d.name}`, L, col);
      else if (d.legend !== true) {
        d.legend = true;
        return true;
      }
      return false;
    }

    // alt "cond" / opt "cond" / else ["cond"] / end   (sequence only). A line that starts with one of
    // these words and then an arrow or a comma is still an edge from a participant of that name.
    if (d.kind === 'sequence') {
      const bm = /^(alt|opt|else|end)(?:\s+(.*))?$/.exec(s);
      if (bm && !/^(<->|-->|->|,)/.test(bm[2] ?? '')) {
        return this.frameLine(d, bm[1] as 'alt' | 'opt' | 'else' | 'end', (bm[2] ?? '').trim(), col);
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
        return false;
      }
      if (d.kind !== 'sequence') this.diag('warning', 'diagram-note', 'notes only render in sequence diagrams', L, col);
      over.forEach((x) => this.node(d, x));
      // `after` places the note between messages: it follows the first `after` edges.
      d.notes.push({ over, text: nm[2].trim(), after: d.edges.length, line: L });
      return true;
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
        return false;
      }
      const q = readQuoted(body, i);
      const members = body
        .slice(q.end)
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!members.length) {
        this.diag('error', 'diagram-syntax', `group "${q.value}" has no members`, L, col);
        return false;
      }
      const gid = id ?? `group${d.groups.length + 1}`;
      const declared = this.declared.get(d) ?? new Set<string>();
      if (d.groups.some((g) => g.id === gid) || (id && declared.has(gid))) {
        this.diag('error', 'diagram-syntax', `group id ${gid} is already used`, L, col);
        return false;
      }
      // An id first used in an edge (`prodvpc -> tgw`) and later declared as a group is that group:
      // its edges attach to the group's boundary.
      const removed = id && d.nodes.some((n) => n.id === gid);
      if (removed) d.nodes = d.nodes.filter((n) => n.id !== gid);
      const nodesBefore = d.nodes.length;
      for (const m of members) {
        if (!ID.test(m)) {
          this.diag('error', 'diagram-syntax', `bad member id "${m}"`, L, col);
          // The node the group replaced is gone and the members before it were added already.
          return removed || d.nodes.length !== nodesBefore;
        }
        if (!d.groups.some((g) => g.id === m)) this.node(d, m);
      }
      const owner = d.groups.find((g) => members.some((m) => g.members.includes(m) && !d.groups.some((x) => x.id === m)));
      if (owner)
        this.diag('warning', 'diagram-group', `a node is in both "${owner.label}" and "${q.value}"; it is drawn in the first`, L, col);
      d.groups.push({ id: gid, label: q.value, members });
      return true;
    }

    // edges: a -> b, c --> d : label [| tone]. An arrow inside a quoted label (`api "Payments -> API" service`) is text, not an edge.
    if (/(-->|->|<->|\s-x-\s)/.test(s.includes('"') ? s.replace(/"[^"]*"/g, '""') : s)) {
      const tn = splitTone(s);
      const ci = tn.head.indexOf(':');
      const chain = ci >= 0 ? tn.head.slice(0, ci) : tn.head;
      const label = ci >= 0 ? tn.head.slice(ci + 1).trim() : '';
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
            return false;
          }
        }
      }
      if (d.kind === 'sequence' && steps.some((x) => x.length > 1)) {
        this.diag('error', 'diagram-syntax', 'sequence messages go between exactly two participants', L, col);
        return false;
      }
      if (tn.word !== undefined) {
        const allowed = [...EDGE_TONES];
        this.diag(
          'warning',
          'edge-tone',
          `"${tn.word}" is not an edge tone (${allowed.join(', ')}); the edge is drawn without one and the field is dropped`,
          L,
          col + tn.at,
          { value: tn.word, allowed },
        );
      }
      for (let i = 0; i < ops.length; i++) {
        for (const a of steps[i])
          for (const b of steps[i + 1]) {
            if (!d.groups.some((g) => g.id === a)) this.node(d, a);
            if (!d.groups.some((g) => g.id === b)) this.node(d, b);
            // In a chain the label belongs to the last hop: `commit -> build -> deploy : on green`. The tone belongs to every hop.
            const e: DiagramEdge = {
              from: a,
              to: b,
              label: i === ops.length - 1 ? label : '',
              style: ops[i] === '-->' ? 'dashed' : ops[i] === '-x-' || ops[i] === '-x->' ? 'blocked' : 'solid',
              both: ops[i] === '<->',
              ...(tn.tone ? { tone: tn.tone } : {}),
              line: L,
            };
            d.edges.push(e);
          }
      }
      return true;
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
      return false;
    }
    if (d.groups.some((g) => g.id === id)) {
      this.diag('error', 'diagram-syntax', `${id} is a group id`, L, col);
      return false;
    }
    const existing = d.nodes.find((x) => x.id === id);
    const was = existing && JSON.stringify(existing);
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
    return JSON.stringify(n) !== was;
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

/**
 * An edge or message line without its tone. The tone is the line's last ` | ` field (`a -> b : allow | good`, `a -> b | warn`): a
 * pipe with a space on each side, outside any pair of double quotes. The field is `tone` when it is one of EDGE_TONES. A lone other
 * word is a mistyped tone: `word`, and it is dropped with its pipe (`at` is its offset in `s`). Any other text after the pipe (several
 * words, a number, punctuation) is label text and stays, as it did before tones.
 */
function splitTone(s: string): { head: string; tone?: EdgeTone; word?: string; at: number } {
  let at = -1;
  for (const m of s.replace(/"[^"]*"/g, (q) => '_'.repeat(q.length)).matchAll(/\s\|(?=\s)/g)) at = m.index;
  const field = at < 0 ? '' : s.slice(at + 2).trim();
  if (!/^[A-Za-z][\w-]*$/.test(field)) return { head: s, at: 0 };
  const head = s.slice(0, at).trimEnd();
  const tone = EDGE_TONES.find((t) => t === field);
  return tone ? { head, tone, at: 0 } : { head, word: field, at: s.lastIndexOf(field) };
}

/**
 * The stray words of an option list (`o.words`, then anything else the caller reports), for reporting. Words that spilled out of one unquoted value (`title=Deploys per week`) come
 * back as one entry, `per week`, with a hint naming the option as it was probably meant; every other word is its own entry.
 */
function spilled(o: Opts, stray: string[]): { text: string; hint: string }[] {
  const out: { text: string; hint: string }[] = [];
  for (let i = 0; i < stray.length; i++) {
    const s = o.spills.find((x) => x.at === i);
    out.push(s ? { text: s.words.join(' '), hint: `; a value with a space needs quotes: ${s.meant}` } : { text: stray[i], hint: '' });
    if (s) i += s.words.length - 1;
  }
  return out;
}

/** `d` is a whole number of `step`s, within a rounding error (0.94 - 0.85 is not exactly 9 steps of 0.01 in floating point). */
function onGrid(d: number, step: number): boolean {
  const q = d / step;
  return Math.abs(q - Math.round(q)) <= EPS;
}

/**
 * A number of a `param` line or a `preset` value (spec §4.19): as a chart reads a cell (§4.11), except that a `,` must separate
 * thousands (`1,500`). A chart drops every comma, which would read `1,5` as 15 and a decimal comma as a bigger number.
 */
function paramNumber(w: string): number | null {
  if (w.includes(',')) {
    const head = /^[-+−]?[$€£]?(?:\d{1,3}(?:,\d{3})+|\d+)(?![\d,])/.exec(w);
    if (!head || w.slice(head[0].length).includes(',')) return null;
  }
  return num(w);
}

/** The last point of the grid that does not pass `max`, without the noise of the multiplication (`0.1 + 3 * 0.1` is not `0.4`). */
function lastStep(min: number, step: number, max: number): number {
  return Number((min + Math.floor((max - min) / step + EPS) * step).toFixed(9));
}

/**
 * The assignments of a `preset`: `key=value` separated by `;`. The first `=` splits key from value and the value runs to the next
 * `;`, so an `ask` value may hold `=` and `|`. A value that starts with `"` and closes before a `;` is quoted, which lets it hold a
 * `;`. An assignment with no `=` has a null value.
 */
function assignments(body: string): { key: string; value: string | null }[] {
  const out: { key: string; value: string | null }[] = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s;]/.test(body[i])) i++;
    if (i >= body.length) break;
    const eq = body.indexOf('=', i);
    const semi = body.indexOf(';', i);
    if (eq < 0 || (semi >= 0 && semi < eq)) {
      const end = semi < 0 ? body.length : semi;
      out.push({ key: body.slice(i, end).trim(), value: null });
      i = end + 1;
      continue;
    }
    const key = body.slice(i, eq).trim();
    i = eq + 1;
    while (i < body.length && /[ \t]/.test(body[i])) i++;
    if (body[i] === '"') {
      const q = readQuoted(body, i);
      const tail = /^\s*(;|$)/.exec(body.slice(q.end));
      if (q.closed && tail) {
        out.push({ key, value: q.value });
        i = q.end + tail[0].length;
        continue;
      }
    }
    const end = body.indexOf(';', i) < 0 ? body.length : body.indexOf(';', i);
    out.push({ key, value: body.slice(i, end).trim() });
    i = end + 1;
  }
  return out;
}

/** The value a `preset` sets on a field as the export will hold it, or null when the field cannot take it. */
function presetValue(field: QuestionBlock, value: string): string | null {
  switch (field.type) {
    case 'ask':
      return value;
    case 'choose':
      return field.options.includes(value) ? value : null;
    case 'toggle':
      return value === 'on' || value === 'off' ? value : null;
    case 'param': {
      const n = paramNumber(value);
      return n !== null && n >= field.min - EPS && n <= field.max + EPS && onGrid(n - field.min, field.step) ? String(n) : null;
    }
    default:
      return null;
  }
}

function presetHint(field: QuestionBlock, given: string): string {
  if (field.type === 'choose') return `choose one of ${field.options.join(', ')}`;
  if (field.type === 'toggle') return 'a toggle takes on or off';
  if (field.type === 'param')
    return `a number from ${field.min} to ${field.max} in steps of ${field.step}${given.includes(',') ? ' (a comma only separates thousands, as in 1,500)' : ''}`;
  return 'it does not take a value';
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

/**
 * The data set called `name`, or undefined. Read `doc.data` through this, not by index: a set may be named `constructor` or
 * `toString`, and an index finds the inherited member of that name when no such set is declared.
 */
export function dataSet(doc: LedeDocument, name: string): DataSet | undefined {
  return Object.hasOwn(doc.data, name) ? doc.data[name] : undefined;
}

/** Store `d` under `name` as an own property, so that a set named `__proto__` is a key like any other and not the map's prototype. */
function storeData(doc: LedeDocument, name: string, d: DataSet): void {
  Object.defineProperty(doc.data, name, { value: d, enumerable: true, writable: true, configurable: true });
}

/**
 * The columns `b` reads that `d` does not have. A chart or table names its columns from the data as it stood on its own line, so
 * this is empty unless the data was redefined below it (`data d = x,y` ... `chart line d` ... `data d = a,b`). The match is
 * exact, as the drawers index columns: a redefinition that only changes a name's case (`Month` to `month`) counts as taking it away.
 */
export function missingColumns(b: ChartBlock | TableBlock, d: DataSet): string[] {
  const reads =
    b.type === 'chart'
      ? [b.x, ...(b.kind === 'range' ? [b.from, b.to, b.at] : b.y)]
      : [...(b.cols ?? []), b.sort?.col, ...(Array.isArray(b.heat) ? b.heat : []), ...(b.bars ?? []), b.targetCol];
  return [...new Set(reads)].filter((c): c is string => c !== undefined && !d.columns.includes(c));
}

/** Resolve a column reference: exact match first, then ignoring case and repeated spaces. */
export function findCol(d: DataSet, name: string): string | null {
  if (d.columns.includes(name)) return name;
  return d.columns.find((c) => colKey(c) === colKey(name)) ?? null;
}

/** Post-parse resolution: kpi references and diagram sanity checks. Idempotent. */
export function resolve(doc: LedeDocument): void {
  walkBlocks(doc.blocks, (b) => {
    // A block names its columns from the data as it stood on its own line; a later `data NAME =` may have taken one away.
    // (A column that was never there is an error on the block's own line already, and the data is then above the block.)
    const redefined = (d: DataSet, gone: string[]) => {
      if (gone.length === 0 || d.line <= b.line) return;
      doc.diagnostics.push({
        severity: 'error',
        code: 'data-redefined',
        message: `this ${b.type === 'kpis' ? 'kpi' : b.type} reads ${gone.join(', ')} of ${d.name}, but ${d.name} is redefined on line ${d.line} without ${gone.length === 1 ? 'it' : 'them'}; give the data on line ${d.line} a name of its own`,
        line: b.line,
        col: 1,
        detail: { name: d.name, columns: gone, redefined: d.line },
      });
    };
    if (b.type === 'kpis') {
      for (const k of b.items) {
        const lost = resolveKpi(doc, k);
        if (lost) redefined(lost.d, [lost.column]);
      }
    }
    if (b.type === 'chart' || b.type === 'table') {
      const d = dataSet(doc, b.data);
      if (d) redefined(d, missingColumns(b, d));
    }
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
      // Group cycles: a group may not contain itself, directly or through any depth of nesting. One diagnostic per cycle.
      const groups = new Map(b.groups.map((g) => [g.id, g]));
      const done = new Set<string>();
      const path: string[] = [];
      const walk = (id: string): void => {
        const at = path.indexOf(id);
        if (at >= 0) {
          const cyc = path.slice(at);
          doc.diagnostics.push({
            severity: 'error',
            code: 'diagram-group-cycle',
            message:
              cyc.length === 1
                ? `group ${id} contains itself`
                : `groups ${cyc.slice(0, -1).join(', ')} and ${cyc[cyc.length - 1]} contain each other`,
            line: b.line,
            col: 1,
          });
          return;
        }
        if (done.has(id)) return;
        path.push(id);
        for (const m of groups.get(id)!.members) if (groups.has(m)) walk(m);
        path.pop();
        done.add(id);
      };
      for (const g of b.groups) walk(g.id);
    }
  });
}

/** Fill a `=data.column` kpi from the data. Returns the data set and the column when the set no longer has that column. */
function resolveKpi(doc: LedeDocument, k: Kpi): { d: DataSet; column: string } | null {
  if (!k.ref) return null;
  const m = /^([A-Za-z_][\w-]*)\.(.+)$/.exec(k.ref);
  const d = m && dataSet(doc, m[1]);
  if (!m || !d) return null;
  const cname = findCol(d, m[2]);
  if (!cname) return { d, column: m[2] };
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
  return null;
}

function decimals(v: string): number {
  const m = /\.(\d+)/.exec(v);
  return m ? m[1].length : 0;
}

export function parse(src: string, opts: ParseOptions = {}): LedeDocument {
  const p = new LedeParser(opts);
  const lines = src.split('\n');
  // A final newline ends the last line; it does not start an empty one. `LedeStream` reads it so, and an unclosed fence at the end
  // of the text would otherwise gain an empty last line here and not there.
  if (src.endsWith('\n')) lines.pop();
  for (const line of lines) p.pushLine(line);
  return p.end();
}

/** The first `|` not inside a `"…"` option value (`unit="km|h"` keeps its pipe), or the first `|` at all when the quotes do not close. */
function barOutsideQuotes(s: string): number {
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') quoted = !quoted;
    else if (s[i] === '|' && !quoted) return i;
  }
  return s.indexOf('|');
}
