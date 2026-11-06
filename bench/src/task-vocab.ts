// The vocabulary of a held-out task (internal spec, lede-lang/meta), shared by check-tasks.ts, check-probe.ts and the tests that build task sets.

/** The eleven categories in id order (five tasks each): the bench six, then the five of the article. */
export const CATEGORIES = [
  'architecture',
  'comparison',
  'data',
  'prose',
  'runbook',
  'status',
  'specs-planning',
  'code-review',
  'design',
  'reports',
  'custom-editing',
] as const;

/** The closed vocabulary of a task's `needs`. */
export const NEEDS = ['list', 'table', 'callout', 'chart', 'kpi', 'diagram', 'sequence'] as const;

/** A word a brief must not hold: it names a format, markup, framework or tool for building the page, and a brief says what the reader sees. */
export const TECHNOLOGY = /\b(Lede|HTML|CSS|Markdown|Mermaid|React|SVG|JavaScript)\b/;
