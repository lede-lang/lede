// What the three tools do, with no MCP in it: every option that could widen what a page may do is fixed here, not read from a tool input.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, type Diagnostic, type ParseOptions } from '@lede-lang/core';
import { compile } from '@lede-lang/html';
// The CLI's confinement, imported by path inside the workspace: the cli package exports no module, and Node does not strip types under node_modules.
import { confine, unreadable } from '../../cli/src/confine.ts';

/** The largest `source` a tool takes, in bytes of UTF-8. */
export const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_DATA_BYTES = 5 * 1024 * 1024;

export class InputError extends Error {}

export interface Report {
  ok: boolean;
  diagnostics: Diagnostic[];
}

/** Where `data x < file.csv` may read from; `null` disables file data entirely. */
export type Root = string | null;

/** The real path of a `--root` directory; throws if it is not a directory. */
export function realRoot(dir: string): string {
  const real = realpathSync(resolve(dir));
  if (!statSync(real).isDirectory()) throw new Error(`${dir} is not a directory`);
  return real;
}

function checked(source: unknown): string {
  if (typeof source !== 'string') throw new InputError('source must be a string');
  const bytes = Buffer.byteLength(source, 'utf8');
  if (bytes > MAX_SOURCE_BYTES) throw new InputError(`source is ${bytes} bytes; the limit is ${MAX_SOURCE_BYTES} bytes (1 MB)`);
  return source;
}

function parseOptions(root: Root): ParseOptions {
  // No loadFile: the parser then reports E data-file ("file data is not available here") on each `data x < path` line.
  if (root === null) return {};
  return {
    loadFile: (p: string) => {
      if (/^[a-z]+:/i.test(p)) throw new Error('only local files can be loaded');
      const full = confine(root, p, root);
      try {
        if (statSync(full).size > MAX_DATA_BYTES) throw new Error(`${p} is larger than 5 MB`);
        return readFileSync(full, 'utf8');
      } catch (e) {
        throw (e as NodeJS.ErrnoException).code === undefined ? e : unreadable(p, e as NodeJS.ErrnoException);
      }
    },
  };
}

const hasError = (ds: readonly Diagnostic[]) => ds.some((d) => d.severity === 'error');

/** `lede check --json` for one page: its diagnostics, plus `ok` (no error among them). */
export function check(source: unknown, root: Root): Report {
  const doc = parse(checked(source), parseOptions(root));
  return { ok: !hasError(doc.diagnostics), diagnostics: doc.diagnostics };
}

/** The page as HTML, or, when the source has errors, no HTML and the diagnostics (the CLI's rule without --force). Writes nothing. */
export async function build(source: unknown, root: Root, artifact: boolean): Promise<Report & { html?: string }> {
  // No unsafeHtml, allowRemote or shell: raw html stays sanitized, nothing remote is emitted, and the page has no script.
  const { html, doc } = await compile(checked(source), { ...parseOptions(root), artifact });
  if (hasError(doc.diagnostics)) return { ok: false, diagnostics: doc.diagnostics };
  return { ok: true, diagnostics: doc.diagnostics, html };
}

/**
 * The model reference, read from where it lives: `spec/model-spec.md` in the checkout, or the copy `prepack` puts in the package
 * (scripts/copy-spec.ts). It is read on each call, so there is one source and no copy in the tree.
 */
export function specText(): string {
  for (const rel of ['../spec/model-spec.md', '../../../spec/model-spec.md']) {
    try {
      return readFileSync(new URL(rel, import.meta.url), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  throw new Error('spec/model-spec.md is not in this package or in the checkout');
}
