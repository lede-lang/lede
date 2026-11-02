// Counts the tokens of a text file, or of the slice of it that starts at one heading, with the count_tokens endpoint on
// claude-sonnet-5-5 (the writer tier the skill is most often loaded by), and prints one integer (internal spec, lede-lang/meta).
//   ANTHROPIC_API_KEY=... node bench/src/count-text.ts <file> [--from "## Heading"] [--to "## Heading"]
// An `ant auth login` token also works (ANTHROPIC_AUTH_TOKEN=$(ant auth print-credentials --access-token)); either way the org
// needs credit. Without --from or --to the whole file is counted, as recount.ts counts the references. --from starts the slice at
// the line that is exactly that heading (at the top of the file when it is left out) and ends it at the line that is exactly
// --to when it is given (that line is left out), else at the next heading of the same or a higher level, else at the end of the
// file. Lines inside code fences are never headings.
// count_tokens wraps the text in a user message, which adds a fixed number of tokens; counting "a", assumed to be one token on
// every tokenizer, measures that overhead, which is subtracted exactly as recount.ts does. Exit 2 on a usage error, a heading
// that is not in the file, or no credentials; 1 when the API refuses the count.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-5-5';
const USAGE = 'usage: node bench/src/count-text.ts <file> [--from "## Heading"] [--to "## Heading"]';
const NO_KEY = 'set ANTHROPIC_API_KEY, or ANTHROPIC_AUTH_TOKEN=$(ant auth print-credentials --access-token)';

const level = (line: string) => /^(#{1,6})\s/.exec(line)?.[1].length ?? 0;

/**
 * The lines from `from` up to, not including, `to` (else the next heading of the same or a higher level, else the end), as the
 * text of a file: lines joined by newlines with one at the end. Returns a message when a heading is not found.
 */
export function slice(text: string, from?: string, to?: string): string | { error: string } {
  const lines = text.split('\n');
  // A line inside a code fence is code, whatever it starts with.
  let fence = '';
  const outside = lines.map((l) => {
    const m = /^\s*(```+|~~~+)/.exec(l);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = '';
      return false;
    }
    return !fence;
  });
  const start = from === undefined ? 0 : lines.findIndex((l, i) => outside[i] && l.trimEnd() === from.trimEnd());
  if (start < 0) return { error: `no line "${from}" in the file` };
  let end = lines.length;
  if (to !== undefined) {
    const at = lines.findIndex((l, i) => (from === undefined || i > start) && outside[i] && l.trimEnd() === to.trimEnd());
    if (at < 0) return { error: `no line "${to}"${from === undefined ? '' : ` after "${from}"`}` };
    end = at;
  } else {
    const own = level(from ?? '');
    for (let i = start + 1; i < lines.length; i++)
      if (outside[i] && level(lines[i]) > 0 && (own === 0 || level(lines[i]) <= own)) {
        end = i;
        break;
      }
  }
  return `${lines.slice(start, end).join('\n').replace(/\n+$/, '')}\n`;
}

export async function main(argv: string[]): Promise<number> {
  const args: string[] = [];
  let from: string | undefined;
  let to: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') from = argv[++i];
    else if (argv[i] === '--to') to = argv[++i];
    else args.push(argv[i]);
  }
  const bad = (msg: string) => {
    process.stderr.write(`${msg}\n`);
    return 2;
  };
  if (args.length !== 1 || (argv.includes('--from') && !from) || (argv.includes('--to') && !to)) return bad(USAGE);
  let text: string;
  try {
    text = readFileSync(args[0], 'utf8');
  } catch (e) {
    return bad(`${args[0]}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (from !== undefined || to !== undefined) {
    const part = slice(text, from, to);
    if (typeof part !== 'string') return bad(`${args[0]}: ${part.error}`);
    text = part;
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return bad(NO_KEY);

  const client = new Anthropic();
  const countRaw = async (s: string) =>
    (await client.messages.countTokens({ model: MODEL, messages: [{ role: 'user', content: s }] })).input_tokens;
  try {
    const [overhead, raw] = await Promise.all([countRaw('a').then((n) => n - 1), countRaw(text)]);
    process.stdout.write(`${raw - overhead}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`count_tokens failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main(process.argv.slice(2));
