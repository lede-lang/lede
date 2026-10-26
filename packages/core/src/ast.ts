// Lede 0.1 AST. Every block records the 1-based source line it started on.

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  line: number;
  col: number;
  /** Machine-readable facts for `lede check --fix`; the message stays the human text. */
  detail?: Record<string, unknown>;
}

export interface DataSet {
  name: string;
  columns: string[];
  rows: string[][];
  line: number;
}

export type ChartKind = 'line' | 'area' | 'bar' | 'hbar' | 'range';

export interface HeadingBlock {
  type: 'heading';
  level: 1 | 2 | 3;
  text: string;
  line: number;
}
export interface ParagraphBlock {
  type: 'paragraph';
  text: string;
  line: number;
}
/**
 * `level` and `ordered` exist only on sub-items (`-- text`, `-- 1. text`), which sit flat in `items`
 * right after their parent. Absent means a top-level item. Sub-lists are one level deep and number from 1.
 */
export interface ListItem {
  text: string;
  checked: boolean | null;
  level?: 2;
  ordered?: boolean;
}
export interface ListBlock {
  type: 'list';
  ordered: boolean;
  start: number;
  items: ListItem[];
  line: number;
}
export interface QuoteBlock {
  type: 'quote';
  text: string;
  cite: string | null;
  line: number;
}
export interface NoteBlock {
  type: 'note';
  tone: 'note' | 'warn' | 'danger';
  text: string;
  line: number;
}
export interface RuleBlock {
  type: 'rule';
  line: number;
}
export interface CodeBlock {
  type: 'code';
  lang: string;
  text: string;
  line: number;
}
export interface HtmlBlock {
  type: 'html';
  html: string;
  line: number;
}
export interface DataBlock {
  type: 'data';
  name: string;
  line: number;
}
export interface ChartBlock {
  type: 'chart';
  kind: ChartKind;
  data: string;
  x: string;
  y: string[];
  title: string | null;
  stack: boolean;
  labels: boolean;
  unit: string | null;
  min: number | null;
  max: number | null;
  focus: string | null;
  target: { value: number; label: string } | null;
  /** Event markers (`mark="W3 deploy"`), in source order. Omitted when there are none. Never on hbar. */
  marks?: ChartMark[];
  /** `chart range` (v0.4): column names for the span start/end and an optional marker value; `bands` are threshold tick values as written. */
  from?: string;
  to?: string;
  at?: string;
  bands?: string[];
  /** `labels=end` / `labels=all` (v0.4); `labels` stays true for both. Omitted for bare `labels`. */
  labelMode?: 'end' | 'all';
  /** `hatch="x value"` (v0.4): x values drawn striped. */
  hatch?: string[];
  line: number;
}
/** `x` is a category exactly as it appears in the chart's x column; `label` may be empty. */
export interface ChartMark {
  x: string;
  label: string;
}
export interface TableBlock {
  type: 'table';
  data: string;
  cols: string[] | null;
  sort: { col: string; desc: boolean } | null;
  limit: number | null;
  title: string | null;
  /** `heat` / `heat=a,b`: tint numeric cells by rank. Omitted when unused. */
  heat?: string[] | true;
  /** `bar=a,b`: a proportional bar behind these columns' numbers. Omitted when unused. */
  bars?: string[];
  /** `target=col` (v0.4): column giving each row's tick on its `bar=` bar. */
  targetCol?: string;
  line: number;
}
export interface Kpi {
  label: string;
  value: string;
  delta: string;
  tone: 'good' | 'bad' | 'neutral' | null;
  note: string;
  ref: string | null;
  /** v0.4: a field exactly `bar` draws a progress bar. Omitted when unused. */ bar?: boolean;
}
export interface KpiBlock {
  type: 'kpis';
  items: Kpi[];
  line: number;
}
export interface ImageBlock {
  type: 'image';
  src: string;
  alt: string;
  caption: string | null;
  line: number;
}
/** v0.4 `cards`: consecutive `### Title` sections as cards. */
export interface CardItem {
  title: string;
  blocks: Block[];
  line: number;
}
export interface CardsBlock {
  type: 'cards';
  items: CardItem[];
  line: number;
}
/** v0.4 `step Title | deadline | note`: consecutive lines form numbered step cards. Missing fields are ''. */
export interface Step {
  title: string;
  due: string;
  note: string;
  line: number;
}
export interface StepsBlock {
  type: 'steps';
  items: Step[];
  line: number;
}
export interface GridBlock {
  type: 'grid';
  columns: number;
  count: number;
  children: Block[];
  line: number;
}

export interface DiagramNode {
  id: string;
  label: string;
  kind: string | null;
  sub: string | null;
  focus: boolean;
}
export type EdgeStyle = 'solid' | 'dashed' | 'blocked';
export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
  style: EdgeStyle;
  both: boolean;
  line: number;
}
export interface DiagramGroup {
  id: string;
  label: string;
  members: string[];
}
export interface DiagramNote {
  over: string[];
  text: string;
  after: number;
  line: number;
}
/**
 * An `alt` or `opt` region of a sequence diagram. `from`/`to` are half-open indexes into the diagram's
 * `edges`, taken when the line was read (as `DiagramNote.after` is). `to` and `endLine` are null while the
 * frame is open (streaming) or never closed (an error). Frames never overlap or nest.
 */
export interface DiagramBranch {
  label: string;
  from: number;
  to: number | null;
  line: number;
}
export interface DiagramFrame {
  kind: 'alt' | 'opt';
  /** `alt`: the condition, then one entry per `else`. `opt`: exactly one entry. */
  branches: DiagramBranch[];
  from: number;
  to: number | null;
  line: number;
  endLine: number | null;
}
export interface DiagramBlock {
  type: 'diagram';
  name: string;
  kind: 'flow' | 'sequence';
  dir: 'LR' | 'TB' | 'RL' | 'BT';
  title: string | null;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups: DiagramGroup[];
  notes: DiagramNote[];
  /** Sequence diagrams only; omitted when the diagram has no alt/opt. */
  frames?: DiagramFrame[];
  /** v0.4: `NAME: legend` draws a key of the node kinds and arrow styles used. Omitted when unused. */
  legend?: boolean;
  line: number;
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | QuoteBlock
  | NoteBlock
  | RuleBlock
  | CodeBlock
  | HtmlBlock
  | DataBlock
  | ChartBlock
  | TableBlock
  | KpiBlock
  | ImageBlock
  | GridBlock
  | DiagramBlock
  | CardsBlock
  | StepsBlock;

export interface LedeDocument {
  meta: Record<string, string>;
  blocks: Block[];
  data: Record<string, DataSet>;
  diagnostics: Diagnostic[];
}
