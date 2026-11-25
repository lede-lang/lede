// A page of tabs (spec §4.21, D85): a manifest's `tab` lines name other Lede files, the parts, and each is drawn as one tab. This module
// reads no files: the caller hands it each part already read and parsed, and it adds what only the combined page can know.
import type { Diagnostic, LedeDocument, TabBlock } from './ast.ts';
import { fieldsOf } from './fields.ts';

/**
 * The keys that describe a whole page, which a part may not set for the combined page: the manifest's apply to every tab, and a part's
 * are left out of it with W `tab-part-meta` (its standalone page is unchanged). A part's `title`, `subtitle`, `author`, `date`, `meta`,
 * `status` and `width` apply to its own tab.
 */
export const PART_PAGE_KEYS = ['theme', 'accent', 'fonts', 'lang', 'description', 'image', 'canonical'] as const;

/** A part as the caller read it: its source text and that text parsed (and checked) as a page of its own. */
export interface LoadedPart {
  src: string;
  doc: LedeDocument;
}

/** One tab of the combined page. */
export interface TabPart {
  /** The manifest's line that names it. */
  tab: TabBlock;
  /** What the tab is called: the line's label, else the part's `@title`, else its first `#` heading, else its file name. Inline text. */
  label: string;
  src: string;
  doc: LedeDocument;
  /** The first 12 hex digits of the SHA-256 of the part's bytes, when the caller gave a hash function. */
  sha: string | null;
}

export interface ResolveOptions {
  /**
   * Reads and parses the part a tab line names. It throws when the part cannot be read; an error with `reason` `outside` (the path
   * leaves the manifest's tree) is reported as such, anything else as `missing`.
   */
  read: (tab: TabBlock) => LoadedPart;
  /** The SHA-256 of a part's text as lower-case hex. Without it no tab carries a hash and pins are not checked. */
  sha256?: (text: string) => string;
}

/** The tab lines of a document, in order. A document with none is not a manifest. */
export const tabsOf = (doc: LedeDocument): TabBlock[] => doc.blocks.filter((b): b is TabBlock => b.type === 'tab');

/** The lines of `src` that set one of `PART_PAGE_KEYS`, outside a fence, with the key: where W `tab-part-meta` points. */
function pageKeyLines(src: string): { key: string; line: number; col: number }[] {
  const out: { key: string; line: number; col: number }[] = [];
  let fence = 0;
  src.split('\n').forEach((raw, i) => {
    const s = raw.trim();
    if (fence) {
      if (/^`{3,}$/.test(s) && s.length >= fence) fence = 0;
      return;
    }
    // The parser's own test for a fence that opens (`` ```js extra `` is text, and so is `` ```=html lines ``).
    const open = /^(`{3,})\s*(=?)[\w+-]*(?:\s+(lines))?\s*$/.exec(s);
    if (open && !(open[2] === '=' && open[3])) {
      fence = open[1].length;
      return;
    }
    const m = /^@([A-Za-z][\w-]*)(?=\s|$)/.exec(s);
    if (m && (PART_PAGE_KEYS as readonly string[]).includes(m[1]))
      out.push({ key: m[1], line: i + 1, col: raw.length - raw.trimStart().length + 1 });
  });
  return out;
}

/** The part's title for its tab: `@title`, else its first `#` heading, else the file name without `.lede`. */
function titleOf(doc: LedeDocument, path: string): string {
  if (doc.meta.title?.trim()) return doc.meta.title.trim();
  const h1 = doc.blocks.find((b) => b.type === 'heading' && b.level === 1);
  if (h1?.type === 'heading' && h1.text.trim()) return h1.text.trim();
  return (path.split('/').pop() ?? path).replace(/\.lede$/, '');
}

const err = (code: string, message: string, line: number, col: number, detail: Record<string, unknown>): Diagnostic => ({
  severity: 'error',
  code,
  message,
  line,
  col,
  detail,
});

/**
 * Reads every part `doc`'s tab lines name and returns them in order, with what the combined page adds to the diagnostics: on the
 * manifest, E `tab-path` for a part that cannot be read and E `tab-stale` for a pin its part no longer matches; on each part, E
 * `tab-nested` for a tab line of its own, W `tab-part-meta` for a page-level key, and E `tab-field-clash` for a question name an earlier
 * tab (or the manifest's lead) already uses, since the tabs share one page. A part that cannot be read is left out.
 */
export function resolveTabs(doc: LedeDocument, opts: ResolveOptions): TabPart[] {
  const parts: TabPart[] = [];
  const names = new Map<string, string>(fieldsOf(doc.blocks).map((f) => [f.name, 'the manifest']));
  for (const tab of tabsOf(doc)) {
    let loaded: LoadedPart;
    try {
      loaded = opts.read(tab);
    } catch (e) {
      const kind = (e as { reason?: unknown }).reason === 'outside' ? 'outside' : 'missing';
      const why = kind === 'outside' ? "is outside the manifest's directory" : `cannot be read: ${(e as Error).message}`;
      doc.diagnostics.push(err('tab-path', `tab ${tab.path} ${why}`, tab.line, 1, { path: tab.path, kind }));
      continue;
    }
    const { src, doc: part } = loaded;
    const full = opts.sha256?.(src);
    const sha = full?.slice(0, 12) ?? null;
    if (tab.pin && full) {
      if (!full.startsWith(tab.pin))
        doc.diagnostics.push(
          err(
            'tab-stale',
            `${tab.path} has changed since it was pinned (#${tab.pin}, now #${full.slice(0, tab.pin.length)}); review it, then move the pin`,
            tab.line,
            1,
            { path: tab.path, pinned: tab.pin, actual: full.slice(0, tab.pin.length) },
          ),
        );
    }
    for (const b of tabsOf(part))
      part.diagnostics.push(
        err('tab-nested', `a part cannot hold tabs of its own; ${b.path} would be a tab inside a tab`, b.line, 1, { path: b.path }),
      );
    for (const { key, line, col } of pageKeyLines(src))
      part.diagnostics.push({
        severity: 'warning',
        code: 'tab-part-meta',
        message: `@${key} describes the whole page, so in the page of tabs the manifest's applies and this one is left out`,
        line,
        col,
        detail: { key, part: tab.path },
      });
    for (const f of fieldsOf(part.blocks)) {
      const owner = names.get(f.name);
      if (owner === undefined) names.set(f.name, tab.path);
      else
        part.diagnostics.push(
          err(
            'tab-field-clash',
            `${f.name} is already a question name in ${owner}; the tabs share one page, so rename one of them`,
            f.line,
            1,
            { name: f.name, other: owner },
          ),
        );
    }
    parts.push({ tab, label: tab.label ?? titleOf(part, tab.path), src, doc: part, sha });
  }
  return parts;
}
