// Builds blind pairwise comparison images for the visual-quality judge.
//   node bench/src/pairs.ts <round> [vs=B,A] [models=haiku,opus,...]
// A model like `haiku-r3` is compared against the `haiku` outputs of the other arms.
// For every model × task, pairs C (Lede) against B (HTML) and against A (Markdown).
// Sides are randomized with a fixed seed; the answer key goes to results/pairs-key.json,
// which judges never see. Images: out/pairs/P###-desktop.png (1280 light) and -phone.png (400 dark).
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const SHOTS = join(ROOT, 'out', 'main', 'shots');
const ROUND = process.argv[2] ?? 'round1';
const VS = (process.argv.find((a) => a.startsWith('vs='))?.slice(3) ?? 'B,A').split(',');
const MODELS = process.argv
  .find((a) => a.startsWith('models='))
  ?.slice(7)
  .split(',');
const OUT = join(ROOT, 'out', 'pairs', ROUND);
const KEYDIR = join(ROOT, 'results', 'judge', ROUND);
mkdirSync(OUT, { recursive: true });
mkdirSync(KEYDIR, { recursive: true });

let seed = 20261016 + ROUND.length * 7919 + (ROUND.charCodeAt(ROUND.length - 1) || 0);
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

const idKey = (name: string) => /^\d+/.exec(name)![0].padStart(2, '0');
const ids = [...new Set(readdirSync(join(ROOT, 'tasks')).map(idKey))].sort((a, b) => Number(a) - Number(b));
const key: { pair: string; model: string; id: string; left: string; right: string; vs: string }[] = [];
let n = 0;
for (const model of MODELS ?? readdirSync(SHOTS).sort()) {
  const base = model.replace(/-r\d+$/, '');
  for (const id of ids) {
    for (const other of VS) {
      const c = join(SHOTS, model, 'C', `${id}-1280-light.png`);
      const o = join(SHOTS, base, other, `${id}-1280-light.png`);
      if (!existsSync(c) || !existsSync(o)) continue;
      const pair = `P${String(++n).padStart(3, '0')}`;
      const cLeft = rand() < 0.5;
      const [l, r] = cLeft ? ['C', other] : [other, 'C'];
      key.push({ pair, model, id, left: l, right: r, vs: `C-${other}` });
      for (const [view, suffix] of [
        ['desktop', '1280-light'],
        ['phone', '400-dark'],
      ] as const) {
        const li = join(SHOTS, l === 'C' ? model : base, l, `${id}-${suffix}.png`);
        const ri = join(SHOTS, r === 'C' ? model : base, r, `${id}-${suffix}.png`);
        execFileSync('python3', ['-I', join(import.meta.dirname, 'compose.py'), li, ri, join(OUT, `${pair}-${view}.png`), view]);
      }
    }
  }
}
writeFileSync(join(KEYDIR, 'key.json'), JSON.stringify(key, null, 1));
console.log(`${key.length} pairs`);
