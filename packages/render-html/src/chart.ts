import type { ChartBlock, DataSet } from '@lede-lang/core';
import { num } from '@lede-lang/core';
import { esc, fmtNum, inline, plain, textWidth } from './util.ts';

const FONT = 12;
const TARGET_FONT = 12;

export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (hi === lo) {
    hi = lo + 1;
    lo = lo === 0 ? 0 : lo - 1;
  }
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? mag * 10;
  const start = Math.floor(lo / step + 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  if (ticks[ticks.length - 1] < hi - 1e-9) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10));
  return ticks;
}

/** Number format shared by every label in one chart, picked from the largest magnitude on the axis. */
export function scaleFormat(maxAbs: number): (v: number) => string {
  const f = scaleFormatRaw(maxAbs);
  return (v) => (v === 0 ? '0' : f(v));
}

function scaleFormatRaw(maxAbs: number): (v: number) => string {
  if (maxAbs >= 1e9) return (v) => `${+(v / 1e9).toFixed(2)}B`;
  if (maxAbs >= 1e6) return (v) => `${+(v / 1e6).toFixed(2)}M`;
  if (maxAbs >= 1e4) return (v) => `${+(v / 1e3).toFixed(1)}k`;
  return (v) => fmtNum(v);
}

let currentFormat: (v: number) => string = fmtNum;

export function withUnit(v: number, unit: string | null): string {
  const s = currentFormat(v);
  if (!unit) return s;
  if (unit === '$' || unit === '€' || unit === '£') return v < 0 ? `-${unit}${s.slice(1)}` : `${unit}${s}`;
  if (unit === '%') return `${s}%`;
  return `${s} ${unit}`;
}

/** `cls` is the drawn colour class (possibly muted by focus); `base` is the series' own colour class. */
interface Series {
  name: string;
  values: (number | null)[];
  cls: string;
  base: string;
}

/* stream v04-1: semantic series colours */
// Series named as status words take the status-pill tokens (green / amber / red / grey) instead of the categorical
// palette (F.6: good/neutral/bad take green/amber/red, so "neutral" is amber with "at risk" and "in progress");
// "not started" is grey, as its status pill is. Mixed names keep the palette.
const SEMANTIC: [RegExp, string][] = [
  [/^(good|favou?rable|done|on track|pass|passed|up)$/, 's-good'],
  [/^(neutral|at risk|in progress)$/, 's-warn'],
  [/^(bad|unfavou?rable|blocked|failed|fail|down)$/, 's-bad'],
  [/^(not started)$/, 's-none'],
];

export function semanticClass(name: string): string | null {
  const n = plain(name).trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  return SEMANTIC.find(([re]) => re.test(n))?.[1] ?? null;
}
/* end stream v04-1 */

function seriesOf(c: ChartBlock, d: DataSet): { xs: string[]; series: Series[] } {
  const xi = d.columns.indexOf(c.x);
  const xs = d.rows.map((r) => r[xi]);
  const sem = c.y.length > 0 && c.y.every((n) => semanticClass(n) !== null);
  const series = c.y.map((name, j) => {
    const base = sem ? semanticClass(name)! : `c${(j % 8) + 1}`;
    return {
      name,
      values: d.rows.map((r) => num(r[d.columns.indexOf(name)])),
      // focus=series mutes the other series; focus="x value" is handled per bar, so series keep their colors here.
      cls: c.focus && c.y.includes(c.focus) ? (name === c.focus ? (sem ? base : 'c1') : 'cm') : base,
      base,
    };
  });
  return { xs, series };
}

/** Renders a chart as a figure holding a wide and a narrow SVG (CSS shows one), a legend and a data table. */
export interface ChartOpts {
  /** Content width in px of the figure's SVG when the chart sits in a grid cell; absent outside grids. */
  cellWidth?: number;
}

export function renderChart(c: ChartBlock, d: DataSet, uid: string, opts: ChartOpts = {}): string {
  if (c.kind === 'range') return renderRange(c, d, uid, opts);
  const { xs, series } = seriesOf(c, d);
  if (xs.length === 0) return `<figure class="viz"><p class="empty">No data in ${esc(d.name)}.</p></figure>`;
  const title = c.title ? `<figcaption>${inline(c.title)}</figcaption>` : '';
  const hatched = hatchSet(c, xs);
  const legend =
    series.length > 1
      ? `<div class="legend" aria-hidden="true">${series.map((s) => `<span><i class="${s.cls}"></i>${esc(s.name)}</span>`).join('')}${hatched.size ? '<span><i class="hatch-k"></i>estimate</span>' : ''}</div>`
      : '';
  const label = plain(c.title ?? `${c.kind} chart of ${c.y.join(', ')}`);
  currentFormat = fmtNum;
  const marks = resolveMarks(c, xs);
  const desc = describe(c, xs, series, marks) + (hatched.size ? ` Striped (estimate): ${[...hatched].map((i) => xs[i]).join(', ')}.` : '');
  const table = dataTable(c, xs, series, marks);
  const list = barList(c, xs, series);
  if (list) return `<figure class="viz chart-fig">${title}${list}${table}</figure>`;
  const focusX = focusIndex(c, xs);
  const cw = opts.cellWidth && opts.cellWidth > 0 ? Math.round(opts.cellWidth) : 0;
  // In a grid cell the desktop drawing is made at the cell's own width (CSS shows it from 720px up).
  const wide = cw
    ? `<div class="chart-wide chart-cell">${svg(c, xs, series, cw, `${uid}c`, label, desc, marks, focusX)}</div>`
    : `<div class="chart-wide">${svg(c, xs, series, 640, `${uid}w`, label, desc, marks, focusX)}</div>`;
  const narrow = svg(c, xs, series, 360, `${uid}n`, label, desc, marks, focusX);
  currentFormat = fmtNum;
  return `<figure class="viz chart-fig">${title}${legend}${wide}<div class="chart-narrow">${narrow}</div>${table}</figure>`;
}

/** Index of the x value `focus` names, when it names one and no series (series names win). */
function focusIndex(c: ChartBlock, xs: string[]): number {
  if (!c.focus || c.y.includes(c.focus)) return -1;
  return xs.indexOf(c.focus);
}

/** Req 3.6: a single-series hbar of at most 8 categories is HTML rows with no axis. */
function barList(c: ChartBlock, xs: string[], series: Series[]): string | null {
  if (c.kind !== 'hbar' || series.length !== 1 || xs.length > 8) return null;
  // Whatever an axis-less list would misstate keeps the axis chart: negatives, gaps, a target, a pinned range.
  if (c.target || c.min !== null || c.max !== null) return null;
  // v0.4: striped bars and labels=end need the drawn chart (the list always prints every value).
  if (hatchSet(c, xs).size || c.labelMode === 'end') return null;
  const vals = series[0].values;
  if (vals.some((v) => v === null || v < 0)) return null;
  const max = Math.max(...(vals as number[]));
  const on = focusIndex(c, xs);
  currentFormat = fmtNum;
  const rows = xs.map((x, i) => {
    const w = max > 0 ? +((vals[i]! / max) * 100).toFixed(1) : 0;
    return `<div class="bl${i === on ? ' on' : ''}"><span class="bl-l">${esc(x)}</span><span class="bl-b" style="--w:${w}%"></span><span class="bl-v">${esc(withUnit(vals[i]!, c.unit))}</span></div>`;
  });
  return `<div class="barlist${on >= 0 ? ' focus' : ''}">${rows.join('')}</div>`;
}

function describe(c: ChartBlock, xs: string[], series: Series[], marks: Mark[]): string {
  const parts = series.map((s) => {
    const pts = s.values.map((v, i) => [v, i] as const).filter(([v]) => v !== null) as [number, number][];
    if (!pts.length) return `${s.name}: no values`;
    const [first, last] = [pts[0], pts[pts.length - 1]];
    const max = pts.reduce((a, b) => (b[0] > a[0] ? b : a));
    const min = pts.reduce((a, b) => (b[0] < a[0] ? b : a));
    return `${s.name} goes from ${withUnit(first[0], c.unit)} (${xs[first[1]]}) to ${withUnit(last[0], c.unit)} (${xs[last[1]]}); highest ${withUnit(max[0], c.unit)} at ${xs[max[1]]}, lowest ${withUnit(min[0], c.unit)} at ${xs[min[1]]}`;
  });
  const kind = { line: 'Line', area: 'Area', bar: 'Bar', hbar: 'Horizontal bar', range: 'Range' }[c.kind];
  const events = marks.length ? ` Events: ${marks.map((m) => (m.label ? `${m.x}, ${m.label}` : m.x)).join('; ')}.` : '';
  return `${kind} chart, ${xs.length} values of ${c.x}. ${parts.join('. ')}.${events}`;
}

function dataTable(c: ChartBlock, xs: string[], series: Series[], marks: Mark[]): string {
  const ev = marks.length > 0;
  const head = `<tr><th scope="col">${esc(c.x)}</th>${series.map((s) => `<th scope="col" class="n">${esc(s.name)}</th>`).join('')}${ev ? '<th scope="col">Event</th>' : ''}</tr>`;
  const body = xs
    .map(
      (x, i) =>
        `<tr><th scope="row">${esc(x)}</th>${series.map((s) => `<td class="n">${s.values[i] === null ? '' : esc(withUnit(s.values[i], c.unit))}</td>`).join('')}${
          ev
            ? `<td>${esc(
                marks
                  .filter((m) => m.i === i)
                  .map((m) => m.label)
                  .filter(Boolean)
                  .join('; '),
              )}</td>`
            : ''
        }</tr>`,
    )
    .join('');
  return dataDetails(head, body);
}

/** Bar with a 4px rounded data end and a square baseline end. */
// oxlint-disable-next-line eslint/consistent-return -- exhaustive over `dir`
function barPath(x: number, y: number, w: number, h: number, dir: 'up' | 'down' | 'right' | 'left', round = true): string {
  const r = round ? Math.min(4, w / 2, h / 2) : 0;
  const f = (n: number) => n.toFixed(1);
  if (h <= 0 || w <= 0) return '';
  switch (dir) {
    case 'up':
      return `M${f(x)},${f(y + h)}V${f(y + r)}Q${f(x)},${f(y)} ${f(x + r)},${f(y)}H${f(x + w - r)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)}V${f(y + h)}Z`;
    case 'down':
      return `M${f(x)},${f(y)}V${f(y + h - r)}Q${f(x)},${f(y + h)} ${f(x + r)},${f(y + h)}H${f(x + w - r)}Q${f(x + w)},${f(y + h)} ${f(x + w)},${f(y + h - r)}V${f(y)}Z`;
    case 'right':
      return `M${f(x)},${f(y)}H${f(x + w - r)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)}V${f(y + h - r)}Q${f(x + w)},${f(y + h)} ${f(x + w - r)},${f(y + h)}H${f(x)}Z`;
    case 'left':
      return `M${f(x + w)},${f(y)}H${f(x + r)}Q${f(x)},${f(y)} ${f(x)},${f(y + r)}V${f(y + h - r)}Q${f(x)},${f(y + h)} ${f(x + r)},${f(y + h)}H${f(x + w)}Z`;
  }
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
const FS = 1.06; // safety factor on estimated text widths: the real font is rarely narrower than the estimate

function svg(
  c: ChartBlock,
  xs: string[],
  series: Series[],
  W: number,
  uid: string,
  label: string,
  desc: string,
  allMarks: Mark[],
  focusX = -1,
): string {
  const narrow = W < 500;
  /** Class of one bar: focus="x value" keeps the series color on that category and mutes the rest. */
  const barCls = (s: Series, _j: number, i: number): string => (focusX < 0 ? s.cls : i === focusX ? s.base : 'cm');
  const vals = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const stacked = c.stack && c.kind !== 'line';
  let dataLo = vals.length ? Math.min(...vals) : 0;
  let dataHi = vals.length ? Math.max(...vals) : 1;
  if (stacked) {
    const pos = xs.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
    const neg = xs.map((_, i) => series.reduce((a, s) => a + Math.min(0, s.values[i] ?? 0), 0));
    dataHi = Math.max(...pos, 0);
    dataLo = Math.min(...neg, 0);
  }
  let lo: number;
  let hi: number;
  // Req 3.3: bars always start at zero; line and area charts too, unless the data span is under 25% of its maximum.
  const sameSign = dataLo > 0 || dataHi < 0;
  const truncate25 =
    (c.kind === 'line' || c.kind === 'area') &&
    !stacked &&
    sameSign &&
    (dataHi - dataLo) / Math.max(Math.abs(dataHi), Math.abs(dataLo)) < 0.25;
  if (truncate25) {
    const pad = (dataHi - dataLo) * 0.1 || Math.abs(dataHi) * 0.05;
    lo = dataLo - pad;
    hi = dataHi + pad;
  } else {
    lo = Math.min(0, dataLo);
    hi = Math.max(0, dataHi);
  }
  if (c.target) {
    lo = Math.min(lo, c.target.value);
    hi = Math.max(hi, c.target.value);
  }
  if (c.min !== null) lo = c.min;
  if (c.max !== null) hi = c.max;
  const ticks = niceTicks(lo, hi, narrow ? 3 : 5);
  currentFormat = scaleFormat(Math.max(Math.abs(ticks[0]), Math.abs(ticks[ticks.length - 1])));
  if (c.min === null) lo = ticks[0];
  else
    ticks.splice(
      0,
      ticks.findIndex((t) => t >= lo),
    );
  if (c.max === null) hi = ticks[ticks.length - 1];
  let tickLabels = ticks.map((t) => withUnit(t, c.unit));
  // A compact format ("1M") can print several ticks of a narrow range identically: spell them out.
  if (new Set(tickLabels).size < tickLabels.length) {
    currentFormat = fmtNum;
    tickLabels = ticks.map((t) => withUnit(t, c.unit));
  }
  const valueW = Math.max(...tickLabels.map((t) => textWidth(t, FONT)));
  const out: string[] = [];
  const titleId = `${uid}-t`;
  const descId = `${uid}-d`;
  const hatched = hatchSet(c, xs);
  const hatchId = `${uid}-h`;
  const head = (H: number) =>
    `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="${titleId} ${descId}"><title id="${titleId}">${esc(label)}</title><desc id="${descId}">${esc(desc)}</desc>${hatched.size ? hatchDefs(hatchId) : ''}`;
  /** The striped overlay drawn over a hatched bar (the bar underneath keeps the series colour). */
  const hatchOver = (i: number, d: string): string => (hatched.has(i) && d ? `<path class="hatch" fill="url(#${hatchId})" d="${d}"/>` : '');
  const est = (i: number): string => (hatched.has(i) ? ' (estimate)' : '');
  const mode = c.labelMode;

  if (c.kind === 'hbar') {
    const labelW = Math.min(W * 0.38, Math.max(...xs.map((x) => textWidth(x, FONT))) + 8);
    const k = stacked ? 1 : series.length;
    const barH = Math.min(24, Math.max(8, k === 1 ? 24 : 16));
    const rowH = k * barH + (k - 1) * 2 + 12;
    // A target's label sits in its own band above the first row, so it never meets a bar label.
    const T = 8 + (c.target ? 18 : 0);
    const B = 24;
    const L = labelW + 8;
    const showVals = c.labels || xs.length * k <= 24;
    const R = 12 + (showVals ? valueW + 6 : 0);
    const H = T + rowH * xs.length + B;
    const pw = W - L - R;
    const sx = (v: number) => L + ((v - lo) / (hi - lo)) * pw;
    out.push(head(H));
    for (let t = 0; t < ticks.length; t++) {
      const x = sx(ticks[t]);
      out.push(`<line class="grid${ticks[t] === 0 ? ' zero' : ''}" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T}" y2="${H - B}"/>`);
      out.push(`<text class="tick" x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(tickLabels[t])}</text>`);
    }
    xs.forEach((x, i) => {
      const y0 = T + rowH * i + 6;
      out.push(
        `<text class="cat" x="${L - 8}" y="${(y0 + (rowH - 12) / 2 + 4).toFixed(1)}" text-anchor="end">${esc(truncate(x, labelW))}</text>`,
      );
      let acc = 0;
      let accN = 0;
      series.forEach((s, j) => {
        const v = s.values[i];
        if (v === null) return;
        let a: number;
        let b: number;
        if (stacked) {
          if (v >= 0) {
            a = acc;
            b = acc + v;
            acc = b;
          } else {
            a = accN + v;
            b = accN;
            accN = a;
          }
        } else {
          a = Math.min(0, v);
          b = Math.max(0, v);
        }
        // Bars grow from the axis baseline, which min=/max= may have moved off zero.
        a = Math.max(a, lo);
        b = Math.min(b, hi);
        if (b <= a) return;
        const yy = stacked ? y0 : y0 + j * (barH + 2);
        const x0 = sx(a);
        const x1 = sx(b);
        const isTop = !stacked || j === lastIdx(series, i, v >= 0);
        const gap = stacked && !isTop ? 2 : 0;
        const d = barPath(x0, yy, Math.max(x1 - x0 - gap, 1), barH, v >= 0 ? 'right' : 'left', isTop);
        out.push(
          `<path class="${barCls(s, j, i)}" fill="currentColor" d="${d}"><title>${esc(`${x} · ${s.name}: ${withUnit(v, c.unit)}${est(i)}`)}</title></path>${hatchOver(i, d)}`,
        );
        if (showVals && !stacked && (mode !== 'end' || i === xs.length - 1)) {
          out.push(
            `<text class="val" x="${(v >= 0 ? x1 + 6 : x0 - 6).toFixed(1)}" y="${(yy + barH / 2 + 4).toFixed(1)}" text-anchor="${v >= 0 ? 'start' : 'end'}">${esc(withUnit(v, c.unit))}</text>`,
          );
        }
        // labels=all on a stack: every segment's own value, centred in the segment (the total still follows the stack).
        if (mode === 'all' && stacked) {
          out.push(
            `<text class="val seg-v" x="${((x0 + x1) / 2).toFixed(1)}" y="${(yy + barH / 2 + 4).toFixed(1)}" text-anchor="middle">${esc(withUnit(v, c.unit))}</text>`,
          );
        }
      });
      if (showVals && stacked && (mode !== 'end' || i === xs.length - 1)) {
        out.push(
          `<text class="val" x="${(sx(acc) + 6).toFixed(1)}" y="${(y0 + barH / 2 + 4).toFixed(1)}">${esc(withUnit(acc + accN, c.unit))}</text>`,
        );
      }
    });
    if (c.target) {
      const x = sx(c.target.value);
      out.push(`<line class="target" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T - 4}" y2="${H - B}"/>`);
      const text = c.target.label || withUnit(c.target.value, c.unit);
      const tw = textWidth(text, 12, { bold: true }) * FS;
      const atEnd = x + 4 + tw > W; // no room to the right of the line: hang the label to its left
      out.push(
        `<text class="target-l" x="${(atEnd ? Math.min(x - 4, W) : x + 4).toFixed(1)}" y="${T - 8}" text-anchor="${atEnd ? 'end' : 'start'}">${esc(text)}</text>`,
      );
    }
    out.push('</svg>');
    return out.join('');
  }

  const B = 28;
  const L = valueW + 12;
  const endLabels = c.kind !== 'bar' && series.length > 1 && series.length <= 4 && !narrow;
  const lastOf = (s: Series): number | null => [...s.values].toReversed().find((v) => v !== null) ?? null;
  // labels=end prints "name value" at the line ends, so its column is measured with the value (bare labels keep v0.3's).
  const endLabelW = !endLabels
    ? 0
    : mode === 'end'
      ? Math.max(...series.map((s) => textWidth(`${s.name} ${lastOf(s) === null ? '' : withUnit(lastOf(s)!, c.unit)}`, FONT) * FS)) + 22
      : Math.max(...series.map((s) => textWidth(s.name, FONT))) + 22;
  // labels=end reserves the last-value column even on a stack (each series' own last value); labels=all labels in place.
  const lastVal = c.kind !== 'bar' && (mode === 'end' || (c.labels && !stacked && mode !== 'all')) ? valueW + 10 : 0;
  const R = Math.max(12, endLabelW, lastVal);
  const pw = W - L - R;
  const n = xs.length;
  // Bars: width, value-label rows and the head room they need are settled before the plot is laid out.
  const band = pw / n;
  const kBars = stacked ? 1 : series.length;
  const bw = Math.max(2, (band * (narrow ? 0.76 : 0.68) - 2 * (kBars - 1)) / kBars); // Req 3.8: >= 60% / 70% of the band
  const groupW = bw * kBars + 2 * (kBars - 1);
  const valLabelW = Math.max(
    0,
    ...series.flatMap((s) => s.values.map((v) => (v === null ? 0 : textWidth(withUnit(v, c.unit), FONT) * FS))),
  );
  // Value-space bar segments, so the labels can be planned before the plot's height is known.
  interface Seg {
    i: number;
    j: number;
    v: number;
    a: number;
    b: number;
    x0: number;
    top: boolean;
    gap: number;
  }
  const segs: Seg[] = [];
  const stackTop: number[] = []; // top of the positive stack, per category
  if (c.kind === 'bar') {
    xs.forEach((_, i) => {
      let acc = 0;
      let accN = 0;
      series.forEach((s, j) => {
        const v = s.values[i];
        if (v === null) return;
        const x0 = L + band * (i + 0.5) + (stacked ? -bw / 2 : -groupW / 2 + j * (bw + 2));
        let a: number;
        let b: number;
        if (stacked) {
          if (v >= 0) {
            a = acc;
            b = acc + v;
            acc = b;
          } else {
            a = accN + v;
            b = accN;
            accN = a;
          }
        } else {
          a = Math.min(0, v);
          b = Math.max(0, v);
        }
        a = Math.max(a, lo);
        b = Math.min(b, hi);
        if (b <= a) return;
        const top = !stacked || j === lastIdx(series, i, v >= 0);
        segs.push({ i, j, v, a, b, x0, top, gap: stacked && !top ? 2 : 0 });
      });
      stackTop[i] = acc;
    });
  }
  const totals = xs.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  // Value labels by default when every label fits over its own bar.
  const showVals = c.kind === 'bar' && (c.labels || (!stacked && valLabelW <= (kBars === 1 ? band * 0.9 : bw + 2)));
  // Event markers: flags sit in a band above the plot, so the plot keeps its size and the axis range is untouched.
  const markX = (i: number): number => (c.kind === 'bar' ? L + (pw / n) * (i + 0.5) : n === 1 ? L + pw / 2 : L + (pw / (n - 1)) * i);
  const flags = allMarks.length ? layoutFlags(allMarks, markX, W, narrow) : null;
  const t0 = (showVals ? 18 : c.labels && stacked ? 22 : 12) + (mode === 'all' && c.kind !== 'bar' ? 14 : 0);
  /** Geometry for `m` px of extra head room (labels that had to be lifted clear of their neighbours). */
  const geom = (m: number) => {
    const flagBand = flags ? flags.lanes * FLAG_LANE + 6 + m : 0;
    const H = (narrow ? 220 : 280) + flagBand;
    const T = t0 + (flags ? flagBand : m);
    const ph = H - T - B;
    return { H, T, ph, sy: (v: number) => T + ph - ((v - lo) / (hi - lo)) * ph };
  };
  interface Lbl {
    text: string;
    x: number;
    y: number;
  }
  /** Bar value labels (or stack totals) at their bars; one that would touch an earlier label is lifted 14px at a time. */
  const planLabels = (sy: (v: number) => number): { items: Lbl[]; up: number } => {
    const items: Lbl[] = [];
    const placed: Box[] = [];
    let up = 0;
    const put = (text: string, x: number, y: number, dir: 1 | -1) => {
      const w = textWidth(text, FONT) * FS;
      let step = 0;
      const clashes = (yy: number) =>
        placed.filter((p) => x - w / 2 - 2 < p.x1 && p.x0 < x + w / 2 + 2 && yy - 12 < p.y1 && p.y0 < yy + 3).length;
      while (step < 5 && clashes(y + dir * 14 * step)) step++;
      if (step === 5) step = [0, 1, 2, 3, 4].reduce((best, k) => (clashes(y + dir * 14 * k) < clashes(y + dir * 14 * best) ? k : best), 0);
      const yy = y + dir * 14 * step;
      placed.push({ x0: x - w / 2, x1: x + w / 2, y0: yy - 12, y1: yy + 3 });
      if (dir < 0) up = Math.max(up, step * 14);
      items.push({ text, x, y: yy });
    };
    if (showVals && stacked) {
      xs.forEach((_, i) => {
        if (mode !== 'end' || i === n - 1) put(withUnit(totals[i], c.unit), L + band * (i + 0.5), sy(stackTop[i]) - 5, -1);
      });
    } else if (showVals) {
      for (const g of segs)
        if (mode !== 'end' || g.i === n - 1)
          put(withUnit(g.v, c.unit), g.x0 + bw / 2, g.v >= 0 ? sy(g.b) - 5 : sy(g.a) + 13, g.v >= 0 ? -1 : 1);
    }
    return { items, up };
  };
  let m = 0;
  let g = geom(0);
  let plan = planLabels(g.sy);
  for (let k = 0; k < 6 && plan.up !== m; k++) {
    m = plan.up;
    g = geom(m);
    plan = planLabels(g.sy);
  }
  const { H, T, sy } = g;
  const maxLift = m;
  const valBoxes: Box[] = [];
  /** A value label; its box is remembered so the target label can keep clear of it. */
  const valText = (text: string, x: number, y: number, anchor: 'start' | 'middle' | 'end'): string => {
    const w = textWidth(text, FONT) * FS;
    const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    valBoxes.push({ x0, x1: x0 + w, y0: y - 12, y1: y + 3 });
    return `<text class="val" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${esc(text)}</text>`;
  };
  out.push(head(H));
  for (let t = 0; t < ticks.length; t++) {
    const y = sy(ticks[t]);
    out.push(`<line class="grid${ticks[t] === 0 ? ' zero' : ''}" x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`);
    out.push(`<text class="tick" x="${L - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(tickLabels[t])}</text>`);
  }
  // Req 3.3: a line or area axis that does not start at zero says so with a break glyph at its base.
  if ((c.kind === 'line' || c.kind === 'area') && c.min === null && ticks[0] > 0) {
    const by = sy(ticks[0]);
    out.push(
      `<path class="ybreak" fill="none" d="M${(L - 4).toFixed(1)},${(by - 2).toFixed(1)}l9,-6M${(L - 4).toFixed(1)},${(by + 4).toFixed(1)}l9,-6"/>`,
    );
  }
  const backAt = out.length; // rules and bands are spliced in here, behind the series
  let barLabels = false;
  let cx: (i: number) => number;
  if (c.kind === 'bar') {
    cx = (i) => L + band * (i + 0.5);
    barLabels = showVals;
    for (const sg of segs) {
      const s = series[sg.j];
      const y0 = sy(sg.b) + (sg.v >= 0 ? sg.gap : 0);
      const y1 = sy(sg.a) - (sg.v < 0 ? sg.gap : 0);
      const d = barPath(sg.x0, y0, bw, Math.max(y1 - y0, 1), sg.v >= 0 ? 'up' : 'down', sg.top);
      out.push(
        `<path class="${barCls(s, sg.j, sg.i)}" fill="currentColor" d="${d}"><title>${esc(`${xs[sg.i]} · ${s.name}: ${withUnit(sg.v, c.unit)}${est(sg.i)}`)}</title></path>${hatchOver(sg.i, d)}`,
      );
    }
    // labels=all on a stack: each segment's own value in the segment's middle, besides the total above the stack.
    if (mode === 'all' && stacked) {
      for (const sg of segs)
        out.push(
          valText(withUnit(sg.v, c.unit), sg.x0 + bw / 2, (sy(sg.a) + sy(sg.b)) / 2 + 4, 'middle').replace(
            'class="val"',
            'class="val seg-v"',
          ),
        );
    }
    // Req 3.5: with labels, a stack's total (positives and negatives netted) is printed above the stack.
    for (const l of plan.items) out.push(valText(l.text, l.x, l.y, 'middle'));
  } else {
    const step = pw / Math.max(n - 1, 1);
    cx = (i) => (n === 1 ? L + pw / 2 : L + step * i);
    const cum = xs.map(() => 0);
    const ends: { y: number; name: string; cls: string; v: number }[] = [];
    const allPts: { i: number; x: number; y: number; v: number }[] = [];
    series.forEach((s) => {
      const pts: [number, number, number][] = [];
      const basePts: [number, number][] = [];
      s.values.forEach((v, i) => {
        if (v === null) return;
        const b = stacked ? cum[i] : lo < 0 && hi > 0 ? 0 : lo;
        const top = stacked ? cum[i] + v : v;
        if (stacked) cum[i] = top;
        pts.push([cx(i), sy(top), i]);
        basePts.push([cx(i), sy(b)]);
      });
      if (!pts.length) return;
      const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      if (c.kind === 'area') {
        const back = [...basePts]
          .toReversed()
          .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
          .join(' ');
        out.push(`<polygon class="${s.cls} area" fill="currentColor" points="${line} ${back}"/>`);
      }
      out.push(`<polyline class="${s.cls} line" fill="none" stroke="currentColor" points="${line}"/>`);
      if (n <= 16 && c.kind === 'line') {
        for (const [px, py] of pts.slice(0, -1))
          out.push(`<circle class="${s.cls} pt" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="currentColor"/>`);
      }
      const [ex, ey, ei] = pts[pts.length - 1];
      out.push(`<circle class="${s.cls} dot" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4" fill="currentColor"/>`);
      for (const [px, py, i] of pts) {
        out.push(
          `<circle class="hit" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="9"><title>${esc(`${xs[i]} · ${s.name}: ${withUnit(s.values[i]!, c.unit)}`)}</title></circle>`,
        );
      }
      ends.push({ y: ey, name: s.name, cls: s.cls, v: s.values[ei]! });
      if (mode === 'all') for (const [px, py, i] of pts) allPts.push({ i, x: px, y: py, v: s.values[i]! });
    });
    const spread = () => {
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
      const over = ends.length ? ends[ends.length - 1].y - (H - B) : 0;
      if (over > 0) ends.forEach((e) => (e.y -= over));
    };
    if (endLabels) {
      spread();
      for (const e of ends) {
        const x = W - R + 10;
        out.push(`<rect class="${e.cls}" fill="currentColor" x="${x}" y="${(e.y - 4).toFixed(1)}" width="8" height="8" rx="2"/>`);
        out.push(
          `<text class="end" x="${x + 12}" y="${(e.y + 4).toFixed(1)}">${esc(e.name)}${c.labels && mode !== 'all' ? ` ${esc(withUnit(e.v, c.unit))}` : ''}</text>`,
        );
      }
    } else if (mode === 'end') {
      // labels=end: each series' last value beside its end point, nudged apart so two never touch.
      spread();
      for (const e of ends) out.push(valText(withUnit(e.v, c.unit), W - R + 8, e.y + 4, 'start'));
    } else if (c.labels && !stacked && mode !== 'all') {
      for (const e of ends) out.push(valText(withUnit(e.v, c.unit), W - R + 8, e.y + 4, 'start'));
    }
    if (mode === 'all') {
      // labels=all: every point's value, never hidden. At each x the topmost point is labelled above, the rest below.
      for (let i = 0; i < n; i++) {
        const here = allPts.filter((p) => p.i === i).toSorted((a, b) => a.y - b.y);
        const anchor = n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle';
        here.forEach((p, k) => {
          const y = k === 0 ? Math.max(p.y - 9, 12) : Math.min(p.y + 17, H - B - 2);
          out.push(valText(withUnit(p.v, c.unit), p.x, y, anchor));
        });
      }
    }
    // Req 3.5: a stacked area prints its total at the last x, above the top edge.
    if (c.labels && stacked && mode === undefined) {
      const last = n - 1;
      const topY = sy(totals[last] + 0) - 8;
      out.push(
        valText(
          withUnit(
            series.reduce((a, s) => a + (s.values[last] ?? 0), 0),
            c.unit,
          ),
          cx(last),
          topY,
          'end',
        ),
      );
    }
  }
  if (c.target) {
    const y = sy(c.target.value);
    const text = c.target.label || withUnit(c.target.value, c.unit);
    out.push(`<line class="target" x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`);
    const tl = flags
      ? targetLabelSlot(textWidth(text, TARGET_FONT, { bold: true }) * FS, L, W - R, flags.rules)
      : { x: W - R - 4, anchor: 'end' as const, maxW: Infinity };
    const shown = tl.maxW < Infinity ? truncateTo(text, tl.maxW, TARGET_FONT) : text;
    const tw = textWidth(shown, TARGET_FONT, { bold: true }) * 1.04 * FS;
    // Right-aligned at the plot's edge, just above the line. When that spot would cover a value label (or a marker
    // rule), slide left, then try below and higher up: the cheapest free spot wins.
    let best = { x: tl.x, y: y - 6, cost: Infinity };
    for (const [dy, pen] of [
      [-6, 0],
      [16, 40],
      [-26, 80],
      [36, 120],
    ] as const) {
      for (let x = tl.x; x - tw >= L; x -= 6) {
        const box: Box = { x0: x - tw - 2, x1: x + 2, y0: y + dy - 13, y1: y + dy + 4 };
        if (box.y0 < 0 || box.y1 > H - B) continue;
        const cost = tl.x - x + pen;
        if (cost >= best.cost) break;
        const hitsVal = valBoxes.some((v) => box.x0 < v.x1 && v.x0 < box.x1 && box.y0 < v.y1 && v.y0 < box.y1);
        const hitsRule = flags ? flags.rules.some((r) => r > box.x0 && r < box.x1) : false;
        if (!hitsVal && !hitsRule) best = { x, y: y + dy, cost };
      }
    }
    if (best.cost === Infinity) best = { x: tl.x, y: y - 6, cost: 0 };
    out.push(
      `<text class="target-l" x="${best.x.toFixed(1)}" y="${best.y.toFixed(1)}" text-anchor="${tl.anchor}">${shown === text ? '' : `<title>${esc(text)}</title>`}${esc(shown)}</text>`,
    );
  }
  // x labels (Req 3.1): first and last are always kept, marked categories next, then every step-th label, with the
  // smallest step at which no two labels touch. The estimate carries a safety margin because the real font may be wider.
  const must = new Set(allMarks.map((mk) => mk.i));
  const XGAP = 10;
  const spans = xs.map((x, i) => {
    const w = textWidth(x, FONT, { bold: must.has(i) }) * FS;
    let anchor: 'start' | 'middle' | 'end' = 'middle';
    if (c.kind !== 'bar' && n > 1 && i === 0) anchor = 'start';
    if (c.kind !== 'bar' && n > 1 && i === n - 1) anchor = 'end';
    let px = cx(i);
    let x0 = anchor === 'start' ? px : anchor === 'end' ? px - w : px - w / 2;
    // Bars centre their label under the bar; one that would leave the drawing is pushed back inside it.
    if (anchor === 'middle' && x0 < 1) {
      anchor = 'start';
      px = x0 = 1;
    } else if (anchor === 'middle' && x0 + w > W - 1) {
      anchor = 'end';
      px = W - 1;
      x0 = px - w;
    }
    return { x0, x1: x0 + w, anchor, px };
  });
  const clear = (a: number, b: number): boolean => spans[a].x1 + XGAP <= spans[b].x0 || spans[b].x1 + XGAP <= spans[a].x0;
  const pickTicks = (step: number): number[] | null => {
    const keep: number[] = [];
    for (const i of [0, n - 1, ...[...must].toSorted((a, b) => a - b)])
      if (!keep.includes(i) && keep.every((k) => clear(k, i))) keep.push(i);
    const required = keep.slice();
    for (let i = step; i < n - 1; i += step) {
      if (keep.includes(i)) continue;
      if (keep.every((k) => clear(k, i))) keep.push(i);
      else if (!required.some((k) => !clear(k, i))) return null; // blocked by another regular label: this step is too tight
    }
    return keep;
  };
  let kept: number[] = [];
  for (let step = 1; step <= Math.max(n, 1); step++) {
    const got = pickTicks(step);
    if (got) {
      kept = got;
      break;
    }
  }
  if (!kept.length) kept = [0, n - 1].filter((i, k, a) => a.indexOf(i) === k && (k === 0 || clear(0, i)));
  kept.sort((a, b) => a - b);
  for (const i of kept)
    out.push(
      `<text class="tick${must.has(i) ? ' mk-x' : ''}" x="${spans[i].px.toFixed(1)}" y="${H - 8}" text-anchor="${spans[i].anchor}">${esc(xs[i])}</text>`,
    );
  if (flags) {
    // Per category: the topmost flag's pole runs down to the baseline (or, on bars, to just above the group's labels).
    const stemEnd = (i: number): number => {
      let top = sy(0 < lo ? lo : 0 > hi ? hi : 0);
      let acc = 0;
      for (const s of series) {
        const v = s.values[i];
        if (v === null) continue;
        top = Math.min(top, sy(stacked ? (acc += Math.max(0, v)) : Math.max(v, 0 < lo ? lo : 0)));
      }
      return top - (barLabels ? 22 + maxLift : 8);
    };
    const back: string[] = [];
    const seen = new Set<number>();
    for (const f of flags.items) {
      if (seen.has(f.m.i)) continue;
      seen.add(f.m.i);
      const topF = flags.items.filter((h) => h.m.i === f.m.i).reduce((best, h) => (h.lane < best.lane ? h : best));
      const y1 = flagTop(topF.lane) + FLAG_H;
      if (c.kind === 'bar') {
        back.push(
          `<rect class="mk-band" x="${(L + band * f.m.i + 2).toFixed(1)}" y="${T}" width="${Math.max(band - 4, 1).toFixed(1)}" height="${H - B - T}"/>`,
        );
        const y2 = Math.max(y1, stemEnd(f.m.i));
        back.push(
          `<line class="mk-rule" x1="${f.x.toFixed(1)}" x2="${f.x.toFixed(1)}" y1="${y1}" y2="${y2.toFixed(1)}"/><circle class="mk-dot" cx="${f.x.toFixed(1)}" cy="${y2.toFixed(1)}" r="2.5"/>`,
        );
      } else {
        back.push(`<line class="mk-rule" x1="${f.x.toFixed(1)}" x2="${f.x.toFixed(1)}" y1="${y1}" y2="${H - B}"/>`);
      }
    }
    out.splice(backAt, 0, ...back);
    for (const f of flags.items) out.push(flagSvg(f));
  }
  out.push('</svg>');
  return out.join('');
}

function lastIdx(series: Series[], i: number, positive: boolean): number {
  let idx = -1;
  series.forEach((s, j) => {
    const v = s.values[i];
    if (v !== null && v >= 0 === positive) idx = j;
  });
  return idx;
}

function truncate(s: string, w: number): string {
  if (textWidth(s, FONT) <= w) return s;
  let t = s;
  while (t.length > 1 && textWidth(`${t}…`, FONT) > w) t = t.slice(0, -1);
  return `${t}…`;
}

/* stream-a: event markers */

export interface Mark {
  i: number;
  x: string;
  label: string;
}

const FLAG_FONT = 12;
const FLAG_H = 20;
const FLAG_LANE = 24;
const FLAG_PAD = 7;
const flagTop = (lane: number): number => 2 + lane * FLAG_LANE;

/** Marks that resolve to a category of the chart's current data; unresolved ones are skipped silently. */
export function resolveMarks(c: ChartBlock, xs: string[]): Mark[] {
  if (c.kind === 'hbar') return [];
  const out: Mark[] = [];
  for (const m of c.marks ?? []) {
    const i = xs.indexOf(m.x);
    if (i >= 0) out.push({ i, x: m.x, label: m.label });
  }
  return out;
}

export interface Flag {
  m: Mark;
  x: number;
  x0: number;
  w: number;
  side: 'r' | 'l' | 'c';
  lane: number;
  text: string;
}

/**
 * Places flags in lanes above the plot. A flag hangs off its rule like a pennant (right of it, or left near the
 * right edge). Lanes are assigned in x order so that no two flags overlap and no rule crosses another flag.
 */
export function layoutFlags(
  marks: Mark[],
  cx: (i: number) => number,
  W: number,
  narrow: boolean,
): { items: Flag[]; lanes: number; rules: number[] } {
  const maxW = narrow ? 124 : 200;
  const items: Flag[] = [];
  // A bare tick adds nothing where a labelled flag already marks the same category.
  const shown = marks.filter((m, k) => m.label || !marks.some((o, j) => o.i === m.i && (o.label || j < k)));
  const order = shown.map((m, k) => ({ m, k })).toSorted((a, b) => cx(a.m.i) - cx(b.m.i) || a.k - b.k);
  const gap = 6;
  for (const { m } of order) {
    const x = cx(m.i);
    let side: Flag['side'] = 'c';
    let w = 8;
    let text = '';
    if (m.label) {
      const full = textWidth(m.label, FLAG_FONT, { bold: true }) * 1.04 + 2 * FLAG_PAD;
      w = Math.min(full, maxW);
      const availR = W - 2 - x;
      const availL = x - 2;
      if (w <= availR) side = 'r';
      else if (w <= availL) side = 'l';
      else {
        side = availR >= availL ? 'r' : 'l';
        w = Math.max(24, Math.min(w, Math.max(availR, availL)));
      }
      text = truncateTo(m.label, w - 2 * FLAG_PAD, FLAG_FONT);
    }
    const x0 = side === 'r' ? x : side === 'l' ? x - w : x - w / 2;
    const f: Flag = { m, x, x0, w, side, lane: 0, text };
    const inside = (px: number, g: Flag) => px > g.x0 + 1 && px < g.x0 + g.w - 1;
    // Hard rule: flags in one lane never overlap. Soft rule: no rule runs through a lower flag (it would only
    // disappear behind the flag, so it is given up when a flag flipped to the left makes it impossible).
    const ok = (lane: number, soft: boolean): boolean =>
      items.every((g) => {
        const overlap = f.x0 < g.x0 + g.w + gap && g.x0 < f.x0 + f.w + gap;
        if (overlap && lane === g.lane) return false;
        if (!soft) return true;
        if (inside(f.x, g) && lane <= g.lane) return false; // this rule would run through g
        if (inside(g.x, f) && lane >= g.lane) return false; // g's rule would run through this flag
        return true;
      });
    let relaxed = 0;
    while (!ok(relaxed, false)) relaxed++;
    let lane = 0;
    while (lane <= relaxed + 1 && !ok(lane, true)) lane++;
    f.lane = lane <= relaxed + 1 ? lane : relaxed;
    items.push(f);
  }
  return { items, lanes: items.reduce((a, f) => Math.max(a, f.lane + 1), 0), rules: items.map((f) => f.x) };
}

function flagSvg(f: Flag): string {
  const y = flagTop(f.lane);
  const tip = esc(f.m.label ? `${f.m.x}: ${f.m.label}` : f.m.x);
  const px = f.x.toFixed(1);
  const hit = `<rect class="mk-hit" x="${(f.x - 5).toFixed(1)}" y="${y}" width="10" height="${FLAG_H}"/>`;
  if (!f.m.label) {
    return `<g class="mark"><title>${tip}</title>${hit}<line class="mk-pole" x1="${px}" x2="${px}" y1="${y}" y2="${y + FLAG_H}"/><circle class="mk-dot" cx="${px}" cy="${y + 4}" r="3"/></g>`;
  }
  const tx = f.side === 'r' ? f.x + FLAG_PAD : f.x - FLAG_PAD;
  return (
    `<g class="mark"><title>${tip}</title><rect class="mk-flag" x="${f.x0.toFixed(1)}" y="${y}" width="${f.w.toFixed(1)}" height="${FLAG_H}" rx="3"/>` +
    `<line class="mk-pole" x1="${px}" x2="${px}" y1="${y}" y2="${y + FLAG_H}"/>` +
    `<text class="mk-t" x="${tx.toFixed(1)}" y="${y + 14}" text-anchor="${f.side === 'r' ? 'start' : 'end'}">${esc(f.text)}</text></g>`
  );
}

/** Where the target label goes so no marker rule runs through it: the rightmost free gap, else the default. */
function targetLabelSlot(w: number, left: number, right: number, rules: number[]): { x: number; anchor: 'start' | 'end'; maxW: number } {
  const pad = 6;
  const edgeRule = rules.some((r) => Math.abs(r - right) < 1) ? 5 : 0;
  right -= edgeRule;
  const xs = [...new Set(rules)].filter((r) => r > left && r < right).toSorted((a, b) => a - b);
  const edges = [left, ...xs, right];
  let best = { x: right - 4, w: 0 };
  for (let k = edges.length - 2; k >= 0; k--) {
    const a = edges[k] + (k === 0 ? 0 : pad);
    const b = edges[k + 1] - (k === edges.length - 2 ? 0 : pad);
    if (b - a >= w + 8) return { x: b - 4, anchor: 'end', maxW: Infinity };
    if (b - a > best.w) best = { x: b - 4, w: b - a };
  }
  // No gap holds the whole label: cut it to the widest gap (full text goes in a title), else keep the default spot.
  if (best.w >= 40) return { x: best.x, anchor: 'end', maxW: best.w - 8 };
  return { x: right - 4, anchor: 'end', maxW: Infinity };
}

function truncateTo(s: string, w: number, size: number): string {
  const wd = (t: string) => textWidth(t, size, { bold: true }) * 1.04;
  if (wd(s) <= w + 0.5) return s;
  let t = s;
  while (t.length > 1 && wd(`${t}…`) > w) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/* stream v04-1: hatch, chart range */

/** Indexes of the x values `hatch=` names. Only bar and hbar draw stripes; other kinds ignore `hatch`. */
function hatchSet(c: ChartBlock, xs: string[]): Set<number> {
  const out = new Set<number>();
  if ((c.kind !== 'bar' && c.kind !== 'hbar') || !c.hatch?.length) return out;
  const want = new Set(c.hatch.map((h) => h.trim()));
  xs.forEach((x, i) => {
    if (want.has((x ?? '').trim())) out.add(i);
  });
  return out;
}

/**
 * One stripe pattern per SVG. Inside a <pattern>, currentColor follows the pattern's own ancestors, not the bar that
 * uses it, so the stripes are surface-coloured gaps laid over a bar drawn in its normal series colour.
 */
function hatchDefs(id: string): string {
  return `<defs><pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hatch-s" x="0" y="0" width="2.5" height="6"/></pattern></defs>`;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 864e5;
const ISO_RE = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/;

/** An ISO date (YYYY-MM-DD) as UTC epoch days; null when it is not one or names no real day (2026-02-30). */
export function isoDay(s: string | undefined): number | null {
  const m = ISO_RE.exec(s ?? '');
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return t / DAY_MS;
}

const ymd = (day: number): [number, number, number] => {
  const dt = new Date(Math.round(day) * DAY_MS);
  return [dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()];
};
/** "Mar 1", or "Mar 1, 2026" with the year. Always UTC, so no time zone moves a date. */
export function fmtDay(day: number, year = false): string {
  const [y, m, d] = ymd(day);
  return `${MON[m]} ${d}${year ? `, ${y}` : ''}`;
}
const dayOf = (y: number, m: number, d = 1): number => Date.UTC(y, m, d) / DAY_MS;

/** Calendar-aligned tick candidates for a date span, finest first: days, weeks (Mondays), month starts, years. */
function dateTickCandidates(lo: number, hi: number): { ticks: number[]; labels: string[] }[] {
  const out: { ticks: number[]; labels: string[] }[] = [];
  const span = hi - lo;
  for (const step of [1, 2, 7, 14]) {
    if (span / step > 40) continue;
    // Weeks start on Mondays (epoch day 4, 1970-01-05, was a Monday).
    let s = Math.ceil(lo);
    if (step >= 7) s += (((4 - s) % 7) + 7) % 7;
    const ticks: number[] = [];
    for (let v = s; v <= hi; v += step) ticks.push(v);
    out.push({ ticks, labels: ticks.map((t) => fmtDay(t)) });
  }
  const [y0, m0] = ymd(lo);
  for (const step of [1, 2, 3, 6]) {
    if (span / (30 * step) > 40) continue;
    const ticks: number[] = [];
    for (let k = y0 * 12 + m0; ; k++) {
      if (k % step) continue;
      const v = dayOf(Math.floor(k / 12), k % 12);
      if (v > hi) break;
      if (v >= lo) ticks.push(v);
    }
    // The year is printed on the first tick and on every January.
    out.push({
      ticks,
      labels: ticks.map((t, i) => {
        const [y, m] = ymd(t);
        return i === 0 || m === 0 ? `${MON[m]} ${y}` : MON[m];
      }),
    });
  }
  for (const step of [1, 2, 5, 10, 25, 50, 100]) {
    const ticks: number[] = [];
    for (let y = Math.ceil(y0 / step) * step; ; y += step) {
      const v = dayOf(y, 0);
      if (v > hi) break;
      if (v >= lo) ticks.push(v);
    }
    out.push({ ticks, labels: ticks.map((t) => String(ymd(t)[0])) });
  }
  return out;
}

interface RangeRow {
  label: string;
  a: number;
  b: number;
  at: number | null;
}
interface RangeAxis {
  dates: boolean;
  lo: number;
  hi: number;
  long: (v: number) => string;
}
type RangeTarget = { v: number; label: string } | null;

/** Shown when nothing in a range chart can be drawn: the data as a plain table, as other charts do on bad input. */
/** A chart's data as a table in a box that scrolls sideways, so it takes focus and has a name (WCAG 2.1.1). */
const dataBox = (head: string, body: string) =>
  `<div class="scroll" tabindex="0" role="region" aria-label="Chart data"><table>${head}${body}</table></div>`;
const dataDetails = (head: string, body: string) => `<details class="data"><summary>Data</summary>${dataBox(head, body)}</details>`;

function rangeFallback(c: ChartBlock, d: DataSet, cols: number[]): string {
  const title = c.title ? `<figcaption>${inline(c.title)}</figcaption>` : '';
  const head = `<tr>${cols.map((i) => `<th scope="col">${esc(d.columns[i])}</th>`).join('')}</tr>`;
  const body = d.rows
    .map(
      (r) =>
        `<tr>${cols.map((i, k) => (k === 0 ? `<th scope="row">${esc(r[i] ?? '')}</th>` : `<td>${esc(r[i] ?? '')}</td>`)).join('')}</tr>`,
    )
    .join('');
  return `<figure class="viz chart-fig rg-fallback">${title}${dataBox(head, body)}</figure>`;
}

/**
 * `chart range` (F.2): one bar per row from `from` to `to` on a shared to-scale axis. The first column is the row
 * label. Values are all numbers or all ISO dates, decided by the majority of the from/to cells; a row whose from or
 * to does not read in that kind is skipped (the data table still lists it). A span written backwards (from > to) is
 * drawn the same as forwards; a zero-length span is drawn as a 3px sliver. Nothing drawable: the data as a table.
 */
function renderRange(c: ChartBlock, d: DataSet, uid: string, opts: ChartOpts): string {
  if (d.rows.length === 0) return `<figure class="viz"><p class="empty">No data in ${esc(d.name)}.</p></figure>`;
  const fi = c.from ? d.columns.indexOf(c.from) : -1;
  const ti = c.to ? d.columns.indexOf(c.to) : -1;
  const ai = c.at ? d.columns.indexOf(c.at) : -1;
  const cols = [0, fi, ti, ai].filter((v, k, a) => v >= 0 && a.indexOf(v) === k);
  if (fi < 0 || ti < 0)
    return rangeFallback(
      c,
      d,
      d.columns.map((_, i) => i),
    );
  const cells = d.rows.flatMap((r) => [r[fi], r[ti]]);
  const dates = cells.filter((v) => isoDay(v) !== null).length > cells.filter((v) => num(v) !== null && !ISO_RE.test(v ?? '')).length;
  const val = (s: string | undefined): number | null => (dates ? isoDay(s) : ISO_RE.test(s ?? '') ? null : num(s));
  const rows: RangeRow[] = [];
  for (const r of d.rows) {
    const f = val(r[fi]);
    const t = val(r[ti]);
    if (f === null || t === null) continue;
    rows.push({ label: r[0] ?? '', a: Math.min(f, t), b: Math.max(f, t), at: ai >= 0 ? val(r[ai]) : null });
  }
  if (!rows.length) return rangeFallback(c, d, cols);
  const target = rangeTarget(c, dates);
  const bands = (c.bands ?? [])
    .map((b) => val(b))
    .filter((v): v is number => v !== null)
    .slice(0, 4);
  const all = [...rows.flatMap((r) => (r.at === null ? [r.a, r.b] : [r.a, r.b, r.at])), ...bands, ...(target ? [target.v] : [])];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  currentFormat = fmtNum;
  let axis: RangeAxis;
  if (dates) {
    const pad = Math.max(1, (hi - lo) * 0.03);
    axis = { dates, lo: lo - pad, hi: hi + pad, long: (v) => fmtDay(v, true) };
  } else {
    if (c.min !== null) lo = c.min;
    if (c.max !== null) hi = c.max;
    axis = { dates, lo, hi, long: (v) => withUnit(v, c.unit) };
  }
  const label = plain(c.title ?? `Range chart of ${c.from} to ${c.to}`);
  const desc = describeRange(c, rows, axis, target, bands);
  const legend =
    ai >= 0
      ? `<div class="legend" aria-hidden="true"><span><i class="c1"></i>${esc(c.from!)} – ${esc(c.to!)}</span><span><i class="rg-at-k"></i>${esc(c.at!)}</span></div>`
      : '';
  const title = c.title ? `<figcaption>${inline(c.title)}</figcaption>` : '';
  const head = `<tr>${cols.map((i) => `<th scope="col"${i === 0 ? '' : ' class="n"'}>${esc(d.columns[i])}</th>`).join('')}</tr>`;
  const body = d.rows
    .map(
      (r) =>
        `<tr>${cols.map((i, k) => (k === 0 ? `<th scope="row">${esc(r[i] ?? '')}</th>` : `<td class="n">${esc(r[i] ?? '')}</td>`)).join('')}</tr>`,
    )
    .join('');
  const table = dataDetails(head, body);
  const cw = opts.cellWidth && opts.cellWidth > 0 ? Math.round(opts.cellWidth) : 0;
  const draw = (W: number, id: string) => rangeSvg(c, rows, axis, target, bands, W, id, label, desc);
  const wide = cw
    ? `<div class="chart-wide chart-cell">${draw(cw, `${uid}c`)}</div>`
    : `<div class="chart-wide">${draw(640, `${uid}w`)}</div>`;
  const narrow = draw(360, `${uid}n`);
  currentFormat = fmtNum;
  return `<figure class="viz chart-fig">${title}${legend}${wide}<div class="chart-narrow">${narrow}</div>${table}</figure>`;
}

/**
 * The target on a range chart. On a date axis a numeric `target.value` is read as UTC epoch days (days since
 * 1970-01-01): that is how a date target travels in the AST's numeric field. Until the parser reads dates in
 * target=, the v0.3 split of `target="2026-03-15 launch"` (value 2026, label "-03-15 launch") is put back together,
 * and a label that itself starts with an ISO date is read as the date.
 */
function rangeTarget(c: ChartBlock, dates: boolean): RangeTarget {
  if (!c.target) return null;
  const { value, label } = c.target;
  if (dates) {
    const split = /^(-\d{2}-\d{2})(?:\s+|$)(.*)$/.exec(label);
    if (split && Number.isInteger(value) && value >= 1000 && value <= 9999) {
      const v = isoDay(`${value}${split[1]}`);
      if (v !== null) return { v, label: split[2].trim() };
    }
    const lead = /^(\d{4}-\d{2}-\d{2})(?:\s+|$)(.*)$/.exec(label);
    if (lead && isoDay(lead[1]) !== null) return { v: isoDay(lead[1])!, label: lead[2].trim() };
  }
  // The parser (Appendix F.2) delivers a date target as UTC epoch milliseconds; the axis is in epoch days.
  if (dates && Number.isFinite(value) && Math.abs(value) >= 1e8) return { v: value / 86_400_000, label };
  return Number.isFinite(value) ? { v: value, label } : null;
}

function describeRange(c: ChartBlock, rows: RangeRow[], axis: RangeAxis, target: RangeTarget, bands: number[]): string {
  const parts = rows.map((r) => `${r.label}: ${axis.long(r.a)} to ${axis.long(r.b)}${r.at === null ? '' : `, ${c.at} ${axis.long(r.at)}`}`);
  const t = target ? ` Target${target.label ? ` ${target.label}` : ''} at ${axis.long(target.v)}.` : '';
  const b = bands.length ? ` Thresholds at ${bands.map((v) => axis.long(v)).join(', ')}.` : '';
  return `Range chart, ${rows.length} row${rows.length === 1 ? '' : 's'} on a ${axis.dates ? 'date' : 'number'} axis. ${parts.join('; ')}.${t}${b}`;
}

function rangeSvg(
  c: ChartBlock,
  rows: RangeRow[],
  axis: RangeAxis,
  target: RangeTarget,
  bands: number[],
  W: number,
  uid: string,
  label: string,
  desc: string,
): string {
  const narrow = W < 500;
  const labelW = narrow ? 0 : Math.min(W * 0.38, Math.max(...rows.map((r) => textWidth(r.label, FONT))) + 8);
  const L = narrow ? 8 : labelW + 8;
  const R = 12;
  const pw = W - L - R;
  let lo = axis.lo;
  let hi = axis.hi;
  let ticks: number[];
  let tickLabels: string[];
  if (axis.dates) {
    // Calendar-aligned ticks: the finest set whose labels keep 10px apart (at most 4 on phones, 7 on desktop).
    const maxN = narrow ? 4 : 7;
    const at = (v: number) => L + ((v - lo) / (hi - lo)) * pw;
    const fits = (t: number[], l: string[]) =>
      t.length <= maxN &&
      t.every((v, k) => k === 0 || at(v) - at(t[k - 1]) >= ((textWidth(l[k], FONT) + textWidth(l[k - 1], FONT)) * FS) / 2 + 10);
    const cands = dateTickCandidates(lo, hi);
    const pick = cands.find((k) => k.ticks.length >= 2 && fits(k.ticks, k.labels)) ??
      cands.find((k) => k.ticks.length >= 1 && fits(k.ticks, k.labels)) ?? { ticks: [Math.round(lo)], labels: [fmtDay(lo)] };
    ticks = pick.ticks;
    tickLabels = pick.labels;
  } else {
    ticks = niceTicks(lo, hi, narrow ? 3 : 5);
    currentFormat = scaleFormat(Math.max(Math.abs(ticks[0]), Math.abs(ticks[ticks.length - 1])));
    if (c.min === null) lo = ticks[0];
    else ticks = ticks.filter((t) => t >= lo - 1e-9);
    if (c.max === null) hi = ticks[ticks.length - 1];
    else ticks = ticks.filter((t) => t <= hi + 1e-9);
    tickLabels = ticks.map((t) => withUnit(t, c.unit));
    if (new Set(tickLabels).size < tickLabels.length) {
      currentFormat = fmtNum;
      tickLabels = ticks.map((t) => withUnit(t, c.unit));
    }
  }
  if (!(hi > lo)) hi = lo + 1;
  const sx = (v: number) => L + ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * pw;
  const fmt = (v: number) => (axis.dates ? fmtDay(v) : withUnit(v, c.unit));
  // Threshold and target labels share a strip above the rows, stacked in lanes so that none touches another.
  interface Ann {
    x0: number;
    w: number;
    text: string;
    cls: string;
    lane: number;
  }
  const anns: Ann[] = [];
  const items = [
    ...bands.map((v) => ({ v, text: fmt(v), cls: 'rg-band-l' })),
    ...(target ? [{ v: target.v, text: target.label || fmt(target.v), cls: 'target-l' }] : []),
  ];
  for (const a of items.toSorted((p, q) => p.v - q.v)) {
    const text = truncateTo(a.text, W - 8, FONT);
    const w = textWidth(text, FONT, { bold: true }) * 1.04 * FS;
    const x0 = Math.min(Math.max(sx(a.v) - w / 2, 2), W - 2 - w);
    let lane = 0;
    while (anns.some((o) => o.lane === lane && x0 < o.x0 + o.w + 8 && o.x0 < x0 + w + 8)) lane++;
    anns.push({ x0, w, text, cls: a.cls, lane });
  }
  const lanes = anns.reduce((m, a) => Math.max(m, a.lane + 1), 0);
  const LANE = 16;
  const T = lanes ? 10 + lanes * LANE : 8;
  const rowH = narrow ? 40 : 30;
  const barH = narrow ? 12 : 14;
  const B = 24;
  const H = T + rowH * rows.length + B;
  const focusRow = c.focus ? rows.findIndex((r) => r.label === c.focus) : -1;
  const titleId = `${uid}-t`;
  const descId = `${uid}-d`;
  const out: string[] = [
    `<svg class="chart rg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="${titleId} ${descId}"><title id="${titleId}">${esc(label)}</title><desc id="${descId}">${esc(desc)}</desc>`,
  ];
  // Tick labels centre on their tick, but are pushed back inside the drawing at its edges.
  ticks.forEach((t, k) => {
    const x = sx(t);
    out.push(`<line class="grid" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T}" y2="${H - B}"/>`);
    const w = textWidth(tickLabels[k], FONT) * FS;
    const anchor = x - w / 2 < 1 ? 'start' : x + w / 2 > W - 1 ? 'end' : 'middle';
    const tx = anchor === 'start' ? 1 : anchor === 'end' ? W - 1 : x;
    out.push(`<text class="tick" x="${tx.toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${esc(tickLabels[k])}</text>`);
  });
  for (const v of bands) {
    const x = sx(v).toFixed(1);
    out.push(`<line class="rg-band" x1="${x}" x2="${x}" y1="${T - 4}" y2="${H - B}"/>`);
  }
  rows.forEach((r, k) => {
    const top = T + rowH * k;
    const by = narrow ? top + 18 : top + (rowH - barH) / 2;
    if (narrow) out.push(`<text class="cat" x="${L}" y="${top + 13}">${esc(truncate(r.label, W - L - 2))}</text>`);
    else
      out.push(
        `<text class="cat" x="${L - 8}" y="${(by + barH / 2 + 4).toFixed(1)}" text-anchor="end">${esc(truncate(r.label, labelW))}</text>`,
      );
    const x0 = Math.min(sx(r.a), W - R - 3);
    const w = Math.max(sx(r.b) - x0, 3);
    const cls = focusRow >= 0 && focusRow !== k ? 'cm' : 'c1';
    const tip = `${r.label}: ${axis.long(r.a)} to ${axis.long(r.b)}${r.at === null ? '' : `; ${c.at} ${axis.long(r.at)}`}`;
    out.push(
      `<rect class="rg-bar ${cls}" fill="currentColor" x="${x0.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${barH}" rx="3"><title>${esc(tip)}</title></rect>`,
    );
    if (r.at !== null)
      out.push(
        `<circle class="rg-at" cx="${sx(r.at).toFixed(1)}" cy="${(by + barH / 2).toFixed(1)}" r="${narrow ? 4.5 : 5}"><title>${esc(`${r.label} · ${c.at}: ${axis.long(r.at)}`)}</title></circle>`,
      );
  });
  if (target) {
    const x = sx(target.v).toFixed(1);
    out.push(`<line class="target" x1="${x}" x2="${x}" y1="${T - 4}" y2="${H - B}"/>`);
  }
  for (const a of anns) out.push(`<text class="${a.cls}" x="${a.x0.toFixed(1)}" y="${8 + a.lane * LANE + 12}">${esc(a.text)}</text>`);
  out.push('</svg>');
  return out.join('');
}
/* end stream v04-1 */
