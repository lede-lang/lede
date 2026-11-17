// pnpm bench: the replication kit (bench/REPLICATE.md). Estimates, writes, measures and summarises a writer round with your own
// key. Nothing here judges pages.
import { fileURLToPath } from 'node:url';
import { runKit } from './kit/run.ts';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runKit(process.argv.slice(2), process.env, { out: (s) => console.log(s) });
}
