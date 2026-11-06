import type { Block, CardItem } from './ast.ts';

/**
 * Calls `fn` on every block of `blocks` in document order, a block before the blocks it holds: a `grid`'s `children` and the
 * blocks of each card of a `cards` block. `card` is the card that holds the block, and undefined anywhere else.
 */
export function walkBlocks(blocks: readonly Block[], fn: (block: Block, card?: CardItem) => void): void {
  const walk = (list: readonly Block[], card?: CardItem): void => {
    for (const b of list) {
      fn(b, card);
      if (b.type === 'grid') walk(b.children, card);
      else if (b.type === 'cards') for (const item of b.items) walk(item.blocks, item);
    }
  };
  walk(blocks);
}
