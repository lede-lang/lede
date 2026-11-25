// Structure-only validator for arm E. The format is the one prompts/E-json-ui.md documents; this file is its only machine check.
// It checks that the reply parses and that every block has the fields the prompt documents; it draws nothing and checks no facts.
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const oneOf = (v: unknown, set: readonly string[]) => isStr(v) && set.includes(v);

export interface JsonUiResult {
  ok: boolean;
  errors: string[];
  sections: number;
  blocks: number;
}

// The fields the prompt shows for each block type; "optional" ones may be left out but never written as null or "".
const FIELDS: Record<string, { all: string[]; optional: string[] }> = {
  text: { all: ['type', 'text'], optional: [] },
  list: { all: ['type', 'items', 'ordered'], optional: ['ordered'] },
  kpi: { all: ['type', 'tiles'], optional: [] },
  table: { all: ['type', 'columns', 'rows', 'align'], optional: ['align'] },
  chart: { all: ['type', 'kind', 'title', 'unit', 'series'], optional: ['title', 'unit'] },
  callout: { all: ['type', 'tone', 'text'], optional: [] },
  steps: { all: ['type', 'items'], optional: [] },
  cards: { all: ['type', 'items'], optional: [] },
  diagram: { all: ['type', 'kind', 'nodes', 'edges'], optional: ['edges'] },
  code: { all: ['type', 'language', 'text'], optional: ['language'] },
};

const BLOCKS = ['text', 'list', 'kpi', 'table', 'chart', 'callout', 'steps', 'cards', 'diagram', 'code'] as const;

export function validateJsonUi(source: string): JsonUiResult {
  const errors: string[] = [];
  let blocks = 0;
  let sections = 0;
  let doc: unknown;
  try {
    doc = JSON.parse(source);
  } catch (e) {
    return { ok: false, errors: [`not JSON: ${(e as Error).message}`], sections, blocks };
  }
  const err = (at: string, msg: string) => errors.push(`${at}: ${msg}`);
  const strList = (at: string, v: unknown) => {
    if (!Array.isArray(v) || !v.every(isStr)) err(at, 'must be an array of strings');
  };
  const items = (at: string, v: unknown, each: (o: Obj, at: string) => void) => {
    if (!Array.isArray(v) || v.length === 0) {
      err(at, 'must be a non-empty array');
      return;
    }
    v.forEach((o, i) => (isObj(o) ? each(o, `${at}[${i}]`) : err(`${at}[${i}]`, 'must be an object')));
  };
  const optional = (o: Obj, names: string[], at: string) => {
    for (const n of names)
      if (o[n] === null || o[n] === '') err(`${at}.${n}`, 'leave an optional field out rather than writing null or an empty string');
  };
  const block = (b: Obj, at: string) => {
    blocks++;
    if (!oneOf(b.type, BLOCKS)) {
      err(at, `unknown block type ${JSON.stringify(b.type)}`);
      return;
    }
    const f = FIELDS[b.type as string];
    for (const k of Object.keys(b)) if (!f.all.includes(k)) err(at, `a ${String(b.type)} block has no field "${k}"`);
    optional(b, f.optional, at);
    switch (b.type) {
      case 'text':
        if (!isStr(b.text)) err(at, 'text needs a string "text"');
        break;
      case 'list':
        strList(`${at}.items`, b.items);
        if (b.ordered !== undefined && typeof b.ordered !== 'boolean') err(at, '"ordered" must be a boolean');
        break;
      case 'kpi':
        items(`${at}.tiles`, b.tiles, (t, a) => {
          if (!isStr(t.label) || !isStr(t.value)) err(a, 'tile needs string "label" and "value"');
          optional(t, ['note', 'trend'], a);
          if (t.trend !== undefined && !oneOf(t.trend, ['up', 'down', 'flat'])) err(a, 'trend must be up, down or flat');
        });
        break;
      case 'table': {
        strList(`${at}.columns`, b.columns);
        const cols = Array.isArray(b.columns) ? b.columns.length : -1;
        if (!Array.isArray(b.rows)) err(at, '"rows" must be an array');
        else
          b.rows.forEach((r: unknown, i) => {
            if (!Array.isArray(r) || !r.every((c) => isStr(c) || isNum(c)))
              err(`${at}.rows[${i}]`, 'row must be an array of strings and numbers');
            else if (cols >= 0 && r.length !== cols) err(`${at}.rows[${i}]`, `row has ${r.length} cells for ${cols} columns`);
          });
        if (b.align !== undefined && (!Array.isArray(b.align) || !b.align.every((x) => oneOf(x, ['left', 'right']))))
          err(at, '"align" must hold left or right');
        break;
      }
      case 'chart':
        if (!oneOf(b.kind, ['line', 'bar', 'pie'])) err(at, 'chart kind must be line, bar or pie');
        items(`${at}.series`, b.series, (s, a) => {
          if (!isStr(s.name)) err(a, 'series needs a string "name"');
          if (Array.isArray(s.points) && s.points.length === 1) err(`${a}.points`, 'a chart series has at least two points');
          items(`${a}.points`, s.points, (p, pa) => {
            if (!isStr(p.x) || !isNum(p.y)) err(pa, 'point needs string "x" and numeric "y"');
          });
        });
        if (b.kind === 'pie' && Array.isArray(b.series) && b.series.length !== 1) err(at, 'a pie has exactly one series');
        break;
      case 'callout':
        if (!oneOf(b.tone, ['note', 'warning', 'critical']) || !isStr(b.text))
          err(at, 'callout needs tone note, warning or critical, and a string "text"');
        break;
      case 'steps':
        items(`${at}.items`, b.items, (s, a) => {
          if (!isStr(s.title)) err(a, 'step needs a string "title"');
          optional(s, ['detail', 'when'], a);
        });
        break;
      case 'cards':
        items(`${at}.items`, b.items, (c, a) => {
          if (!isStr(c.title) || !isStr(c.text)) err(a, 'card needs string "title" and "text"');
          optional(c, ['tag'], a);
        });
        break;
      case 'diagram': {
        if (!oneOf(b.kind, ['flow', 'sequence'])) err(at, 'diagram kind must be flow or sequence');
        const ids = new Set<string>();
        items(`${at}.nodes`, b.nodes, (n, a) => {
          optional(n, ['group'], a);
          if (!isStr(n.id) || !isStr(n.label)) err(a, 'node needs string "id" and "label"');
          else if (ids.has(n.id)) err(a, `duplicate node id ${n.id}`);
          else ids.add(n.id);
        });
        if (b.edges !== undefined)
          items(`${at}.edges`, b.edges, (e, a) => {
            optional(e, ['label'], a);
            if (!isStr(e.from) || !isStr(e.to)) err(a, 'edge needs string "from" and "to"');
            else if (!ids.has(e.from) || !ids.has(e.to)) err(a, `edge ${e.from} -> ${e.to} names a node that does not exist`);
          });
        break;
      }
      case 'code':
        if (!isStr(b.text)) err(at, 'code needs a string "text"');
        break;
    }
  };
  const page = isObj(doc) ? doc.page : undefined;
  if (!isObj(page)) {
    err('$', 'needs a top-level "page" object');
    return { ok: false, errors, sections, blocks };
  }
  if (!isStr(page.title)) err('page.title', 'must be a string');
  optional(page, ['subtitle', 'author', 'date'], 'page');
  if (!Array.isArray(page.sections) || page.sections.length === 0) err('page.sections', 'must be a non-empty array');
  else
    page.sections.forEach((s: unknown, i) => {
      const at = `page.sections[${i}]`;
      if (!isObj(s)) {
        err(at, 'must be an object');
        return;
      }
      sections++;
      if (!isStr(s.heading)) err(`${at}.heading`, 'must be a string');
      optional(s, ['level'], at);
      if (s.level !== undefined && ![1, 2, 3].includes(s.level as number)) err(`${at}.level`, 'must be 1, 2 or 3');
      if (!Array.isArray(s.blocks)) {
        err(`${at}.blocks`, 'must be an array');
        return;
      }
      s.blocks.forEach((b: unknown, j) => (isObj(b) ? block(b, `${at}.blocks[${j}]`) : err(`${at}.blocks[${j}]`, 'must be an object')));
    });
  return { ok: errors.length === 0, errors, sections, blocks };
}
