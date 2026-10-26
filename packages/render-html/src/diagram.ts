import type { DiagramBlock, DiagramEdge, DiagramNode } from '@lede-lang/core';
// elkjs ships a bundled build with no worker; it runs the same in Node and the browser.
import ELK from 'elkjs/lib/elk.bundled.js';
import { esc, inline, plain, snap4, textWidth } from './util.ts';

const NAME = 13; // node name, sans 600

/**
 * Text sizes and the boxes they sit in. Phone (compact) drawings render at up to ~0.92x on a 400px screen,
 * so their text is 12 units to stay at
 * 11px or more after the scale.
 */
interface Metrics {
  SUB: number;
  TAG: number;
  ELABEL: number;
  GLABEL: number;
  tagH: number;
  subH: number;
  elH: number;
  /** Widest a node name line may get before it wraps, and how many lines it may take. */
  nameMax: number;
  nameLines: number;
  /** Widest a sublabel or an edge label line may get before it wraps (Infinity: one line). */
  subMax: number;
  elMax: number;
  /** Most lines a decision label may take, and a diamond's width over its height. */
  decLines: number;
  K: number;
  /** ELK spacing between nodes in a layer, and between an edge and a node. */
  nodeNode: number;
  edgeNode: number;
  /** Widest a group label line may get before it wraps (Infinity: one line). */
  glMax: number;
}
const DESK: Metrics = {
  SUB: 10,
  TAG: 9,
  ELABEL: 10,
  GLABEL: 10,
  tagH: 13,
  subH: 14,
  elH: 16,
  nameMax: 210,
  nameLines: 3,
  subMax: Infinity,
  elMax: Infinity,
  decLines: 3,
  K: 1.75,
  nodeNode: 32,
  edgeNode: 20,
  glMax: Infinity,
};
const PHONE: Metrics = {
  SUB: 12,
  TAG: 12,
  ELABEL: 12,
  GLABEL: 12,
  tagH: 16,
  subH: 16,
  elH: 18,
  nameMax: 150,
  nameLines: 3,
  subMax: Infinity,
  elMax: Infinity,
  decLines: 3,
  K: 1.5,
  nodeNode: 14,
  edgeNode: 10,
  glMax: Infinity,
};
/**
 * Phones, when the PHONE drawing is too wide to keep 12-unit text at 11px or more in a 350px figure: tier 1
 * wraps node names, sublabels and edge labels narrower and lets decisions take up to five lines in a taller
 * diamond, and wraps long group labels onto a second line; tier 2 wraps narrower still. Text sizes never change, only line lengths and spacing.
 */
const TIERS: Metrics[] = [
  PHONE,
  { ...PHONE, nameMax: 104, nameLines: 4, subMax: 104, elMax: 84, decLines: 5, K: 1.3, nodeNode: 10, edgeNode: 8, glMax: 112 },
  { ...PHONE, nameMax: 80, nameLines: 5, subMax: 84, elMax: 64, decLines: 6, K: 1.2, nodeNode: 10, edgeNode: 8, glMax: 88 },
];
const metrics = (compact: boolean, tier = 0): Metrics => (compact ? TIERS[tier] : DESK);
const EL_LINE = 14; // extra height per wrapped edge label line (and group label line)

/** A group's label in caps, wrapped to the tier's group label width (measured at the rendered 0.66em). */
function groupLines(label: string, m: Metrics): string[] {
  const t = label.toUpperCase();
  return Number.isFinite(m.glMax) ? monoLines(t, m.GLABEL, (m.glMax * 0.62) / 0.66) : [t];
}

interface ElkLabel {
  text: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
}
interface ElkPort {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layoutOptions: Record<string, string>;
}
interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string>;
  labels?: ElkLabel[];
  ports?: ElkPort[];
}
interface ElkSection {
  startPoint: P;
  endPoint: P;
  bendPoints?: P[];
}
interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  labels?: ElkLabel[];
  sections?: ElkSection[];
  container?: string;
}
interface P {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Placed {
  nodes: (Box & { node: DiagramNode; lines?: string[]; subs?: string[] })[];
  /** `lines` is a phone tier's group label wrapped onto two lines or more (absent: one line). */
  groups: (Box & { id: string; label: string; depth: number; lines?: string[] })[];
  /** `label.lines` is the label wrapped for drawing (absent: one line, `text`). */
  edges: { edge: DiagramEdge; points: P[]; label: (Box & { text: string; lines?: string[] }) | null }[];
  width: number;
  height: number;
}

// elkjs is CommonJS; under NodeNext its typings miss the default-export constructor.
const elk = new (ELK as unknown as new () => { layout(g: unknown): Promise<unknown> })();

// ---- decision diamonds (stream-b) ----------------------------------------------------------
const LINE = 16; // decision label line height

export const isDecision = (n: DiagramNode): boolean => n.kind === 'decision' || n.kind === 'choice';

/** Greedy wrap of `label` to lines no wider than `max` (a single long word keeps its own line). */
function wrapTo(label: string, max: number, size = NAME, opts: { mono?: boolean; bold?: boolean } = { bold: true }): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(next, size, opts) > max) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** Mono text (sublabels, edge labels) wrapped to `max` units on at most three lines; Infinity keeps one line. */
function monoLines(s: string, size: number, max: number): string[] {
  if (!Number.isFinite(max) || textWidth(s, size, { mono: true }) <= max) return [s];
  let w = max;
  let lines = wrapTo(s, w, size, { mono: true });
  while (lines.length > 3) {
    w += 12;
    lines = wrapTo(s, w, size, { mono: true });
  }
  return lines;
}

/**
 * A diamond is wider than the text it holds: a text box tw x th fits when tw/W + th/H <= 1.
 * Pick the line count (1 to 3, more in the phone tiers) with the smallest diamond, with a bias to fewer lines.
 * Phone tiers above 0 pick the narrowest diamond instead, since width is what they are short of.
 */
export function decisionGeom(n: DiagramNode, compact = false, tier = 0): { w: number; h: number; lines: string[] } {
  const m = metrics(compact, tier);
  const K = m.K; // W / H
  const maxLines = m.decLines;
  const subH = n.sub ? m.subH : 0;
  const subW = n.sub ? textWidth(n.sub, m.SUB, { mono: true }) : 0;
  const total = textWidth(n.label, NAME, { bold: true });
  const longest = Math.max(0, ...n.label.split(/\s+/).map((w) => textWidth(w, NAME, { bold: true })));
  let best: { w: number; h: number; lines: string[]; area: number } | null = null;
  for (let k = 1; k <= maxLines; k++) {
    let lines = wrapTo(n.label, Math.max(longest, (total / k) * 1.12));
    // Greedy wrap can overshoot k lines on unlucky word lengths; widen until it fits.
    for (let w = (total / k) * 1.12; lines.length > k && w < total; w += 8) lines = wrapTo(n.label, w);
    if (lines.length > k && k < maxLines) continue;
    const tw = Math.max(subW, ...lines.map((l) => textWidth(l, NAME, { bold: true }))) + 14;
    const th = lines.length * LINE + subH + 8;
    const h = snap4(Math.max(56, tw / K + th));
    const w = snap4(Math.max(compact ? 92 : 104, h * K, tw + th * K));
    const area = compact && tier > 0 ? w * (1 + 0.02 * (lines.length - 1)) : w * h * (1 + 0.22 * (lines.length - 1));
    if (!best || area < best.area) best = { w, h, lines, area };
  }
  const b = best!;
  return { w: b.w, h: b.h, lines: b.lines };
}

type Side = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';
const YES = /^(yes|y|true|ok|pass(ed)?|approved?|valid|success|accept(ed)?|found|done)\b/i;
const NO = /^(no|n|false|fail(ed)?|reject(ed)?|denied|invalid|error|not)\b/i;
const sideOf = (s: Side, w: number, h: number): P =>
  ({ NORTH: { x: w / 2, y: 0 }, SOUTH: { x: w / 2, y: h }, EAST: { x: w, y: h / 2 }, WEST: { x: 0, y: h / 2 } })[s];

/**
 * Second pass: once nodes have positions, send each answer out the point that faces its target, so the
 * edges leave a diamond without crossing. Targets roughly straight ahead take the forward point.
 */
function geometric(
  p: Placed,
  dir: DiagramBlock['dir'],
  id: string,
  targets: string[],
  sources: string[],
): { outs: Side[]; ins: (Side[] | null)[] } | null {
  const box = (x: string): Box | undefined => p.nodes.find((n) => n.node.id === x) ?? p.groups.find((g) => g.id === x);
  const me = box(id);
  if (!me) return null;
  const [fwd, sides] = (
    {
      LR: ['EAST', ['SOUTH', 'NORTH']],
      RL: ['WEST', ['SOUTH', 'NORTH']],
      TB: ['SOUTH', ['EAST', 'WEST']],
      BT: ['NORTH', ['EAST', 'WEST']],
    } as const
  )[dir] as unknown as [Side, Side[]];
  const horizontal = dir === 'LR' || dir === 'RL';
  const sign = dir === 'RL' || dir === 'BT' ? -1 : 1;
  const rel = (t: string) => {
    const b = box(t);
    if (!b) return null;
    const dx = b.x + b.w / 2 - (me.x + me.w / 2);
    const dy = b.y + b.h / 2 - (me.y + me.h / 2);
    return horizontal ? { f: dx * sign, c: dy } : { f: dy * sign, c: dx };
  };
  const rs = targets.map(rel);
  if (rs.some((r) => !r)) return null;
  const r = rs as { f: number; c: number }[];
  const sideOfC = (c: number): Side => (c > 0 ? sides[0] : sides[1]);
  const pick: Side[] = r.map((v) => (Math.abs(v.c) <= 16 && v.f > 0 ? fwd : sideOfC(v.c)));
  // Several answers on the forward point: the first keeps it, the rest take the side they lean to.
  const onFwd = pick.map((x, i) => (x === fwd ? i : -1)).filter((i) => i >= 0);
  onFwd.slice(1).forEach((i) => {
    pick[i] = r[i].c >= 0 ? sides[0] : sides[1];
  });
  // Two answers on one side while the forward point is free: the one nearer the axis that is ahead goes straight.
  if (!pick.includes(fwd)) {
    for (const s of sides) {
      const on = pick.map((x, i) => (x === s && r[i].f > 0 ? i : -1)).filter((i) => i >= 0);
      if (on.length > 1 && pick.filter((x) => x === s).length > 1) {
        pick[on.reduce((a, b) => (Math.abs(r[a].c) <= Math.abs(r[b].c) ? a : b))] = fwd;
        break;
      }
    }
  }
  // A loop back into the diamond (its source lies ahead of it) may use a side no answer leaves by.
  const ins = sources.map((src) => {
    const v = rel(src);
    if (!v || v.f <= 0) return null;
    const first = sideOfC(v.c === 0 ? -1 : v.c);
    return [first, sides.find((x) => x !== first)!];
  });
  return { outs: pick, ins };
}

/** Which point of a diamond each edge attaches to: in at the back, "yes" straight on, "no" out a side. */
function decisionPorts(d: DiagramBlock, dir: DiagramBlock['dir'], ids: Set<string>, prior?: Placed, zig = false): Map<string, Side> {
  const [entry, fwd, ahead] = {
    LR: ['WEST', 'EAST', ['SOUTH', 'NORTH']],
    RL: ['EAST', 'WEST', ['SOUTH', 'NORTH']],
    TB: ['NORTH', 'SOUTH', ['EAST', 'WEST']],
    BT: ['SOUTH', 'NORTH', ['EAST', 'WEST']],
  }[dir] as [Side, Side, Side[]];
  const out = new Map<string, Side>(); // `${edgeIndex}:${end}` -> side
  for (const id of ids) {
    // Zigzag (narrow phone tiers): a decision reached by a side answer of another decision sends its own side
    // answer back the other way, toward the trunk, so a chain of "no" answers does not staircase off to one side.
    const side =
      zig &&
      d.edges.some(
        (e) => e.to === id && ids.has(e.from) && !YES.test(e.label.trim()) && d.edges.filter((x) => x.from === e.from).length > 1,
      );
    const sides = side ? [ahead[1], ahead[0]] : ahead;
    const outs: number[] = [];
    d.edges.forEach((e, i) => {
      if (e.to === id) out.set(`${i}:t`, entry);
      if (e.from === id) outs.push(i);
    });
    const slots: Side[] = [fwd, sides[0], sides[1]];
    const used = new Set<Side>();
    const ins = d.edges.map((e, i) => (e.to === id && e.from !== id ? i : -1)).filter((i) => i >= 0);
    const geo =
      prior && (outs.length >= 2 || ins.length > 0)
        ? geometric(
            prior,
            dir,
            id,
            outs.map((i) => d.edges[i].to),
            ins.map((i) => d.edges[i].from),
          )
        : null;
    const give = (i: number, s: Side) => {
      out.set(`${i}:s`, s);
      used.add(s);
    };
    if (geo && outs.length >= 2) {
      outs.forEach((i, k) => give(i, geo.outs[k]));
    } else {
      for (const i of outs) {
        const l = d.edges[i].label.trim();
        if (YES.test(l) && !used.has(fwd)) give(i, fwd);
        else if (NO.test(l) && !used.has(sides[0])) give(i, sides[0]);
      }
      for (const i of outs) {
        if (out.has(`${i}:s`)) continue;
        give(i, slots.find((s) => !used.has(s)) ?? fwd);
      }
    }
    // Loop-backs take a free side, or share the entry point (arrows merging into one point read fine).
    if (geo)
      ins.forEach((i, k) => {
        const pick = geo.ins[k]?.find((x) => !used.has(x));
        if (pick) out.set(`${i}:t`, pick);
      });
  }
  return out;
}

/** A long node name wraps to at most 3 lines (more in the phone tiers) instead of stretching the box (210px, 150px on phones, less in the tiers). */
function nameLines(label: string, m: Metrics): string[] {
  let max = m.nameMax;
  let lines = wrapTo(label, max);
  while (lines.length > m.nameLines) {
    max += 20;
    lines = wrapTo(label, max);
  }
  return lines;
}

/** The lines a node's name and sublabel take at a given size. */
function nodeText(n: DiagramNode, compact: boolean, tier: number): { lines: string[]; subs: string[] } {
  const m = metrics(compact, tier);
  if (isDecision(n)) return { lines: decisionGeom(n, compact, tier).lines, subs: n.sub ? [n.sub] : [] };
  return { lines: nameLines(n.label, m), subs: n.sub ? monoLines(n.sub, m.SUB, m.subMax) : [] };
}

function nodeSize(n: DiagramNode, compact = false, tier = 0): { w: number; h: number } {
  if (isDecision(n)) {
    const g = decisionGeom(n, compact, tier);
    return { w: g.w, h: g.h };
  }
  const m = metrics(compact, tier);
  const { lines, subs } = nodeText(n, compact, tier);
  const nameW = Math.max(...lines.map((l) => textWidth(l, NAME, { bold: true })));
  const subW = Math.max(0, ...subs.map((s) => textWidth(s, m.SUB, { mono: true })));
  const tagW = n.kind ? textWidth(n.kind.toUpperCase(), m.TAG, { mono: true }) + 12 : 0;
  const w = snap4(Math.max(compact ? 84 : 96, nameW + (compact ? 24 : 32), subW + (compact ? 24 : 32), tagW + 24));
  const h = 28 + (lines.length - 1) * LINE + (n.kind ? m.tagH + 3 : 0) + subs.length * m.subH;
  return { w, h: snap4(Math.max(40, h)) };
}

function edgeLabelText(e: DiagramEdge): string {
  return e.label.toUpperCase();
}

/**
 * Lays out a flow diagram with ELK's layered algorithm and returns absolute geometry. `tier` (phones only,
 * 0 to 2) wraps names, sublabels and edge labels narrower, for drawings the PHONE sizes leave too wide.
 */
export async function layoutFlow(d: DiagramBlock, compact = false, tier = 0): Promise<Placed> {
  tier = compact ? Math.max(0, Math.min(TIERS.length - 1, tier)) : 0;
  const first = await layoutOnce(d, compact, undefined, tier);
  // Decisions with two or more answers get a second pass that aims each answer at its target.
  const multi = d.nodes.some(
    (n) => isDecision(n) && d.edges.some((e) => e.from === n.id) && d.edges.filter((e) => e.from === n.id || e.to === n.id).length >= 3,
  );
  const p = multi ? await layoutOnce(d, compact, first, tier) : first;
  if (compact) {
    hugGroups(d, p);
    fitGroupLabels(d, p);
  }
  clearLabels(p);
  return p;
}

/** Each node and group gets one parent: the first group that lists it. */
function parentsOf(d: DiagramBlock): Map<string, string> {
  const parent = new Map<string, string>();
  for (const g of d.groups) for (const m of g.members) if (!parent.has(m) && m !== g.id) parent.set(m, g.id);
  // Break any containment cycle (reported by the parser) by dropping the back edge.
  for (const g of d.groups) {
    const seen = new Set<string>();
    let cur: string | undefined = g.id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      cur = parent.get(cur);
    }
    if (cur) parent.delete(cur);
  }
  return parent;
}

async function layoutOnce(d: DiagramBlock, compact: boolean, prior?: Placed, tier = 0): Promise<Placed> {
  const groupIds = new Set(d.groups.map((g) => g.id));
  const parent = parentsOf(d);
  const direction = { LR: 'RIGHT', TB: 'DOWN', RL: 'LEFT', BT: 'UP' }[d.dir];
  const m = metrics(compact, tier);
  const elkNodes = new Map<string, ElkNode>();
  const root: ElkNode = {
    id: '__root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': String(m.nodeNode),
      'elk.layered.spacing.nodeNodeBetweenLayers': compact ? '28' : '48',
      'elk.spacing.edgeNode': String(m.edgeNode),
      'elk.spacing.edgeEdge': compact ? '10' : '16',
      'elk.layered.spacing.edgeNodeBetweenLayers': compact ? '10' : '20',
      'elk.layered.spacing.edgeEdgeBetweenLayers': compact ? '8' : '12',
      'elk.spacing.edgeLabel': '8',
      'elk.edgeLabels.inline': 'false',
      'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.semiInteractive': 'false',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.padding': '[top=4,left=4,bottom=4,right=4]',
    },
    children: [],
    edges: [],
  };
  elkNodes.set(root.id, root);
  for (const g of d.groups) {
    elkNodes.set(g.id, {
      id: g.id,
      children: [],
      edges: [],
      // Phones: a 22px label band and 8px sides, so nested groups (account > VPC > subnet) do not eat the width.
      // ELK sets a group that holds groups 5 units further down than its padding says; take that off the band.
      layoutOptions: {
        'elk.padding': compact
          ? `[top=${(g.members.some((x) => groupIds.has(x)) ? 17 : 22) + (groupLines(g.label, m).length - 1) * EL_LINE},left=8,bottom=8,right=8]`
          : '[top=36,left=16,bottom=16,right=16]',
        'elk.direction': direction,
      },
    });
  }
  for (const n of d.nodes) {
    if (groupIds.has(n.id)) continue;
    const { w, h } = nodeSize(n, compact, tier);
    const en: ElkNode = { id: n.id, width: w, height: h };
    if (isDecision(n)) {
      // Four ports at the diamond's points, so edges meet its corners rather than the bounding box.
      en.layoutOptions = { 'elk.portConstraints': 'FIXED_POS' };
      // oxlint-disable-next-line oxc/no-map-spread -- four ports
      en.ports = (['NORTH', 'EAST', 'SOUTH', 'WEST'] as Side[]).map((side) => ({
        id: `${n.id}~${side}`,
        ...sideOf(side, w, h),
        width: 0,
        height: 0,
        layoutOptions: { 'elk.port.side': side },
      }));
    }
    elkNodes.set(n.id, en);
  }
  const decisions = new Set(d.nodes.filter((n) => isDecision(n) && !groupIds.has(n.id)).map((n) => n.id));
  const portSide = decisionPorts(d, d.dir, decisions, prior, compact && tier >= 1);
  const containerOf = (id: string) => parent.get(id) ?? '__root';
  for (const [id, en] of elkNodes) {
    if (id === '__root') continue;
    elkNodes.get(containerOf(id))!.children!.push(en);
  }
  // Group label width must fit: give the group a minimum width.
  for (const g of d.groups) {
    const en = elkNodes.get(g.id)!;
    en.layoutOptions!['elk.nodeSize.minimum'] =
      `(${snap4(Math.max(...groupLines(g.label, m).map((l) => textWidth(l, m.GLABEL, { mono: true }))) + (compact ? 24 : 40))}, 40)`;
    en.layoutOptions!['elk.nodeSize.constraints'] = 'MINIMUM_SIZE';
    if (en.children!.length === 0) en.width = 96;
  }
  const ancestors = (id: string): string[] => {
    const a: string[] = [];
    let cur: string | undefined = id;
    while (cur) {
      a.push(cur);
      cur = parent.get(cur);
    }
    a.push('__root');
    return a;
  };
  const lca = (a: string, b: string): string => {
    const aa = ancestors(a).slice(1);
    const bb = new Set(ancestors(b).slice(1));
    return aa.find((x) => bb.has(x)) ?? '__root';
  };
  d.edges.forEach((e, i) => {
    // An edge may attach to a group's boundary, but not run between a group and its own contents.
    if (ancestors(e.to).includes(e.from) || ancestors(e.from).includes(e.to)) return;
    if (!elkNodes.has(e.from) || !elkNodes.has(e.to)) return;
    const text = edgeLabelText(e);
    const sp = portSide.get(`${i}:s`);
    const tp = portSide.get(`${i}:t`);
    const lines = monoLines(text, m.ELABEL, m.elMax);
    const ee: ElkEdge = {
      id: `e${i}`,
      sources: [decisions.has(e.from) && sp ? `${e.from}~${sp}` : e.from],
      targets: [decisions.has(e.to) && tp ? `${e.to}~${tp}` : e.to],
      labels: text
        ? [
            {
              text,
              width: Math.ceil(Math.max(...lines.map((l) => textWidth(l, m.ELABEL, { mono: true }))) + 12),
              height: m.elH + (lines.length - 1) * EL_LINE,
              layoutOptions: { 'elk.edgeLabels.inline': compact ? 'true' : 'false' },
            },
          ]
        : [],
    };
    const c = e.from === e.to ? containerOf(e.from) : lca(e.from, e.to);
    elkNodes.get(c)!.edges!.push(ee);
  });

  const res = (await elk.layout(root)) as ElkNode;

  // Flatten to absolute coordinates.
  const placed: Placed = { nodes: [], groups: [], edges: [], width: res.width ?? 0, height: res.height ?? 0 };
  const abs = new Map<string, P>();
  const nodeById = new Map(d.nodes.map((n) => [n.id, n]));
  const groupById = new Map(d.groups.map((g) => [g.id, g]));
  const walk = (n: ElkNode, ox: number, oy: number, depth: number) => {
    abs.set(n.id, { x: ox, y: oy });
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      // Whole pixels: keeps hairlines crisp and makes near-equal coordinates exactly equal.
      const box = { x: Math.round(x), y: Math.round(y), w: Math.round(c.width ?? 0), h: Math.round(c.height ?? 0) };
      const g = groupById.get(c.id);
      const gl = g && groupLines(g.label, m);
      if (g) placed.groups.push({ ...box, id: g.id, label: g.label, depth, ...(gl!.length > 1 ? { lines: gl! } : {}) });
      else {
        const node = nodeById.get(c.id)!;
        placed.nodes.push({ ...box, node, ...nodeText(node, compact, tier) });
      }
      walk(c, x, y, depth + 1);
    }
    for (const e of n.edges ?? []) {
      const idx = Number(e.id.slice(1));
      const s = e.sections?.[0];
      if (!s) continue;
      // ELK reports edge coordinates relative to the edge's container.
      const off = abs.get(e.container ?? n.id) ?? { x: ox, y: oy };
      const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({
        x: Math.round(p.x + off.x),
        y: Math.round(p.y + off.y),
      }));
      const l = e.labels?.[0];
      const lines = l ? monoLines(l.text, m.ELABEL, m.elMax) : [];
      let label =
        l && l.x !== undefined
          ? {
              x: Math.round(l.x + off.x),
              y: Math.round(l.y! + off.y),
              w: l.width,
              h: l.height,
              text: l.text,
              ...(lines.length > 1 ? { lines } : {}),
            }
          : null;
      placed.edges.push({ edge: d.edges[idx], points: pts, label });
    }
  };
  walk(res, 0, 0, 0);
  // Answers leaving a diamond move up against it, once every node and edge is in place to be avoided.
  for (const e of placed.edges) {
    if (!e.label || !decisions.has(e.edge.from)) continue;
    const me = placed.nodes.find((q) => q.node.id === e.edge.from);
    e.label = nearSource(e.points, e.label, me ? me.x + me.w / 2 : e.points[0].x, placed, e);
  }
  return placed;
}

const overlaps = (a: Box, b: Box, m = 0) => a.x < b.x + b.w + m && a.x + a.w > b.x - m && a.y < b.y + b.h + m && a.y + a.h > b.y - m;
const segBox = (a: P, b: P): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

/**
 * An answer ("yes", "no") reads best right at the diamond: put it beside the first of the edge's first
 * three segments that is long enough to hold it (above a horizontal one, outside a vertical one, else the
 * other side), provided it touches no node, no other edge and no other label. Otherwise ELK's spot stands.
 */
function nearSource(
  pts: P[],
  l: Box & { text: string },
  cx: number,
  placed: Placed,
  self: Placed['edges'][number],
): Box & { text: string } {
  const GAP = 5;
  const free = (c: Box) =>
    !placed.nodes.some((n) => overlaps(c, n, 1)) &&
    !placed.edges.some((o) =>
      o === self
        ? false
        : o.points.slice(1).some((q, i) => overlaps(c, segBox(o.points[i], q), 1)) ||
          (o.label && o !== self ? overlaps(c, o.label, 1) : false),
    ) &&
    !self.points.slice(1).some((q, i) => overlaps(c, segBox(self.points[i], q), 1));
  for (let i = 0; i < Math.min(3, pts.length - 1); i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const tries: Box[] = [];
    if (a.y === b.y) {
      if (Math.abs(b.x - a.x) < l.w + 16) continue;
      const x = Math.sign(b.x - a.x) > 0 ? a.x + 8 : a.x - 8 - l.w;
      tries.push({ ...l, x, y: a.y - l.h - GAP + 2 }, { ...l, x, y: a.y + GAP - 2 });
    } else if (a.x === b.x) {
      if (Math.abs(b.y - a.y) < l.h + 16) continue;
      const y = Math.sign(b.y - a.y) > 0 ? a.y + 8 : a.y - 8 - l.h;
      const right = { ...l, x: a.x + 6, y };
      const left = { ...l, x: a.x - 6 - l.w, y };
      tries.push(...(a.x >= cx ? [right, left] : [left, right]));
    }
    const hit = tries.find(free);
    if (hit) return { ...l, x: hit.x, y: hit.y };
  }
  return l;
}

/**
 * Phones: ELK leaves slack inside a group (room beside a node for a neighbour's edge, a few units of
 * placement). Pull each group in to its contents (members, and the edges and labels between them) plus the
 * 8-unit sides and 22-unit label band, deepest first, then move the drawing to the corner. Skipped when an
 * edge ends on a group, since that edge would no longer touch the box.
 */
function hugGroups(d: DiagramBlock, p: Placed): void {
  const groupIds = new Set(d.groups.map((g) => g.id));
  if (!p.groups.length || d.edges.some((e) => groupIds.has(e.from) || groupIds.has(e.to))) return;
  const parent = parentsOf(d);
  const inside = (id: string, g: string): boolean => {
    for (let c = parent.get(id); c; c = parent.get(c)) if (c === g) return true;
    return false;
  };
  const box = new Map<string, Box>();
  for (const n of p.nodes) box.set(n.node.id, n);
  for (const g of p.groups) box.set(g.id, g);
  for (const g of [...p.groups].toSorted((a, b) => b.depth - a.depth)) {
    const xs: number[] = [];
    const ys: number[] = [];
    const take = (b: Box) => {
      xs.push(b.x, b.x + b.w);
      ys.push(b.y, b.y + b.h);
    };
    for (const [id, b] of box) if (parent.get(id) === g.id) take(b);
    if (!xs.length) continue;
    for (const e of p.edges) {
      if (!inside(e.edge.from, g.id) || !inside(e.edge.to, g.id)) continue;
      for (const q of e.points) {
        xs.push(q.x);
        ys.push(q.y);
      }
      if (e.label) take({ ...e.label, x: e.label.x + 6, w: e.label.w - 12 }); // the text, not its 6-unit mask margins
    }
    const minW = Math.max(...(g.lines ?? [g.label.toUpperCase()]).map((l) => textWidth(l, PHONE.GLABEL, { mono: true }))) + 24;
    const x0 = Math.max(g.x, Math.floor(Math.min(...xs) - 8));
    const y0 = Math.max(g.y, Math.floor(Math.min(...ys) - 22 - ((g.lines?.length ?? 1) - 1) * EL_LINE));
    g.w = Math.min(g.x + g.w - x0, Math.ceil(Math.max(Math.max(...xs) + 8 - x0, minW)));
    g.h = Math.min(g.y + g.h - y0, Math.ceil(Math.max(...ys) + 8 - y0));
    g.x = x0;
    g.y = y0;
  }
  // Move everything so the drawing starts at the root padding.
  const boxes: Box[] = [...p.nodes, ...p.groups, ...p.edges.flatMap((e) => (e.label ? [e.label] : []))];
  const pts = p.edges.flatMap((e) => e.points);
  const x0 = Math.min(...boxes.map((b) => b.x), ...pts.map((q) => q.x)) - 4;
  const y0 = Math.min(...boxes.map((b) => b.y), ...pts.map((q) => q.y)) - 4;
  for (const b of boxes) {
    b.x -= x0;
    b.y -= y0;
  }
  for (const q of pts) {
    q.x -= x0;
    q.y -= y0;
  }
  p.width = Math.ceil(Math.max(...boxes.map((b) => b.x + b.w), ...pts.map((q) => q.x))) + 4;
  p.height = Math.ceil(Math.max(...boxes.map((b) => b.y + b.h), ...pts.map((q) => q.y))) + 4;
}

// Mono text renders about 0.66em wide in the page's mono stack (textWidth assumes 0.62em); group labels are
// measured with the wider figure so a label never runs past its box or out of the drawing.
const glabelW = (label: string): number => label.length * 0.66 * PHONE.GLABEL;

/**
 * Phones: ELK does not honor a group's minimum width under INCLUDE_CHILDREN, so a group can come out narrower
 * than its label. Widen such a group (centered, else growing right, else left) where that hits no other box,
 * grow its ancestors to keep holding it, and refit the drawing's origin and size.
 */
function fitGroupLabels(d: DiagramBlock, p: Placed): void {
  if (!p.groups.length) return;
  const parent = parentsOf(d);
  const under = (id: string, g: string): boolean => {
    for (let c = parent.get(id); c; c = parent.get(c)) if (c === g) return true;
    return false;
  };
  const idOf = (b: Placed['nodes'][number] | Placed['groups'][number]) => ('node' in b ? b.node.id : b.id);
  const all = [...p.nodes, ...p.groups];
  const byId = new Map(p.groups.map((g) => [g.id, g]));
  let moved = false;
  for (const g of [...p.groups].toSorted((a, b) => b.depth - a.depth)) {
    const need = Math.ceil(Math.max(...(g.lines ?? [g.label.toUpperCase()]).map(glabelW)) + 16);
    if (g.w >= need) continue;
    const extra = need - g.w;
    const others = all.filter((b) => b !== g && !under(idOf(b), g.id) && !under(g.id, idOf(b)));
    const pick = [g.x - Math.floor(extra / 2), g.x, g.x - extra]
      .map((x) => ({ x, y: g.y, w: need, h: g.h }))
      .find((c) => !others.some((o) => overlaps(c, o, 2)));
    if (!pick) continue;
    g.x = pick.x;
    g.w = pick.w;
    moved = true;
    for (let c: Box = g, a = parent.get(g.id); a && byId.has(a); c = byId.get(a)!, a = parent.get(a)) {
      const up = byId.get(a)!;
      const right = Math.max(up.x + up.w, c.x + c.w + 8);
      up.x = Math.min(up.x, c.x - 8);
      up.w = right - up.x;
    }
  }
  if (!moved) return;
  const boxes: Box[] = [...p.nodes, ...p.groups, ...p.edges.flatMap((e) => (e.label ? [e.label] : []))];
  const pts = p.edges.flatMap((e) => e.points);
  const x0 = Math.min(0, Math.min(...boxes.map((b) => b.x), ...pts.map((q) => q.x)) - 4);
  for (const b of boxes) b.x -= x0;
  for (const q of pts) q.x -= x0;
  p.width = Math.max(p.width - x0, Math.ceil(Math.max(...boxes.map((b) => b.x + b.w))) + 4);
}

/** The point halfway along a polyline, by length. */
function midpoint(pts: P[]): P {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let at = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (at <= len && len > 0)
      return { x: pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * at) / len, y: pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * at) / len };
    at -= len;
  }
  return pts[pts.length - 1];
}
const BLK_R = 7; // blocked-edge marker radius

/**
 * An edge label never sits on a node box (nor on a blocked edge's cross). One that does is moved to the
 * edge's longest free segment: centered on it first, then beside it, trying 1/2, 1/3, 2/3 and near each end
 * of the segment. Nodes and crosses are never allowed; of the rest, the spot touching the fewest other
 * labels and edges wins (the first of those that touches none). Labels that already clear the nodes stay where ELK put them.
 */
function clearLabels(p: Placed): void {
  const crosses = new Map<Placed['edges'][number], Box>();
  for (const e of p.edges)
    if (e.edge.style === 'blocked' && e.points.length > 1) {
      const c = midpoint(e.points);
      crosses.set(e, { x: c.x - BLK_R - 2, y: c.y - BLK_R - 2, w: 2 * BLK_R + 4, h: 2 * BLK_R + 4 });
    }
  const hard = (c: Box): boolean =>
    c.x < 0 ||
    c.y < 0 ||
    c.x + c.w > p.width ||
    c.y + c.h > p.height ||
    p.nodes.some((n) => overlaps(c, n, 1)) ||
    [...crosses.values()].some((k) => overlaps(c, k));
  // What a spot touches: 10 per other label (unreadable), 1 per other edge segment (a label over a line is only untidy).
  const soft = (c: Box, self: Placed['edges'][number]): number =>
    p.edges.reduce(
      (n, o) =>
        o === self
          ? n
          : n +
            (o.label && overlaps(c, o.label, 1) ? 10 : 0) +
            o.points.slice(1).filter((q, i) => overlaps(c, segBox(o.points[i], q), 0)).length,
      0,
    );
  for (const e of p.edges) {
    const l = e.label;
    if (!l) continue;
    const bad = p.nodes.some((n) => overlaps(l, n)) || [...crosses.values()].some((k) => overlaps(l, k));
    if (!bad) continue;
    const segs = e.points
      .slice(1)
      .map((q, i) => [e.points[i], q] as const)
      .filter(([a, b]) => a.x !== b.x || a.y !== b.y)
      .toSorted((u, v) => Math.hypot(v[1].x - v[0].x, v[1].y - v[0].y) - Math.hypot(u[1].x - u[0].x, u[1].y - u[0].y));
    const tries: Box[] = [];
    for (const [a, b] of segs) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ts = [0.5];
      for (let k = 1; k * 6 <= len / 2; k++) ts.push(0.5 - (k * 6) / len, 0.5 + (k * 6) / len); // outward from the middle, 6 units at a time
      for (const t of ts) {
        const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const on = { ...l, x: Math.round(c.x - l.w / 2), y: Math.round(c.y - l.h / 2) };
        const gap = e.edge.style === 'blocked' ? BLK_R + 5 : 3; // beside a crossed edge, clear of its circle
        if (a.y === b.y) tries.push(on, { ...on, y: Math.round(c.y - l.h - gap) }, { ...on, y: Math.round(c.y + gap) });
        else tries.push(on, { ...on, x: Math.round(c.x - l.w - gap - 1) }, { ...on, x: Math.round(c.x + gap + 1) });
      }
    }
    let pick: Box | undefined;
    let best = Infinity;
    for (const c of tries) {
      if (best === 0 || hard(c)) continue;
      const n = soft(c, e);
      if (n < best) {
        best = n;
        pick = c;
      }
    }
    if (pick) e.label = { ...l, x: pick.x, y: pick.y };
  }
}

function roundedPath(pts: P[], r = 6): string {
  if (pts.length < 2) return '';
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1 = { x: b.x - ((b.x - a.x) / (l1 || 1)) * rr, y: b.y - ((b.y - a.y) / (l1 || 1)) * rr };
    const p2 = { x: b.x + ((c.x - b.x) / (l2 || 1)) * rr, y: b.y + ((c.y - b.y) / (l2 || 1)) * rr };
    d += ` L${f(p1.x)},${f(p1.y)} Q${f(b.x)},${f(b.y)} ${f(p2.x)},${f(p2.y)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${f(last.x)},${f(last.y)}`;
}

export function markers(uid: string): string {
  return `<defs><marker id="${uid}-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 Z" class="ah"/></marker></defs>`;
}

/** A node kind as one class token. The tag shows the kind as written; the class must not add other classes (`kind="x sr"`). */
export const kindClass = (kind: string): string => `k-${kind.replace(/[^\w-]+/g, '-')}`;

function decisionSvg(b: Box & { node: DiagramNode; lines?: string[] }, compact = false): string {
  const n = b.node;
  const m = metrics(compact);
  const g = { lines: b.lines ?? decisionGeom(n).lines };
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const first = cy - ((g.lines.length - 1) * LINE + (n.sub ? m.subH : 0)) / 2 + 4.5;
  const pts = `${cx},${b.y} ${b.x + b.w},${cy} ${cx},${b.y + b.h} ${b.x},${cy}`;
  const cls = ['node', 'dec', n.focus ? 'focus' : '', n.kind ? kindClass(n.kind) : ''].filter(Boolean).join(' ');
  const text = g.lines
    .map((t, i) => `<text class="name" x="${cx}" y="${(first + i * LINE).toFixed(1)}" text-anchor="middle">${esc(t)}</text>`)
    .join('');
  const sub = n.sub
    ? `<text class="sub" x="${cx}" y="${(first + (g.lines.length - 1) * LINE + m.subH + 1).toFixed(1)}" text-anchor="middle">${esc(n.sub)}</text>`
    : '';
  return `<g class="${esc(cls)}"><polygon class="box" points="${pts}" stroke-linejoin="round"/>${text}${sub}</g>`;
}

/** `tag` sizes the kind tag (and its box) in place of the desktop 9: sequence diagrams use 10. */
export function nodeSvg(b: Box & { node: DiagramNode; lines?: string[] }, tag?: number): string {
  return nodeSvgAt(b, false, tag);
}

function nodeSvgAt(b: Box & { node: DiagramNode; lines?: string[]; subs?: string[] }, compact: boolean, tag?: number): string {
  const n = b.node;
  const m = tag ? { ...metrics(compact), TAG: tag, tagH: tag + 4 } : metrics(compact);
  if (isDecision(n)) return decisionSvg(b, compact);
  const cls = ['node', n.focus ? 'focus' : '', n.kind ? kindClass(n.kind) : ''].filter(Boolean).join(' ');
  const parts = [`<g class="${esc(cls)}">`, `<rect class="box" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6"/>`];
  let y = b.y + 12;
  if (n.kind) {
    const tw = textWidth(n.kind.toUpperCase(), m.TAG, { mono: true }) + 8;
    parts.push(`<rect class="tag" x="${b.x + 8}" y="${b.y + 8}" width="${tw.toFixed(0)}" height="${m.tagH}" rx="2"/>`);
    parts.push(`<text class="tagt" x="${b.x + 12}" y="${b.y + 4.5 + m.tagH}">${esc(n.kind.toUpperCase())}</text>`);
    y = b.y + 11 + m.tagH;
  }
  const inner = b.h - (y - b.y);
  const lines = b.lines ?? [n.label];
  const subs = b.subs ?? (n.sub ? [n.sub] : []);
  const content = lines.length * LINE + subs.length * m.subH;
  const nameY = y + inner / 2 - content / 2 + (n.sub ? 13 : 12.5);
  lines.forEach((l, i) =>
    parts.push(`<text class="name" x="${b.x + b.w / 2}" y="${(nameY + i * LINE).toFixed(1)}" text-anchor="middle">${esc(l)}</text>`),
  );
  subs.forEach((s, i) =>
    parts.push(
      `<text class="sub" x="${b.x + b.w / 2}" y="${(nameY + (lines.length - 1) * LINE + (i + 1) * m.subH).toFixed(1)}" text-anchor="middle">${esc(s)}</text>`,
    ),
  );
  parts.push('</g>');
  return parts.join('');
}

const FLIP = { LR: 'TB', RL: 'BT', TB: 'LR', BT: 'RL' } as const;
// Drawing widths the direction is fitted to: the widest desktop column (64rem) and a 400px phone's figure.
const FIT_DESKTOP = 1000;
const FIT_PHONE = 350;

// The widest phone drawing whose 12-unit text still renders at 11px or more in the 350px figure is 382 units;
// keep a few units of margin.
const PHONE_MAX = 372;

type Fit = { d: DiagramBlock; p: Placed };

/** The declared direction or its flip, whichever fits `width` at the larger scale; ties keep the declared one. */
async function bestFit(d: DiagramBlock, compact: boolean, width: number, tier = 0): Promise<Fit> {
  const declared = await layoutFlow(d, compact, tier);
  const flipped = { ...d, dir: FLIP[d.dir] };
  const other = await layoutFlow(flipped, compact, tier);
  const scale = (p: Placed) => Math.min(1, width / p.width);
  // Desktop only: a written direction that already renders at 85% or better is kept unless the other one
  // gains at least 15% (a pipeline written left-to-right stays one row instead of becoming a tall column).
  const gain = !compact && scale(declared) >= 0.85 ? 1.15 : 1;
  return scale(other) > scale(declared) * gain ? { d: flipped, p: other } : { d, p: declared };
}

/**
 * The diagram's unconnected parts: sets of top-level node and group ids that no edge joins, in the order
 * their first member is declared.
 */
function components(d: DiagramBlock): { top: (id: string) => string; parts: Set<string>[] } {
  const parent = parentsOf(d);
  const top = (id: string): string => {
    let c = id;
    for (let p = parent.get(c); p; p = parent.get(c)) c = p;
    return c;
  };
  const ids = [...d.nodes.map((n) => n.id), ...d.groups.map((g) => g.id)];
  const known = new Set(ids);
  const root = new Map<string, string>();
  const find = (x: string): string => {
    while (root.get(x) !== x) x = root.get(x)!;
    return x;
  };
  for (const id of ids) root.set(top(id), top(id));
  for (const e of d.edges) if (known.has(e.from) && known.has(e.to)) root.set(find(top(e.from)), find(top(e.to)));
  const parts = new Map<string, Set<string>>();
  for (const id of ids) {
    const r = find(top(id));
    if (!parts.has(r)) parts.set(r, new Set());
    parts.get(r)!.add(top(id));
  }
  return { top, parts: [...parts.values()] };
}

/**
 * Phones: ELK lays unconnected parts side by side, which makes a landing-zone style diagram (several accounts
 * with few edges between them) many times wider than any one part. Lay each part out on its own, in whichever
 * direction fits it, and stack them top to bottom, centered.
 */
async function stacked(d: DiagramBlock, tier: number): Promise<Fit | null> {
  const { top, parts } = components(d);
  if (parts.length < 2) return null;
  const fits: Placed[] = [];
  for (const part of parts) {
    const sub: DiagramBlock = {
      ...d,
      nodes: d.nodes.filter((n) => part.has(top(n.id))),
      groups: d.groups.filter((g) => part.has(top(g.id))),
      edges: d.edges.filter((e) => part.has(top(e.from))),
    };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each part is laid out in turn; not a measured hotspot
    fits.push((await bestFit(sub, true, FIT_PHONE, tier)).p);
  }
  const W = Math.max(...fits.map((f) => f.width));
  const out: Placed = { nodes: [], groups: [], edges: [], width: W, height: 0 };
  let y = 0;
  for (const f of fits) {
    const dx = Math.round((W - f.width) / 2);
    const dy = y;
    const move = <T extends { x: number; y: number }>(b: T): T => ({ ...b, x: b.x + dx, y: b.y + dy });
    out.nodes.push(...f.nodes.map(move));
    out.groups.push(...f.groups.map(move));
    out.edges.push(...f.edges.map((e) => ({ ...e, points: e.points.map(move), label: e.label ? move(e.label) : null })));
    y += f.height + 12; // each part keeps its 4-unit margin: 20 units between parts
  }
  out.height = y - 12;
  return { d, p: out };
}

/**
 * The phone drawing: the PHONE layout if it is narrow enough for 11px text, else the narrowest of the
 * unconnected parts stacked and the tighter tiers, tried in that order until one fits. Null when none fits.
 */
async function phoneFit(d: DiagramBlock): Promise<Fit | null> {
  let best = await bestFit(d, true, FIT_PHONE);
  // The tiers win 10-30% of the width; a connected drawing several times too wide goes straight to the list.
  if (best.p.width > PHONE_MAX * 2.5 && components(d).parts.length < 2) return null;
  const tries: (() => Promise<Fit | null>)[] = [() => stacked(d, 0)];
  for (let tier = 1; tier < TIERS.length; tier++) tries.push(async () => (await stacked(d, tier)) ?? bestFit(d, true, FIT_PHONE, tier));
  for (const t of tries) {
    if (best.p.width <= PHONE_MAX) return best;
    // oxlint-disable-next-line eslint/no-await-in-loop -- a later attempt runs only if the earlier ones did not fit
    const f = await t();
    if (f && f.p.width < best.p.width) best = f;
    if (best.p.width > PHONE_MAX * 2.5) return null; // stacking left one part several times too wide
  }
  return best.p.width <= PHONE_MAX ? best : null;
}

/**
 * Two drawings: desktop and phone, each in whichever direction fits its width better (the written direction
 * is a preference, a legible diagram beats an obedient one). CSS shows the phone one on narrow screens, with
 * text sized for the scale it will render at, so nobody pinches or scrolls sideways through a pipeline.
 *
 * A phone drawing too wide for 11px text is laid out again (`phoneFit`). If nothing fits, the phone gets the
 * diagram as a numbered list (`ol.seqlist.flowlist`) instead of an unreadable or sideways-scrolling drawing.
 */
export async function renderFlow(d: DiagramBlock, uid: string): Promise<string> {
  const desk = await bestFit(d, false, FIT_DESKTOP);
  const phone = await phoneFit(d);
  const h = drawPlaced(desk.d, desk.p, uid, false);
  if (!phone) {
    const fig = figure(d, `<div class="dg-h">${h.svg}</div><div class="dg-v" data-flow style="--wv:560px">${flowList(d)}</div>`, h.W, 240);
    return withLegend(d, fig);
  }
  const v = drawPlaced(phone.d, phone.p, `${uid}v`, true);
  const fig = figure(d, `<div class="dg-h">${h.svg}</div><div class="dg-v" data-flow style="--wv:${v.W}px">${v.svg}</div>`, h.W, v.W);
  return withLegend(d, fig);
}

/**
 * The phone fallback for a flow too wide to draw legibly: each group with what it holds, then every edge,
 * numbered, as `From → To: label` (the list sequence diagrams use for more than four participants).
 */
function flowList(d: DiagramBlock): string {
  const name = (id: string) => d.nodes.find((n) => n.id === id)?.label ?? d.groups.find((g) => g.id === id)?.label ?? id;
  const out: string[] = ['<ol class="seqlist flowlist">'];
  for (const g of d.groups) out.push(`<li class="frame">${esc(g.label)}: ${esc(g.members.map(name).join(', '))}</li>`);
  const inEdge = new Set(d.edges.flatMap((e) => [e.from, e.to]));
  const inGroup = new Set(d.groups.flatMap((g) => g.members));
  const loose = d.nodes.filter((n) => !inEdge.has(n.id) && !inGroup.has(n.id) && !d.groups.some((g) => g.id === n.id));
  if (loose.length) out.push(`<li class="frame">${esc(loose.map((n) => n.label).join(', '))}</li>`);
  for (const e of d.edges) {
    out.push(
      `<li${e.style === 'blocked' ? ' class="blocked"' : ''}><b>${esc(name(e.from))}</b> ${e.both ? '↔' : '→'} <b>${esc(name(e.to))}</b>${e.label ? `: ${esc(e.label)}` : ''}</li>`,
    );
  }
  out.push('</ol>');
  return out.join('');
}

/**
 * Below the drawing. By default: one mono-caps tag per distinct node kind, in first-seen order; none for fewer than
 * two kinds. With `legend` (v0.4 `NAME: legend`): the full key instead, never both.
 */
function withLegend(d: DiagramBlock, fig: string): string {
  const put = (html: string) => fig.replace(/<\/figure>$/, () => `${html}</figure>`);
  if (d.legend === true) {
    const key = legendKey(d);
    return key ? put(key) : fig;
  }
  const kinds: string[] = [];
  for (const n of d.nodes) if (n.kind && !kinds.includes(n.kind)) kinds.push(n.kind);
  if (kinds.length < 2) return fig;
  return put(`<div class="dg-legend">${kinds.map((k) => `<span class="tag">${esc(k.toUpperCase())}</span>`).join('')}</div>`);
}

const KEY_ARROW = { solid: 'request / flow', dashed: 'async / reply / optional', both: 'both ways', blocked: 'must not exist' } as const;
type KeyArrow = keyof typeof KEY_ARROW;

/** A key swatch: a small text-free SVG drawn with the diagram's own shapes (the labels beside it are HTML). */
const swatch = (w: number, h: number, inner: string) =>
  `<svg class="dgk-sw" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">${inner}</svg>`;
const SW_BOX = '<rect class="box" x="1" y="1" width="28" height="18" rx="4"/>';

/** Arrowheads are plain paths: a marker in the other (hidden) drawing would not render. */
function arrowSwatch(k: KeyArrow): string {
  const cls = { solid: 'edge', dashed: 'edge dash', both: 'edge', blocked: 'edge blocked' }[k];
  if (k === 'blocked') {
    return swatch(
      34,
      14,
      `<path class="${cls}" d="M1,7 H33"/><g class="blk"><circle cx="17" cy="7" r="6"/><path d="M14,4 L20,10 M20,4 L14,10"/></g>`,
    );
  }
  const line = `<path class="${cls}" d="M${k === 'both' ? 6 : 1},7 H${k === 'both' ? 28 : 27}"/>`;
  const heads = `<path class="ah" d="M33,7 L26,3.5 L26,10.5 Z"/>${k === 'both' ? '<path class="ah" d="M1,7 L8,3.5 L8,10.5 Z"/>' : ''}`;
  return swatch(34, 14, line + heads);
}

/**
 * The key for `legend`: each node kind used (its tag, beside the shape its nodes are drawn in), a focus swatch if
 * any node is focus, the group boundary if there are groups, then each arrow style used. Items wrap in one row.
 */
function legendKey(d: DiagramBlock): string {
  const items: string[] = [];
  const item = (sw: string, text: string) => items.push(`<span class="dgk">${sw}<span class="dgk-t">${text}</span></span>`);
  const kinds: string[] = [];
  for (const n of d.nodes) if (n.kind && !kinds.includes(n.kind)) kinds.push(n.kind);
  for (const k of kinds) {
    const dec = isDecision({ kind: k } as DiagramNode);
    const shape = dec ? '<polygon class="box" points="15,1 29,10 15,19 1,10"/>' : SW_BOX;
    const cls = ['node', dec ? 'dec' : '', kindClass(k)].filter(Boolean).join(' ');
    item(swatch(30, 20, `<g class="${esc(cls)}">${shape}</g>`), `<span class="tag">${esc(k.toUpperCase())}</span>`);
  }
  if (d.nodes.some((n) => n.focus)) item(swatch(30, 20, `<g class="node focus">${SW_BOX}</g>`), 'focus');
  if (d.groups.length) item(swatch(30, 20, '<rect class="grp" x="1" y="1" width="28" height="18" rx="5"/>'), 'boundary');
  const used = new Set<KeyArrow>();
  for (const e of d.edges) {
    if (e.both) used.add('both');
    if (!(e.both && e.style === 'solid')) used.add(e.style);
  }
  for (const k of ['solid', 'dashed', 'both', 'blocked'] as const) if (used.has(k)) item(arrowSwatch(k), KEY_ARROW[k]);
  return items.length ? `<div class="dg-key" role="group" aria-label="Key">${items.join('')}</div>` : '';
}

function drawPlaced(d: DiagramBlock, p: Placed, uid: string, compact: boolean): { svg: string; W: number; H: number } {
  const m = metrics(compact);
  const W = Math.ceil(p.width);
  const H = Math.ceil(p.height);
  const out: string[] = [];
  const label = plain(d.title ?? `${d.name} diagram`);
  out.push(svgOpen(uid, W, H, label, describeFlow(d)));
  out.push(markers(uid));
  for (const g of [...p.groups].toSorted((a, b) => a.depth - b.depth)) {
    out.push(`<rect class="grp" x="${g.x.toFixed(1)}" y="${g.y.toFixed(1)}" width="${g.w.toFixed(1)}" height="${g.h.toFixed(1)}" rx="8"/>`);
  }
  // Edges before nodes so lines sit behind boxes; labels last so their masks cover nothing but lines.
  for (const e of p.edges) {
    const cls = [
      'edge',
      e.edge.style === 'dashed' ? 'dash' : '',
      e.edge.style === 'blocked' ? 'blocked' : '',
      isFocusEdge(d, e.edge) ? 'hot' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const start = e.edge.both ? ` marker-start="url(#${uid}-a)"` : '';
    out.push(
      `<path class="${cls}" d="${roundedPath(e.points)}" marker-end="url(#${uid}-a)"${start}><title>${esc(`${e.edge.from} → ${e.edge.to}${e.edge.label ? `: ${e.edge.label}` : ''}`)}</title></path>`,
    );
  }
  // A blocked edge is crossed out halfway along: a circle over the line with an X in it.
  for (const e of p.edges) {
    if (e.edge.style !== 'blocked' || e.points.length < 2) continue;
    const c = midpoint(e.points);
    const k = 3;
    out.push(
      `<g class="blk"><circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${BLK_R}"/><path d="M${(c.x - k).toFixed(1)},${(c.y - k).toFixed(1)} L${(c.x + k).toFixed(1)},${(c.y + k).toFixed(1)} M${(c.x + k).toFixed(1)},${(c.y - k).toFixed(1)} L${(c.x - k).toFixed(1)},${(c.y + k).toFixed(1)}"/></g>`,
    );
  }
  for (const n of p.nodes) out.push(nodeSvgAt(n, compact));
  // Group labels go over edges on a mask, so a line crossing a boundary never runs through the text.
  // Phone bands are 22 tall, so the mask hugs the top of the group.
  for (const g of p.groups) {
    const lines = g.lines ?? [g.label.toUpperCase()];
    const extra = (lines.length - 1) * EL_LINE;
    const w = Math.max(...lines.map((t) => (compact ? glabelW(t) : textWidth(t, m.GLABEL, { mono: true })))) + 8;
    const band =
      Math.min(
        Infinity,
        ...[...p.nodes, ...p.groups]
          .filter((c) => c !== g && c.x >= g.x && c.y >= g.y && c.x + c.w <= g.x + g.w && c.y + c.h <= g.y + g.h)
          .map((c) => c.y - g.y),
      ) - extra;
    const [mx, my, mh, tx, ty] = compact ? [4, 3, Math.max(8, Math.min(16, band - 4)), 8, 15] : [8, 10, 14, 12, 20];
    out.push(
      `<rect class="lmask" x="${(g.x + mx).toFixed(1)}" y="${(g.y + my).toFixed(1)}" width="${w.toFixed(1)}" height="${mh + extra}" rx="2"/>`,
    );
    lines.forEach((t, i) =>
      out.push(`<text class="glabel" x="${(g.x + tx).toFixed(1)}" y="${(g.y + ty + i * EL_LINE).toFixed(1)}">${esc(t)}</text>`),
    );
  }
  for (const e of p.edges) {
    if (!e.label) continue;
    const l = e.label;
    out.push(
      `<rect class="lmask" x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" width="${l.w.toFixed(1)}" height="${l.h.toFixed(1)}" rx="2"/>`,
    );
    const lines = l.lines ?? [l.text];
    lines.forEach((t, i) =>
      out.push(
        `<text class="elabel${yn(d, e.edge)}${e.edge.style === 'blocked' ? ' blocked' : ''}" x="${(l.x + l.w / 2).toFixed(1)}" y="${(l.y + l.h / 2 + m.ELABEL * 0.35 + (i - (lines.length - 1) / 2) * EL_LINE).toFixed(1)}" text-anchor="middle">${esc(t)}</text>`,
      ),
    );
  }
  out.push('</svg>');
  return { svg: out.join(''), W, H };
}

/** Yes/no answers leaving a decision get a color class (the words stay; color is a second cue). */
function yn(d: DiagramBlock, e: DiagramEdge): string {
  const src = d.nodes.find((n) => n.id === e.from);
  if (!src || !isDecision(src)) return '';
  const l = e.label.trim();
  return YES.test(l) ? ' yes' : NO.test(l) ? ' no' : '';
}

function isFocusEdge(d: DiagramBlock, e: DiagramEdge): boolean {
  const f = new Set(d.nodes.filter((n) => n.focus).map((n) => n.id));
  return f.has(e.from) && f.has(e.to);
}

export function svgOpen(uid: string, W: number, H: number, label: string, desc: string, cls = ''): string {
  return `<svg class="dg${cls ? ` ${cls}` : ''}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="${uid}-t ${uid}-d"><title id="${uid}-t">${esc(label)}</title><desc id="${uid}-d">${esc(desc)}</desc>`;
}

export function figure(d: DiagramBlock, svg: string, W: number, narrowW?: number): string {
  const title = d.title ? `<figcaption>${inline(d.title)}</figcaption>` : '';
  // Shrink to fit down to 70% scale; beyond that the figure scrolls sideways instead of shrinking text.
  // The figure is as wide as the drawing (capped by the page), so the caption sits on the drawing's left edge.
  // --w and --wv are the figure's outer widths: the drawing plus the card's 34px of padding and border, so a drawing
  // renders at 1:1. On phones the card is sized from the phone drawing (--wv), not the desktop one.
  return `<figure class="viz dg-fig" style="--w:${W + 34}px${narrowW ? `;--wv:${narrowW + 34}px` : ''}">${title}<div class="scroll" tabindex="0" role="group" aria-label="${esc(plain(d.title ?? d.name))}"><div class="dg-wrap" style="--minw:${Math.round(W * 0.7)}px${narrowW ? `;--minwv:${Math.round(narrowW * 0.7)}px` : ''}">${svg}</div></div></figure>`;
}

function describeFlow(d: DiagramBlock): string {
  const name = (id: string) => d.nodes.find((n) => n.id === id)?.label ?? id;
  const groups = d.groups.map(
    (g) => `${g.label} contains ${g.members.map((m) => d.groups.find((x) => x.id === m)?.label ?? name(m)).join(', ')}`,
  );
  const edges = d.edges.map((e) => `${name(e.from)} ${e.both ? '↔' : '→'} ${name(e.to)}${e.label ? ` (${e.label})` : ''}`);
  return [`${d.nodes.length} nodes.`, groups.join('. '), edges.join('; ')].filter(Boolean).join(' ');
}
