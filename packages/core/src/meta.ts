// Meta keys that take a list (spec §4.3, D80). The parser keeps what a list key says as text in `doc.meta`, one key each, so a page
// still being streamed carries it like any other meta; the renderer reads the text back with these functions, so what the parser
// warned about is exactly what the renderer drops. `@status` is a page's own status words, `@meta` its facts.

/** The tones of a status chip: the renderer's five. `neutral` is grey. */
export const STATUS_TONES = ['good', 'warn', 'bad', 'info', 'neutral'] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

const isTone = (s: string): s is StatusTone => (STATUS_TONES as readonly string[]).includes(s);

/** How a status word is matched, like the built-in lexicon: lower case, runs of white space as one space. */
export const statusKey = (word: string): string => word.trim().replace(/\s+/g, ' ').toLowerCase();

export interface StatusRead {
  /** The valid `word=tone` entries, in order; the word with its spaces collapsed, the tone lower case. */
  entries: [word: string, tone: StatusTone][];
  /** The entries that are not valid, as written: an empty word, or a tone that is none of `STATUS_TONES` (`''` when there is no `=`). */
  bad: { word: string; tone: string }[];
}

/**
 * Reads the value of an `@status` line: `Word=tone, Other word=tone`. The tone follows the last `=`, so a word may hold one. Empty
 * entries (a trailing comma) are skipped. A repeated word keeps its last tone when the entries are made a map.
 */
export function readStatus(value: string): StatusRead {
  const entries: StatusRead['entries'] = [];
  const bad: StatusRead['bad'] = [];
  for (const part of value.split(',')) {
    if (part.trim() === '') continue;
    const eq = part.lastIndexOf('=');
    const word = (eq < 0 ? part : part.slice(0, eq)).trim().replace(/\s+/g, ' ');
    const tone = eq < 0 ? '' : part.slice(eq + 1).trim();
    if (word !== '' && isTone(tone.toLowerCase())) entries.push([word, tone.toLowerCase() as StatusTone]);
    else bad.push({ word, tone });
  }
  return { entries, bad };
}

/** One `@meta Key | value` fact, or null when the `|` or either side of it is missing. The value may hold more `|`. */
export function readFact(line: string): [key: string, value: string] | null {
  const bar = line.indexOf('|');
  if (bar < 0) return null;
  const key = line.slice(0, bar).trim();
  const value = line.slice(bar + 1).trim();
  return key !== '' && value !== '' ? [key, value] : null;
}

/** The `@meta` facts of a document's meta, in order: the parser keeps one valid fact per line of `meta.meta`. */
export const factEntries = (meta: Readonly<Record<string, string | undefined>>): [key: string, value: string][] =>
  (meta.meta ?? '').split('\n').flatMap((line) => {
    const fact = readFact(line);
    return fact ? [fact] : [];
  });

/** The name of a fact's `<meta name="lede:NAME">` tag: lower case, each run of other characters one `-`; `''` when nothing is left. */
export const factName = (key: string): string =>
  key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
