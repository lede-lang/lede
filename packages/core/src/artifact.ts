import type { Diagnostic, LedeDocument } from './ast.ts';
import { imageSrcKind } from './url.ts';
import { walkBlocks } from './walk.ts';

/**
 * Images a host that serves the page from its own origin cannot load: local paths, relative (`fig.png`) or root-absolute
 * (`/assets/logo.png`), since the host has no copy of either (internal spec, lede-lang/meta).
 * The parser cannot know the output mode and the renderer returns a string, so this is a separate pure check that
 * the CLI runs under `--artifact` and library users can call on any parsed document. Only `image` blocks are read;
 * an `<img>` inside an `html` block is the sanitizer's business.
 */
export function artifactDiagnostics(doc: LedeDocument): Diagnostic[] {
  const out: Diagnostic[] = [];
  walkBlocks(doc.blocks, (b) => {
    if (b.type === 'image' && imageSrcKind(b.src) === 'local')
      out.push({
        severity: 'warning',
        code: 'artifact-image',
        message: `image ${b.src} is a local path, which the Artifact host does not serve; inline it as a data: URI or upload it as an asset and use the asset URL`,
        line: b.line,
        col: 1,
        detail: { src: b.src, kind: 'local' },
      });
  });
  return out;
}
