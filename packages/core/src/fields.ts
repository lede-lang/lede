import type { Block, ExportBlock, QuestionBlock } from './ast.ts';

function walk(blocks: Block[], visit: (b: Block) => void): void {
  for (const b of blocks) {
    visit(b);
    if (b.type === 'cards') for (const c of b.items) walk(c.blocks, visit);
    else if (b.type === 'grid') walk(b.children, visit);
  }
}

/** Every question block of a document in source order, including those inside `cards` and `grid`. */
export function fieldsOf(blocks: Block[]): QuestionBlock[] {
  const out: QuestionBlock[] = [];
  walk(blocks, (b) => {
    if (b.type === 'ask' || b.type === 'choose' || b.type === 'confirm') out.push(b);
  });
  return out.toSorted((a, b) => a.line - b.line);
}

/** Every `export` block, wherever it sits. */
export function exportsOf(blocks: Block[]): ExportBlock[] {
  const out: ExportBlock[] = [];
  walk(blocks, (b) => {
    if (b.type === 'export') out.push(b);
  });
  return out;
}
