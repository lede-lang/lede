import type { Block, Diagnostic, LedeDocument } from './ast.ts';
import { imageSrcKind } from './url.ts';

/**
 * Images a host that serves the page from its own origin cannot load: relative paths (internal spec, lede-lang/meta).
 * The parser cannot know the output mode and the renderer returns a string, so this is a separate pure check that
 * the CLI runs under `--artifact` and library users can call on any parsed document. Only `image` blocks are read;
 * an `<img>` inside an `html` block is the sanitizer's business.
 */
export function artifactDiagnostics(doc: LedeDocument): Diagnostic[] {
  const out: Diagnostic[] = [];
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.type === 'image') {
        if (imageSrcKind(b.src) === 'local')
          out.push({
            severity: 'warning',
            code: 'artifact-image',
            message: `image ${b.src} is a relative path, which the Artifact host does not serve; inline it as a data: URI or upload it as an asset and use the asset URL`,
            line: b.line,
            col: 1,
            detail: { src: b.src, kind: 'local' },
          });
      } else if (b.type === 'grid') walk(b.children);
      else if (b.type === 'cards') for (const item of b.items) walk(item.blocks);
    }
  };
  walk(doc.blocks);
  return out;
}
