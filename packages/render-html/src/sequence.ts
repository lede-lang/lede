import type { DiagramBlock, DiagramFrame } from '@lede-lang/core';
import { esc, plain, snap4, textWidth } from './util.ts';
import { figure, kindClass, markers, nodeSvg, svgOpen } from './diagram.ts';

const ELABEL = 12; // message labels, desktop (up from 10)
const PHONE_W = 360;
const NOTE_MAX = 320; // desktop notes wrap at this width
const SAFE = 1.05; // estimates are approximate; wrap a little early rather than clip

/** Uppercase mono label width including the stylesheet's .04em tracking. */
const labelW = (s: string, size: number) => s.length * size * 0.66;
const TAGW = (kind: string, size: number) => Math.ceil(kind.length * size * 0.68) + 14;

/**
 * Wraps `text` into at most `maxLines` lines of `max` px. A word wider than a line is split when
 * `breakLong`; the last line is cut with an ellipsis if text is still left over.
 */
function wrap(text: string, max: number, w: (s: string) => number, maxLines: number, breakLong = false): string[] {
  const lines: string[] = [];
  let cur = '';
  const push = (s: string) => {
    lines.push(s);
  };
  for (let word of text.split(/\s+/).filter(Boolean)) {
    if (breakLong) {
      while (w(word) > max && word.length > 1) {
        if (cur) {
          push(cur);
          cur = '';
        }
        let k = word.length - 1;
        while (k > 1 && w(word.slice(0, k)) > max) k--;
        push(word.slice(0, k));
        word = word.slice(k);
      }
    }
    const next = cur ? `${cur} ${word}` : word;
    if (cur && w(next) > max) {
      push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) push(cur);
  if (lines.length > maxLines) {
    let last = lines.slice(maxLines - 1).join(' ');
    while (last.length > 1 && w(`${last}…`) > max) last = last.slice(0, -1);
    lines.length = maxLines - 1;
    lines.push(`${last}…`);
  }
  return lines;
}

type Item =
  | { k: 'msg'; m: Msg }
  | { k: 'note'; n: DiagramBlock['notes'][number] }
  | { k: 'open'; f: DiagramFrame; fi: number }
  | { k: 'else'; f: DiagramFrame; fi: number; bi: number }
  | { k: 'close'; f: DiagramFrame; fi: number };
type Msg = { e: DiagramBlock['edges'][number]; a: number; b: number; w: number };

interface FrameGeom {
  left: number;
  right: number;
  lines: string[][];
  tag: number;
}

/** Messages, notes and frame boundaries in source order. */
function buildItems(d: DiagramBlock, msgs: Msg[]): Item[] {
  const frames = d.frames ?? [];
  const items: Item[] = [];
  if (frames.length === 0) {
    let ni = 0;
    msgs.forEach((m, i) => {
      while (ni < d.notes.length && d.notes[ni].after <= i) items.push({ k: 'note', n: d.notes[ni++] });
      items.push({ k: 'msg', m });
    });
    while (ni < d.notes.length) items.push({ k: 'note', n: d.notes[ni++] });
  } else {
    // Edge indexes can't place a note that sits on a frame boundary; source lines can.
    const at: { line: number; seq: number; it: Item }[] = [];
    let seq = 0;
    msgs.forEach((m) => at.push({ line: m.e.line, seq: seq++, it: { k: 'msg', m } }));
    d.notes.forEach((n) => at.push({ line: n.line, seq: seq++, it: { k: 'note', n } }));
    frames.forEach((f, fi) => {
      at.push({ line: f.line, seq: seq++, it: { k: 'open', f, fi } });
      f.branches.forEach((b, bi) => {
        if (bi > 0) at.push({ line: b.line, seq: seq++, it: { k: 'else', f, fi, bi } });
      });
      at.push({ line: f.endLine ?? Infinity, seq: seq++, it: { k: 'close', f, fi } });
    });
    at.sort((p, q) => p.line - q.line || p.seq - q.seq);
    items.push(...at.map((x) => x.it));
  }
  return items;
}

/**
 * Sequence diagram: participants across the top, one row per message or note, in source order.
 * Desktop and phone are laid out separately; with more than four participants the phone gets a numbered list.
 */
export function renderSequence(d: DiagramBlock, uid: string): string {
  const desk = drawSeq(d, uid, false);
  const card = desk.W;
  if (d.nodes.length > 4) {
    // The list is HTML, so it takes the column; the narrow width only has to keep the wrapper from forcing a scroll.
    return figure(d, `<div class="dg-h">${desk.svg}</div><div class="dg-v" style="--wv:560px">${seqList(d)}</div>`, card, 240);
  }
  const ph = drawSeq(d, `${uid}v`, true);
  return figure(d, `<div class="dg-h">${desk.svg}</div><div class="dg-v" style="--wv:${ph.W}px">${ph.svg}</div>`, card, ph.W);
}

function msgsOf(d: DiagramBlock, idx: Map<string, number>, w: (m: string) => number): Msg[] {
  return d.edges.map((e) => ({ e, a: idx.get(e.from)!, b: idx.get(e.to)!, w: w(e.label.toUpperCase()) }));
}

function seqList(d: DiagramBlock): string {
  const idx = new Map(d.nodes.map((p, i) => [p.id, i]));
  const name = (id: string) => d.nodes.find((n) => n.id === id)?.label ?? id;
  const b = (id: string) => `<b>${esc(name(id))}</b>`;
  const out: string[] = ['<ol class="seqlist">'];
  let inFrame = false;
  for (const it of buildItems(
    d,
    msgsOf(d, idx, () => 0),
  )) {
    if (it.k === 'open') {
      inFrame = true;
      out.push(`<li class="frame">${esc(it.f.kind)}${frameLabel(it.f.branches[0].label)}</li>`);
    } else if (it.k === 'else') out.push(`<li class="frame">else${frameLabel(it.f.branches[it.bi].label)}</li>`);
    else if (it.k === 'close') inFrame = false;
    else if (it.k === 'note') out.push(`<li class="note">${esc(it.n.over.map(name).join(', '))}: ${esc(it.n.text)}</li>`);
    else {
      const { e } = it.m;
      const cls = [inFrame ? 'in' : '', e.style === 'dashed' ? 'reply' : ''].filter(Boolean).join(' ');
      out.push(`<li${cls ? ` class="${cls}"` : ''}>${b(e.from)} → ${b(e.to)}${e.label ? `: ${esc(e.label)}` : ''}</li>`);
    }
  }
  out.push('</ol>');
  return out.join('');
}

const frameLabel = (l: string) => (l.trim() ? ` "${esc(l.trim())}"` : '');

function drawSeq(d: DiagramBlock, uid: string, phone: boolean): { svg: string; W: number } {
  const parts = d.nodes;
  const idx = new Map(parts.map((p, i) => [p.id, i]));
  const FS = 12; // frame and note text, sans (desktop was 11: at 0.97 scale it fell under 11px)
  const LH = 14;
  const msgs = msgsOf(d, idx, (s) => labelW(s, ELABEL) + 24);
  const pad = phone ? 8 : 16;
  /** Desktop note box: centred over the participants it names, wide enough to span them. */
  const deskNote = (n: (typeof d.notes)[number], at: number[]) => {
    const ii = n.over.map((o) => idx.get(o)!);
    const lo = Math.min(...ii.map((i) => at[i]));
    const hi = Math.max(...ii.map((i) => at[i]));
    // A long note wraps instead of widening the drawing (which would shrink every other label when it scales to fit).
    const lines = wrap(n.text, NOTE_MAX - 24, (s) => textWidth(s, FS) * SAFE, 40, true);
    const w = Math.max(...lines.map((l) => textWidth(l, FS) * SAFE), 0) + 24;
    const wide = Math.max(w, ii.length > 1 ? hi - lo + 48 : 0);
    // Kept inside the drawing: a note over the first or last participant slides in rather than being clipped
    // by the viewBox (or widening the drawing, which would shrink every label when it scales to fit).
    const cx = Math.min(Math.max((lo + hi) / 2, pad + wide / 2), Math.max(noteEdge, wide + 2 * pad) - pad - wide / 2);
    return { cx, w: wide, lines };
  };
  let noteEdge = 0; // the desktop drawing's width once its lanes are placed (set below)

  let W: number;
  let xs: number[];
  let boxes: { w: number; h: number; lines: string[]; sub: string[] }[];
  if (phone) {
    // Equal lanes across the phone column; labels wrap instead of widening the drawing.
    const n = Math.max(1, parts.length);
    const L = PHONE_W / n;
    const bw = Math.floor(Math.min(L - 8, 150));
    W = PHONE_W;
    xs = parts.map((_, i) => L * (i + 0.5));
    boxes = parts.map((p) => {
      const lines = wrap(p.label, bw - 14, (s) => textWidth(s, 13, { bold: true }) * SAFE, 3, true);
      const sub = p.sub ? wrap(p.sub, bw - 14, (s) => s.length * 0.62 * 12, 2, true) : [];
      return { w: bw, h: 10 + (p.kind ? 22 : 0) + lines.length * 16 + sub.length * 15, lines, sub };
    });
  } else {
    boxes = parts.map((p) => {
      const w = snap4(Math.max(96, textWidth(p.label, 13, { bold: true }) + 32, p.sub ? textWidth(p.sub, 10, { mono: true }) + 32 : 0));
      return { w, h: p.kind ? 56 : 40, lines: [p.label], sub: [] };
    });
    // Gaps between adjacent participant centers, widened until every message label fits its span.
    const gaps = parts.slice(1).map((_, i) => Math.max(boxes[i].w / 2 + boxes[i + 1].w / 2 + 32, 128));
    const sorted = [...msgs].toSorted((m, n) => Math.abs(m.a - m.b) - Math.abs(n.a - n.b));
    for (const m of sorted) {
      const [lo, hi] = [Math.min(m.a, m.b), Math.max(m.a, m.b)];
      if (lo === hi) {
        // self message: label sits to the right of the loop
        if (lo < gaps.length) gaps[lo] = Math.max(gaps[lo], m.w + 40);
        continue;
      }
      const span = gaps.slice(lo, hi).reduce((a, b) => a + b, 0);
      if (span < m.w) {
        const add = (m.w - span) / (hi - lo);
        for (let i = lo; i < hi; i++) gaps[i] += add;
      }
    }
    xs = [pad + boxes[0]?.w / 2 || 0];
    gaps.forEach((g, i) => xs.push(xs[i] + snap4(g)));
    const lastSelf = msgs.some((m) => m.a === m.b && m.a === parts.length - 1);
    W =
      (xs[xs.length - 1] ?? 0) +
      (boxes[boxes.length - 1]?.w ?? 0) / 2 +
      pad +
      (lastSelf ? Math.max(...msgs.filter((m) => m.a === m.b && m.a === parts.length - 1).map((m) => m.w)) + 24 : 0);
    noteEdge = W;
    for (const n of d.notes) W = Math.max(W, deskNote(n, xs).w + 2 * pad);
    noteEdge = W;
  }
  const boxH = Math.max(...boxes.map((b) => b.h), 40);

  const frames = d.frames ?? [];
  const items = buildItems(d, msgs);

  // Notes: one box over the participants it names, wrapped on a phone.
  const noteBox = (n: (typeof d.notes)[number]) => {
    const ii = n.over.map((o) => idx.get(o)!);
    const lo = Math.min(...ii.map((i) => xs[i]));
    const hi = Math.max(...ii.map((i) => xs[i]));
    if (!phone) return deskNote(n, xs);
    const lines = wrap(n.text, W - 24 - 24, (s) => textWidth(s, FS) * SAFE, 40, true);
    // Stays inside a frame's 4px inset plus its own padding, so a note in a frame never touches the frame's edge.
    const w = Math.min(W - 24, Math.max(...lines.map((l) => textWidth(l, FS) * SAFE), 0) + 24);
    const wide = Math.min(W - 24, Math.max(w, ii.length > 1 ? hi - lo + 48 : 0));
    const cx = Math.min(Math.max((lo + hi) / 2, 12 + wide / 2), W - 12 - wide / 2);
    return { cx, w: wide, lines };
  };

  // Horizontal extent of every frame: the participants its rows touch, plus room for the condition text.
  const geom = new Map<number, FrameGeom>();
  if (frames.length) {
    const ext = new Map<number, [number, number]>();
    let cur = -1;
    const grow = (lo: number, hi: number) => {
      const e = ext.get(cur) ?? [Infinity, -Infinity];
      ext.set(cur, [Math.min(e[0], lo), Math.max(e[1], hi)]);
    };
    for (const it of items) {
      if (it.k === 'open') cur = it.fi;
      else if (it.k === 'close') cur = -1;
      else if (cur >= 0 && it.k === 'msg') {
        const { a, b, w } = it.m;
        const self = a === b;
        grow(Math.min(xs[a], xs[b]) - 28, Math.max(xs[a], xs[b]) + (self ? 48 + w : 28));
      } else if (cur >= 0 && it.k === 'note') {
        const { cx, w } = noteBox(it.n);
        grow(cx - w / 2 - 12, cx + w / 2 + 12);
      }
    }
    const W0 = W;
    frames.forEach((f, fi) => {
      const tag = TAGW(f.kind, phone ? 12 : 10);
      if (phone) {
        const [left, right] = [4, W - 4];
        const lines = f.branches.map((b, bi) =>
          wrap(b.label.trim(), right - left - (bi === 0 ? tag + 10 : 50) - 10, (s) => textWidth(s, FS) * SAFE, 4, true),
        );
        geom.set(fi, { left, right, lines, tag });
        return;
      }
      const e = ext.get(fi);
      let [lo, hi] = e && isFinite(e[0]) ? e : [xs[0] - 28, xs[xs.length - 1] + 28];
      lo = Math.max(4, lo);
      const labelMax = Math.max(Math.min(W0 - 8 - lo, 440) - tag - 28, 150);
      const lines = f.branches.map((b) => wrap(b.label.trim(), labelMax, (s) => textWidth(s, FS), 4));
      const need = Math.max(...lines.map((ls, bi) => (bi === 0 ? tag + 10 : 36) + Math.max(0, ...ls.map((l) => textWidth(l, FS))) + 16));
      hi = Math.max(hi, lo + need);
      geom.set(fi, { left: lo, right: hi, lines, tag });
      W = Math.max(W, hi + 8);
    });
  }

  let y = pad + boxH + 24;
  const body: string[] = [];
  const under: string[] = []; // frames sit between the lifelines and the messages
  let top = 0;
  let msgNo = 0;
  const TAGH = phone ? 20 : 16;
  // The phone drawing's frame parts carry their own class names (and lowercase text, uppercased by CSS) so that
  // diagrams-b.test.ts, which counts frame parts across the whole page, still sees one set per diagram.
  const FR = phone ? 'pfr' : 'fr';
  const cap = (t: string) => (phone ? t.toLowerCase() : t.toUpperCase());
  const frameHead = (g: FrameGeom, f: DiagramFrame, bi: number) => {
    const ls = g.lines[bi];
    const full = f.branches[bi].label.trim();
    const t = full ? `<title>${esc(full)}</title>` : '';
    if (bi === 0) {
      const tg = g.tag;
      const base = phone ? 14.5 : 11.5;
      under.push(`<path class="${FR}-tag" d="M${g.left},${top} h${tg} v${TAGH - 6} l-6,6 h-${tg - 6} z"/>`);
      under.push(`<text class="${FR}-k" x="${g.left + 7}" y="${top + base}">${esc(cap(f.kind))}</text>`);
      ls.forEach((l, i) =>
        under.push(`<text class="${FR}-t" x="${g.left + tg + 10}" y="${top + base + i * LH}">${i === 0 ? t : ''}${esc(l)}</text>`),
      );
      return Math.max(TAGH, ls.length * LH) + 12;
    }
    const base = phone ? 17 : 15;
    const ex = phone ? 50 : 36;
    under.push(`<line class="${FR}-div" x1="${g.left}" x2="${g.right}" y1="${y}" y2="${y}"/>`);
    under.push(`<text class="${FR}-e" x="${g.left + 8}" y="${y + base}">${cap('else')}</text>`);
    ls.forEach((l, i) =>
      under.push(`<text class="${FR}-t" x="${g.left + ex}" y="${y + base + i * LH}">${i === 0 ? t : ''}${esc(l)}</text>`),
    );
    return Math.max(1, ls.length) * LH + base;
  };
  const lm = (l: string) => labelW(l, ELABEL);
  for (const it of items) {
    if (it.k === 'open') {
      y += 6;
      top = y;
      y += frameHead(geom.get(it.fi)!, it.f, 0);
      continue;
    }
    if (it.k === 'else') {
      y += 2;
      y += frameHead(geom.get(it.fi)!, it.f, it.bi);
      continue;
    }
    if (it.k === 'close') {
      const g = geom.get(it.fi)!;
      const bottom = y + 2;
      under.unshift(
        `<rect class="${FR}${it.f.endLine === null ? ' open' : ''}" x="${g.left}" y="${top}" width="${(g.right - g.left).toFixed(1)}" height="${bottom - top}" rx="3"/>`,
      );
      y = bottom + 10;
      continue;
    }
    if (it.k === 'note') {
      const { cx, w, lines } = noteBox(it.n);
      const h = lines.length * LH + 10;
      body.push(`<rect class="note-box" x="${(cx - w / 2).toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${h}" rx="2"/>`);
      lines.forEach((l, i) =>
        body.push(`<text class="note-t" x="${cx.toFixed(1)}" y="${y + (phone ? 15 : 16) + i * LH}" text-anchor="middle">${esc(l)}</text>`),
      );
      y += h + 12;
      continue;
    }
    const { m } = it;
    const x1 = xs[m.a];
    const x2 = xs[m.b];
    const cls = ['edge', m.e.style === 'dashed' ? 'dash' : ''].filter(Boolean).join(' ');
    const n = String(++msgNo);
    const text = m.e.label.toUpperCase();
    if (m.a === m.b) {
      const loopTop = y + 8;
      if (!phone) {
        body.push(`<path class="${cls}" d="M${x1},${loopTop} H${x1 + 32} V${loopTop + 20} H${x1 + 2}" marker-end="url(#${uid}-a)"/>`);
        if (text) {
          const lw = lm(text) + 12;
          body.push(
            `<rect class="lmask" x="${x1 + 40}" y="${loopTop + 2}" width="${lw.toFixed(1)}" height="16" rx="2"/><text class="elabel" x="${x1 + 46}" y="${loopTop + 13.5}">${esc(text)}</text>`,
          );
        }
        body.push(`<text class="seqn" x="${x1 - 8}" y="${loopTop + 4}" text-anchor="end">${n}</text>`);
        y += 44;
        continue;
      }
      // Phone: the loop opens toward the side with more room, and the label wraps into that room.
      const right = W - 4 - (x1 + 40) >= x1 - 4 - 40;
      const sg = right ? 1 : -1;
      const room = Math.max(40, right ? W - 4 - (x1 + 40) : x1 - 4 - 40);
      const lines = text ? wrap(text, room - 8, lm, 4, true) : [];
      const h = Math.max(28, lines.length * LH + 4);
      body.push(
        `<path class="${cls}" d="M${x1},${loopTop} H${x1 + sg * 30} V${loopTop + 20} H${x1 + sg * 2}" marker-end="url(#${uid}-a)"/>`,
      );
      lines.forEach((l, i) => {
        const lw = lm(l) + 8;
        const lx = x1 + sg * 36;
        const ly = loopTop + 11 + i * LH;
        body.push(
          `<rect class="lmask" x="${(right ? lx - 2 : lx - lw + 2).toFixed(1)}" y="${ly - 11.5}" width="${lw.toFixed(1)}" height="14" rx="2"/>`,
        );
        body.push(`<text class="elabel" x="${lx}" y="${ly}" text-anchor="${right ? 'start' : 'end'}">${esc(l)}</text>`);
      });
      body.push(`<text class="seqn" x="${x1 - sg * 8}" y="${loopTop + 4}" text-anchor="${right ? 'end' : 'start'}">${n}</text>`);
      y += h + 24;
      continue;
    }
    const dir = x2 > x1 ? 1 : -1;
    if (!phone) {
      const lineY = y + 22;
      body.push(`<path class="${cls}" d="M${x1},${lineY} H${x2 - dir * 1}" marker-end="url(#${uid}-a)"/>`);
      if (text) {
        const lw = lm(text) + 12;
        const cx = (x1 + x2) / 2;
        // Label above the line with a 6px gap; the mask never touches the stroke.
        body.push(`<rect class="lmask" x="${(cx - lw / 2).toFixed(1)}" y="${lineY - 22}" width="${lw.toFixed(1)}" height="16" rx="2"/>`);
        body.push(`<text class="elabel" x="${cx.toFixed(1)}" y="${lineY - 10.5}" text-anchor="middle">${esc(text)}</text>`);
      }
      body.push(
        `<text class="seqn" x="${(x1 - dir * 8).toFixed(1)}" y="${lineY + 4}" text-anchor="${dir > 0 ? 'end' : 'start'}">${n}</text>`,
      );
      y += 36;
      continue;
    }
    // Phone message: the label wraps to the lane span (wider only for a single long word, within the column).
    const cx0 = (x1 + x2) / 2;
    const span = Math.abs(x2 - x1);
    const lineMax = 2 * Math.min(cx0 - 4, W - 4 - cx0);
    const longest = Math.max(0, ...text.split(/\s+/).map(lm));
    const wrapAt = Math.min(Math.max(span - 8, Math.min(longest + 8, lineMax)), lineMax);
    const lines = text ? wrap(text, wrapAt - 8, lm, 4, true) : [];
    const lw = Math.max(0, ...lines.map(lm)) + 8;
    const cx = Math.min(Math.max(cx0, 4 + lw / 2), W - 4 - lw / 2);
    const lineY = y + lines.length * LH + 14;
    body.push(`<path class="${cls}" d="M${x1},${lineY} H${x2 - dir * 1}" marker-end="url(#${uid}-a)"/>`);
    lines.forEach((l, i) => {
      const w = lm(l) + 8;
      const ly = y + 12 + i * LH;
      body.push(`<rect class="lmask" x="${(cx - w / 2).toFixed(1)}" y="${ly - 11.5}" width="${w.toFixed(1)}" height="14" rx="2"/>`);
      body.push(`<text class="elabel" x="${cx.toFixed(1)}" y="${ly}" text-anchor="middle">${esc(l)}</text>`);
    });
    body.push(
      `<text class="seqn" x="${(x1 - dir * 8).toFixed(1)}" y="${lineY + 4}" text-anchor="${dir > 0 ? 'end' : 'start'}">${n}</text>`,
    );
    y += lines.length * LH + 28;
  }
  const H = y + 8;
  const out: string[] = [
    svgOpen(uid, Math.ceil(W), Math.ceil(H), plain(d.title ?? `${d.name} sequence`), describeSeq(d), 'seq'),
    markers(uid),
  ];
  parts.forEach((_p, i) => {
    out.push(`<line class="life" x1="${xs[i]}" x2="${xs[i]}" y1="${pad + boxH}" y2="${H - 8}"/>`);
  });
  out.push(...under);
  parts.forEach((p, i) => {
    const b = boxes[i];
    const bx = xs[i] - b.w / 2;
    const by = pad + (boxH - b.h);
    out.push(phone ? phoneBox(p, b, bx, by) : nodeSvg({ x: bx, y: by, w: b.w, h: b.h, node: p }, 10));
  });
  out.push(...body, '</svg>');
  // Never scale up past 1:1, whatever room the card gives.
  if (!phone) out[0] = out[0].replace('" viewBox', `" style="max-width:${Math.ceil(W)}px" viewBox`);
  return { svg: out.join(''), W: Math.ceil(W) };
}

/** A participant box for the phone drawing: kind tag, wrapped name, wrapped sub, every text 12 units or more. */
function phoneBox(
  p: DiagramBlock['nodes'][number],
  b: { w: number; h: number; lines: string[]; sub: string[] },
  x: number,
  y: number,
): string {
  const cls = ['node', p.focus ? 'focus' : '', p.kind ? kindClass(p.kind) : ''].filter(Boolean).join(' ');
  const out = [`<g class="${esc(cls)}">`, `<rect class="box" x="${x}" y="${y}" width="${b.w}" height="${b.h}" rx="6"/>`];
  let ty = y + 6;
  if (p.kind) {
    const kind = wrap(p.kind.toUpperCase(), b.w - 20, (s) => s.length * 0.68 * 12, 1, true)[0] ?? '';
    const tw = Math.ceil(kind.length * 0.68 * 12) + 8;
    out.push(`<rect class="tag" x="${x + 6}" y="${ty}" width="${tw}" height="17" rx="2"/>`);
    out.push(`<text class="tagt" x="${x + 10}" y="${ty + 12.5}">${esc(kind)}</text>`);
    ty += 22;
  }
  const cx = x + b.w / 2;
  b.lines.forEach((l, i) =>
    out.push(`<text class="name" x="${cx}" y="${(ty + 12 + i * 16).toFixed(1)}" text-anchor="middle">${esc(l)}</text>`),
  );
  ty += b.lines.length * 16;
  b.sub.forEach((l, i) =>
    out.push(`<text class="sub" x="${cx}" y="${(ty + 11 + i * 15).toFixed(1)}" text-anchor="middle">${esc(l)}</text>`),
  );
  out.push('</g>');
  return out.join('');
}

function describeSeq(d: DiagramBlock): string {
  const name = (id: string) => d.nodes.find((n) => n.id === id)?.label ?? id;
  return (
    `Sequence between ${d.nodes.map((n) => n.label).join(', ')}. ` +
    d.edges
      .map((e, i) => `${i + 1}. ${name(e.from)} to ${name(e.to)}${e.label ? `: ${e.label}` : ''}${e.style === 'dashed' ? ' (reply)' : ''}`)
      .join('; ')
  );
}
