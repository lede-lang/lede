// The replication kit: estimate, write (one request per task and arm), measure, summarise.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ARMS, BENCH, UsageError, parseArms, promptText, sha256, writerMessage, type Arm } from './arms.ts';
import { PRELOADED_CSS, measure, stripFence } from './measure.ts';
import {
  DEFAULT_BASE,
  FatalProviderError,
  TransportError,
  createProvider,
  keyFor,
  keyNamesHint,
  type Provider,
  type ProviderKind,
} from './provider.ts';
import { DEFAULT_CHARS_PER_TOKEN, defaultOutputEstimates, estimate, formatEstimate, usd } from './estimate.ts';
import { NAMED_SETS, loadTasks, parseTaskSpec, taskSetHash, type Task } from './tasks.ts';

export const USAGE = `usage: pnpm bench [run] [options]      write, measure and summarise (a dry run when no key is set)
       pnpm bench measure --out DIR      re-measure the pages a run saved (no model, no network)

  --provider anthropic|openai-compatible   default anthropic
  --base-url URL                           default ${DEFAULT_BASE.anthropic} (anthropic) or ${DEFAULT_BASE['openai-compatible']} (openai-compatible)
  --model ID                               the writer model id, as the provider names it (required for a real run)
  --arms A,B,C,D,E                         default B,C   (A markdown, B html, C lede 0.5, D html over preloaded css, E json ui)
  --tasks SET                              ${Object.keys(NAMED_SETS).join(' | ')} | N | N-M | comma list; default retired (101-130). Tasks 131-185 are sealed and always refused
  --cap USD                                hard spend limit; required for a real run
  --price-in USD --price-out USD           your price per million input and output tokens (required for a real run)
  --max-tokens N                           output limit per request (default 16000)
  --est-out B=3000,C=500                   override the expected output tokens per page used by the estimate
  --chars-per-token X                      input estimate: characters per token (default ${DEFAULT_CHARS_PER_TOKEN})
  --max-tokens-field NAME                  chat completions: the limit's parameter name (default max_completion_tokens on api.openai.com, else max_tokens)
  --dry-run                                print the estimate and stop; the default when no key is set
  --out DIR                                default bench/out/replicate/<date>-<model>
keys (environment only; never printed or written): ANTHROPIC_API_KEY (https://api.anthropic.com only) | OPENAI_API_KEY (https://api.openai.com only) | LEDE_BENCH_API_KEY (any other host)`;

export interface IO {
  out(s: string): void;
}
export { UsageError };

const OPTIONS = {
  provider: { type: 'string' },
  'base-url': { type: 'string' },
  model: { type: 'string' },
  arms: { type: 'string' },
  tasks: { type: 'string' },
  cap: { type: 'string' },
  'price-in': { type: 'string' },
  'price-out': { type: 'string' },
  'max-tokens': { type: 'string' },
  'est-out': { type: 'string' },
  'chars-per-token': { type: 'string' },
  'max-tokens-field': { type: 'string' },
  'dry-run': { type: 'boolean' },
  out: { type: 'string' },
  help: { type: 'boolean' },
} as const;

const num = (name: string, v: string | undefined, integer = false): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n)))
    throw new UsageError(`--${name} must be a positive ${integer ? 'whole number' : 'number'}, got "${v}"`);
  return n;
};

/**
 * Input tokens a message can cost at most, for the cap: a byte-level tokenizer never makes more tokens than the UTF-8 bytes, plus a
 * margin for the message framing. The chars-per-token estimate is for the printed figure only; the cap never leans on it.
 */
const maxInputTokens = (message: string) => Buffer.byteLength(message) + 64;

export interface Row {
  arm: string;
  id: string;
  category: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  truncated: boolean;
  fenceStripped: boolean;
  usageMissing: boolean;
  costUsd: number;
  error?: string;
  valid?: boolean;
  problems?: string[];
  warnings?: number;
  buildOk?: boolean;
  srcBytes?: number;
  pageBytes?: number | null;
  file?: string;
}

function gitState(): { commit: string; dirty: boolean } {
  try {
    const run = (a: string[]) => execFileSync('git', a, { cwd: BENCH, encoding: 'utf8' }).trim();
    return { commit: run(['rev-parse', 'HEAD']), dirty: run(['status', '--porcelain']) !== '' };
  } catch {
    return { commit: 'unknown', dirty: false };
  }
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'model';
const median = (v: number[]) => {
  const s = v.toSorted((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (v: number[]) => (v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length);

/** The summary table: per arm, validity, build, tokens, bytes and the ratio of its tokens to the HTML arm's on the same tasks. */
export function summarise(rows: Row[], arms: Arm[]): string {
  const ok = (r: Row) => r.error === undefined && r.outputTokens !== null;
  const htmlByTask = new Map(rows.filter((r) => r.arm === 'B' && ok(r)).map((r) => [r.id, r.outputTokens!]));
  const lines = ['arm  n   valid  built  out-tok mean  median  bytes mean  ratio to B  truncated  errors'];
  for (const a of arms) {
    const rs = rows.filter((r) => r.arm === a.letter);
    const done = rs.filter((r) => r.error === undefined);
    const toks = done.filter(ok).map((r) => r.outputTokens!);
    const paired = done.filter((r) => ok(r) && htmlByTask.has(r.id));
    const ratio =
      a.letter === 'B'
        ? 1
        : paired.length === 0
          ? null
          : paired.reduce((s, r) => s + r.outputTokens!, 0) / paired.reduce((s, r) => s + htmlByTask.get(r.id)!, 0);
    const f = (v: number | null, d = 0) => (v === null ? '-' : v.toFixed(d));
    lines.push(
      [
        a.letter.padEnd(4),
        String(rs.length).padEnd(3),
        `${done.filter((r) => r.valid).length}/${done.length}`.padEnd(6),
        `${done.filter((r) => r.buildOk).length}/${done.length}`.padEnd(6),
        f(mean(toks)).padEnd(13),
        f(median(toks)).padEnd(7),
        f(mean(done.map((r) => r.srcBytes ?? 0))).padEnd(11),
        (ratio === null ? '-' : `${ratio.toFixed(3)} (n=${paired.length})`).padEnd(11),
        String(done.filter((r) => r.truncated).length).padEnd(10),
        String(rs.length - done.length),
      ].join(' '),
    );
  }
  lines.push(
    "ratio to B = sum of this arm's output tokens over the sum of arm B's, on tasks both finished. Tokens are the provider's own usage.",
  );
  return lines.join('\n');
}

export async function runKit(
  argv: string[],
  env: Record<string, string | undefined>,
  io: IO,
  deps: { provider?: Provider } = {},
): Promise<number> {
  const say = (s: string) => {
    // Belt and braces: no line leaves this function with a key in it.
    let line = s;
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'LEDE_BENCH_API_KEY']) {
      const v = env[k];
      if (v !== undefined && v.length >= 8) line = line.split(v).join('[redacted]');
    }
    io.out(line);
  };
  try {
    let args = argv;
    let sub = 'run';
    if (args[0] === 'run' || args[0] === 'measure') {
      sub = args[0];
      args = args.slice(1);
    }
    const { values: v } = parseArgs({ args, options: OPTIONS, allowPositionals: false });
    if (v.help) {
      say(USAGE);
      return 0;
    }
    if (sub === 'measure') return await remeasure(v.out, say);

    const kind = (v.provider ?? 'anthropic') as ProviderKind;
    if (kind !== 'anthropic' && kind !== 'openai-compatible')
      throw new UsageError(`--provider must be anthropic or openai-compatible, got "${String(kind)}"`);
    const baseUrl = v['base-url'] ?? DEFAULT_BASE[kind];
    try {
      void new URL(baseUrl).host;
    } catch {
      throw new UsageError(`--base-url is not a URL: "${baseUrl}"`);
    }
    const arms = parseArms(v.arms ?? 'B,C');
    const ids = parseTaskSpec(v.tasks ?? 'retired');
    const tasksDir = join(BENCH, 'tasks');
    const tasks: Task[] = loadTasks(tasksDir, ids);
    const maxTokens = num('max-tokens', v['max-tokens'], true) ?? 16000;
    const priceIn = num('price-in', v['price-in']);
    const priceOut = num('price-out', v['price-out']);
    const cap = num('cap', v.cap);
    const cpt = num('chars-per-token', v['chars-per-token']) ?? DEFAULT_CHARS_PER_TOKEN;

    const dflt = defaultOutputEstimates();
    const perArm = { ...dflt.perArm };
    let source = dflt.source;
    if (v['est-out'] !== undefined) {
      for (const kv of v['est-out'].split(',')) {
        const m = /^([A-E])=(\d+)$/i.exec(kv.trim());
        if (!m) throw new UsageError(`--est-out wants arm=tokens pairs like B=3000,C=500, got "${kv}"`);
        perArm[m[1].toUpperCase()] = Number(m[2]);
      }
      source += ' with --est-out overrides';
    }
    const messages = new Map<string, string[]>(arms.map((a) => [a.letter, tasks.map((t) => writerMessage(a, t.brief))]));
    const est = estimate({ arms, messages, outputPerArm: perArm, outputSource: source, maxTokens, priceIn, priceOut, charsPerToken: cpt });
    const priced = priceIn !== undefined && priceOut !== undefined;

    const key = keyFor(kind, baseUrl, env);
    const dry = v['dry-run'] === true || (key === null && deps.provider === undefined);
    say(
      `${dry ? 'dry run' : 'real run'}: provider ${kind}, model ${v.model ?? '(not set)'}, ${tasks.length} tasks (${v.tasks ?? 'retired'}), arms ${arms.map((a) => a.letter).join(',')}`,
    );
    if (dry && v['dry-run'] !== true) say(`no key set (${keyNamesHint(kind)}): nothing will be sent`);
    say(formatEstimate(est, priced));

    if (dry) {
      if (v.out !== undefined) {
        mkdirSync(resolve(v.out), { recursive: true });
        writeFileSync(join(resolve(v.out), 'estimate.json'), JSON.stringify(est, null, 1));
      }
      say('dry run: no request was made and no key was used.');
      return 0;
    }

    // A real run needs all of these, and the estimate has to fit the cap before the first request.
    if (v.model === undefined) throw new UsageError('a real run needs --model');
    if (cap === undefined) throw new UsageError('a real run needs --cap USD (the hard spend limit)');
    if (!priced) throw new UsageError('a real run needs --price-in and --price-out (USD per million tokens; the kit has no price table)');
    const expectedUsd = est.expectedUsd ?? 0;
    const worstUsd = est.worstCaseUsd ?? 0;
    if (expectedUsd > cap) {
      say(
        `refused: the estimate $${expectedUsd.toFixed(2)} is over --cap $${cap.toFixed(2)}. Nothing was sent. Reduce --tasks or --arms, or raise the cap.`,
      );
      return 2;
    }
    if (worstUsd > cap)
      say(`note: the worst case $${worstUsd.toFixed(2)} is over --cap; the run stops, or shortens a reply, rather than pass the cap.`);

    const provider =
      deps.provider ?? createProvider({ kind, baseUrl: v['base-url'], model: v.model, env, maxTokensField: v['max-tokens-field'] });
    const outDir = resolve(v.out ?? join(BENCH, 'out', 'replicate', `${new Date().toISOString().slice(0, 10)}-${slug(v.model)}`));
    mkdirSync(outDir, { recursive: true });
    const rowsFile = join(outDir, 'rows.jsonl');
    const rows: Row[] = existsSync(rowsFile)
      ? readFileSync(rowsFile, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Row)
      : [];
    let spent = rows.reduce((s, r) => s + r.costUsd, 0);
    if (rows.length > 0)
      say(`resuming: ${rows.length} rows already in ${outDir} (${spent.toFixed(4)} USD already spent); they are not asked again`);

    let stopped: string | null = null;
    outer: for (const task of tasks) {
      for (const arm of arms) {
        if (rows.some((r) => r.arm === arm.letter && r.id === task.id)) continue;
        const prompt = writerMessage(arm, task.brief);
        const inMax = maxInputTokens(prompt);
        // The largest reply this call may be allowed so that, even at that length and the largest possible input, the cap holds.
        const room = Math.floor(((cap - spent - (inMax * priceIn) / 1e6) * 1e6) / priceOut);
        const limit = Math.min(maxTokens, room);
        if (limit < 500) {
          stopped = `stopped before ${arm.letter}/${task.id}: $${spent.toFixed(4)} spent of the $${cap.toFixed(2)} cap leaves no room for a page`;
          break outer;
        }
        const row: Row = {
          arm: arm.letter,
          id: task.id,
          category: task.category,
          model: v.model,
          inputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          truncated: false,
          fenceStripped: false,
          usageMissing: false,
          costUsd: 0,
        };
        try {
          const c = await provider.complete(prompt, limit);
          row.model = c.model;
          row.inputTokens = c.inputTokens;
          row.outputTokens = c.outputTokens;
          row.reasoningTokens = c.reasoningTokens;
          row.truncated = c.truncated;
          row.usageMissing = c.inputTokens === null || c.outputTokens === null;
          // No usage in the reply: charge the worst case, so the cap still holds.
          row.costUsd = usd(c.inputTokens ?? inMax, c.outputTokens ?? limit, priceIn, priceOut);
          const { text, stripped } = stripFence(c.text);
          row.fenceStripped = stripped;
          const file = posix.join('pages', arm.letter, `${task.id}.${arm.ext}`);
          mkdirSync(join(outDir, 'pages', arm.letter), { recursive: true });
          writeFileSync(join(outDir, file), text);
          row.file = file;
          Object.assign(row, await measure(arm, text));
        } catch (e) {
          const fromProvider = e instanceof FatalProviderError || e instanceof TransportError;
          row.error = fromProvider ? e.message : `unexpected: ${(e as Error).message.slice(0, 200)}`;
          // A request that may have reached the provider is charged as if it wrote max tokens, so the cap still holds.
          if (fromProvider && e.maybeBilled) row.costUsd = usd(inMax, limit, priceIn, priceOut);
          if (e instanceof FatalProviderError) stopped = `stopped: ${e.message}`;
        }
        spent += row.costUsd;
        // A fatal error on a request that never reached the provider leaves no row, so a fixed rerun asks that task again.
        if (stopped === null || row.costUsd > 0) {
          rows.push(row);
          appendFileSync(rowsFile, `${JSON.stringify(row)}\n`);
          say(
            `${arm.letter}/${task.id} ${row.error ?? `in=${String(row.inputTokens)} out=${String(row.outputTokens)} valid=${String(row.valid)}`} spent=$${spent.toFixed(4)}`,
          );
        }
        if (stopped !== null) break outer;
      }
    }
    if (stopped !== null) say(stopped);

    const returned = [...new Set(rows.map((r) => r.model))];
    const git = gitState();
    const results = {
      kit: 'lede-bench-replicate',
      kitVersion: 1,
      date: new Date().toISOString(),
      commit: git.commit,
      worktreeDirty: git.dirty,
      provider: kind,
      baseUrl: provider.baseUrl,
      requestedModel: v.model,
      returnedModels: returned,
      prices: { inUsdPerMTok: priceIn, outUsdPerMTok: priceOut },
      capUsd: cap,
      spentUsd: Number(spent.toFixed(6)),
      stoppedEarly: stopped,
      maxTokens,
      tokenCounts: "the provider's own usage fields (outputTokens includes reasoning tokens where the provider counts them)",
      tasks: { spec: v.tasks ?? 'retired', ids: tasks.map((t) => t.id), sha256: taskSetHash(tasksDir, tasks) },
      arms: arms.map((a) => ({
        arm: a.letter,
        prompt: `prompts/${a.file}`,
        promptSha256: sha256(promptText(a)),
        promptChars: promptText(a).length,
      })),
      preloadedCssSha256: arms.some((a) => a.letter === 'D') ? sha256(readFileSync(PRELOADED_CSS)) : undefined,
      estimate: est,
      rows,
    };
    writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 1));
    say(summarise(rows, arms));
    say(
      `spend: $${spent.toFixed(4)} of the $${cap.toFixed(2)} cap (${rows.length} requests recorded). Results: ${join(outDir, 'results.json')}`,
    );
    return stopped?.startsWith('stopped: ') ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError || e instanceof FatalProviderError || (e as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      say(`error: ${(e as Error).message}`);
      say(USAGE);
      return 2;
    }
    throw e;
  }
}

async function remeasure(out: string | undefined, say: (s: string) => void): Promise<number> {
  if (out === undefined) throw new UsageError('measure needs --out DIR (a directory a run wrote)');
  const dir = resolve(out);
  const file = join(dir, 'results.json');
  if (!existsSync(file)) throw new UsageError(`no results.json in ${dir}`);
  const results = JSON.parse(readFileSync(file, 'utf8')) as { rows: Row[]; arms: { arm: string }[] };
  for (const r of results.rows) {
    if (r.file === undefined) continue;
    // A results file is data a stranger may hand you: only a page under pages/ is ever read.
    const arm = ARMS[r.arm];
    if (arm === undefined || r.file !== posix.join('pages', arm.letter, `${r.id}.${arm.ext}`))
      throw new UsageError(`unexpected arm or page path in results.json: ${r.arm} ${r.file}`);
    Object.assign(r, await measure(arm, readFileSync(join(dir, r.file), 'utf8')));
  }
  writeFileSync(file, JSON.stringify(results, null, 1));
  say(
    summarise(
      results.rows,
      results.arms.map((a) => ARMS[a.arm]),
    ),
  );
  return 0;
}
