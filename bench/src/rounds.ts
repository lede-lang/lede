// Names the benchmark scripts share: how a generated-page directory such as `sonnet-r7h` maps to the model that wrote it
// and to the directories that hold the other arm's pages (internal spec, lede-lang/meta).
//   sonnet-r7h  ->  sonnet-r7  (without its arm letter)  ->  sonnet  (the writer)

/** `sonnet-r7h` -> `sonnet-r7`: drops the arm letter a variant of a round carries (`h` is the hinted Lede arm). */
export const withoutArmLetter = (model: string): string => model.replace(/-r(\d+)[a-z]$/, '-r$1');

/** `sonnet-r7h` -> `sonnet`: the writer, which is also the directory of its HTML baseline and the key into the price table. */
export const writerOf = (model: string): string => withoutArmLetter(model).replace(/-r\d+$/, '');

/**
 * Where to look for the other arm's pages of a model, nearest first: the model's own directory, the same without its arm
 * letter (`sonnet-r7h` pairs with the revised HTML in `sonnet-r7/B`), then the writer's (`sonnet-r6` pairs with `sonnet/B`).
 */
export const otherArmDirs = (model: string): string[] => [...new Set([model, withoutArmLetter(model), writerOf(model)])];

/**
 * `--rows <name>` reads `results/<name>.json` and writes `results/recount-<round>.json`, where the round is the name
 * without its `raw-` prefix (`--rows raw-refine1` writes `recount-refine1.json`, the file name the round's report and
 * scorer use). With no flag the published v0.4 recount is reproduced: `results/raw-v04.json` to `results/recount-v04.json`.
 */
export function recountFiles(argv: string[]): { rows: string; out: string } {
  const at = argv.indexOf('--rows');
  if (at < 0) return { rows: 'raw-v04.json', out: 'recount-v04.json' };
  const name = argv[at + 1];
  if (name === undefined || !/^[A-Za-z0-9][\w.-]*$/.test(name))
    throw new Error('usage: recount.ts [--rows <name>]  (a name like raw-refine1)');
  return { rows: `${name}.json`, out: `recount-${name.replace(/^raw-/, '')}.json` };
}
