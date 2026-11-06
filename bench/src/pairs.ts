// Builds blind pairwise comparison images for the visual-quality judge.
//   node bench/src/pairs.ts <round> [vs=B,A] [models=haiku,opus,...] [--dry]
// For every model × task, pairs C (Lede) against B (HTML) and against A (Markdown). The other arm's shots are looked
// for under the model's own directory first, then the model without its arm letter, then the writer: `sonnet-r6` meets
// `sonnet/B`, `sonnet-r7` meets `sonnet-r7/B`, and `sonnet-r7h` (hinted Lede) meets `sonnet-r7/B` too.
// Sides are randomized with a fixed seed (the round name); the answer key goes to results/judge/<round>/key.json,
// which judges never see. Images: out/pairs/<round>/P###-desktop.png (1280 light) and -phone.png (400 dark).
// --dry takes the pages in gen/ as the proof that a shot exists, lists the shots a real run would read, composes nothing,
// and writes the key to out/pairs/<round>/key.dry.json (byte for byte what key.json would be), so a key can be checked
// without Chromium or a render.
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { otherArmDirs } from './rounds.ts';

const ROOT = join(import.meta.dirname, '..');
const SHOTS = join(ROOT, 'out', 'main', 'shots');
const ROUND = process.argv[2] ?? 'round1';
const VS = (process.argv.find((a) => a.startsWith('vs='))?.slice(3) ?? 'B,A').split(',');
const MODELS = process.argv
  .find((a) => a.startsWith('models='))
  ?.slice(7)
  .split(',');
const DRY = process.argv.includes('--dry');
const OUT = join(ROOT, 'out', 'pairs', ROUND);
const KEYDIR = join(ROOT, 'results', 'judge', ROUND);
mkdirSync(OUT, { recursive: true });
if (!DRY) mkdirSync(KEYDIR, { recursive: true });

const EXT = { A: 'md', B: 'html', C: 'lede' } as const;
const shotPath = (dir: string, arm: string, id: string, suffix: string) => join(SHOTS, dir, arm, `${id}-${suffix}.png`);
/** A dry run cannot see shots (they are rendered, and not committed), so it asks whether the page they would come from exists. */
const has = (dir: string, arm: string, id: string) =>
  DRY ? existsSync(join(ROOT, 'gen', dir, arm, `${id}.${EXT[arm as keyof typeof EXT]}`)) : existsSync(shotPath(dir, arm, id, '1280-light'));

let seed = 20261016 + ROUND.length * 7919 + (ROUND.charCodeAt(ROUND.length - 1) || 0);
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

const idKey = (name: string) => /^\d+/.exec(name)![0].padStart(2, '0');
const ids = [...new Set(readdirSync(join(ROOT, 'tasks')).map(idKey))].sort((a, b) => Number(a) - Number(b));
const key: { pair: string; model: string; id: string; left: string; right: string; vs: string }[] = [];
let n = 0;
for (const model of MODELS ?? readdirSync(SHOTS).sort()) {
  const lookup = otherArmDirs(model);
  for (const id of ids) {
    for (const other of VS) {
      const otherDir = lookup.find((dir) => has(dir, other, id));
      if (!has(model, 'C', id) || otherDir === undefined) continue;
      const pair = `P${String(++n).padStart(3, '0')}`;
      const cLeft = rand() < 0.5;
      const [l, r] = cLeft ? ['C', other] : [other, 'C'];
      key.push({ pair, model, id, left: l, right: r, vs: `C-${other}` });
      for (const [view, suffix] of [
        ['desktop', '1280-light'],
        ['phone', '400-dark'],
      ] as const) {
        const li = shotPath(l === 'C' ? model : otherDir, l, id, suffix);
        const ri = shotPath(r === 'C' ? model : otherDir, r, id, suffix);
        if (DRY) {
          if (view === 'desktop') console.log(`${pair} ${model} ${id} LEFT ${li} RIGHT ${ri}`);
          continue;
        }
        execFileSync('python3', ['-I', join(import.meta.dirname, 'compose.py'), li, ri, join(OUT, `${pair}-${view}.png`), view]);
      }
    }
  }
}
writeFileSync(join(DRY ? OUT : KEYDIR, DRY ? 'key.dry.json' : 'key.json'), JSON.stringify(key, null, 1));
console.log(`${key.length} pairs${DRY ? ' (dry run: nothing composed)' : ''}`);
