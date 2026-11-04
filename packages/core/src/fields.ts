import type { Block, ExportBlock, PresetBlock, QuestionBlock } from './ast.ts';

/** The Markdown export's placeholder for an unpicked `choose`; the parser refuses an option spelled like it. */
export const NOT_CHOSEN = '(not chosen)';

function walk(blocks: Block[], visit: (b: Block) => void): void {
  for (const b of blocks) {
    visit(b);
    if (b.type === 'cards') for (const c of b.items) walk(c.blocks, visit);
    else if (b.type === 'grid') walk(b.children, visit);
  }
}

/**
 * The kinds of field (spec §4.18, §4.19). `fillable`: the field holds a value the reader sets, so a `{slot}` or a `preset` key may name
 * it. `editor`: it is one of the editor words, which is when a page carries their CSS. A `preset` has a name but no value in the
 * export, so it is not a field (see `presetsOf`).
 */
export const FIELD_KINDS: Record<QuestionBlock['type'], { fillable: boolean; editor: boolean }> = {
  ask: { fillable: true, editor: false },
  choose: { fillable: true, editor: false },
  confirm: { fillable: false, editor: false },
  param: { fillable: true, editor: true },
  toggle: { fillable: true, editor: true },
  bucket: { fillable: false, editor: true },
  template: { fillable: false, editor: true },
};

/** A template slot: a `{name}` in the fence. The shell runtime reads the same shape. Use it with `replace` or `matchAll`, which restart it. */
export const SLOT_RE = /\{([A-Za-z][\w-]*)\}/g;

/**
 * Every field of a document in source order, including those inside `cards` and `grid`: `ask`, `choose`, `confirm`, `param`,
 * `toggle`, `bucket` and `template` (see `FIELD_KINDS`).
 */
export function fieldsOf(blocks: Block[]): QuestionBlock[] {
  const out: QuestionBlock[] = [];
  walk(blocks, (b) => {
    if (Object.hasOwn(FIELD_KINDS, b.type)) out.push(b as QuestionBlock);
  });
  return out;
}

/** Every `preset` block, wherever it sits. */
export function presetsOf(blocks: Block[]): PresetBlock[] {
  const out: PresetBlock[] = [];
  walk(blocks, (b) => {
    if (b.type === 'preset') out.push(b);
  });
  return out;
}

/** Every `export` block, wherever it sits. */
export function exportsOf(blocks: Block[]): ExportBlock[] {
  const out: ExportBlock[] = [];
  walk(blocks, (b) => {
    if (b.type === 'export') out.push(b);
  });
  return out;
}
