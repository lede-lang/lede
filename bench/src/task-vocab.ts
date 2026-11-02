// The vocabulary of a held-out task (internal spec, lede-lang/meta), shared by check-tasks.ts and the tests that build task sets.

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
