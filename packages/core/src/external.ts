// What a page gives away (D80, `lede check --external`). A pure scan of the source text, line by line: URLs, IP addresses, host
// names, account ids, credentials and email addresses, wherever they sit (prose, meta, fences, data rows, diagram lines), since the
// reader of a page that leaves the building sees all of it. Nothing here parses Lede, so the scan cannot be fooled by the parser's
// idea of a block, and it works on the file as written.
//
// Every pattern is linear in the line: a global regex whose quantified classes are disjoint from what follows them, and a
// look-behind that lets a match start only at the start of a run, so a 200,000-character line costs one pass and not one per start.
// Anything a regex cannot settle in one pass (a bracket count, a digit in a token) is judged in code on the text it matched.
import type { Diagnostic } from './ast.ts';
import { parse, type ParseOptions } from './parser.ts';
import { browserUrl } from './url.ts';

export type ExternalKind = 'url' | 'ip' | 'host' | 'account' | 'key' | 'email';

/** What `redactExternal` writes in place of a finding. */
export const EXTERNAL_PLACEHOLDERS: Readonly<Record<ExternalKind, string>> = {
  url: '<url>',
  ip: '<ip>',
  host: '<host>',
  account: '<account>',
  key: '<key>',
  email: '<email>',
};

export interface ExternalFinding {
  kind: ExternalKind;
  /** The text as written. For a PEM private key it is the header line, and the span runs on to the matching END line. */
  text: string;
  /** 1-based, like a diagnostic's. */
  line: number;
  col: number;
  /** The span `src.slice(start, end)` that `redactExternal` replaces. */
  start: number;
  end: number;
  /**
   * The credentials in the span, as written: the finding's own text for a `key`, and any key a longer finding swallowed (a URL with
   * `?key=AKIA...`). A report masks each of them with `maskSecrets`.
   */
  secrets: string[];
}

export interface ExternalOptions {
  /** Host names and IP literals to leave alone, with the URLs on them (compared in lower case, whole). */
  allow?: readonly string[];
}

export interface ExternalRepair {
  line: number;
  kind: ExternalKind;
  text: string;
  placeholder: string;
  /** What `lede check --fix` prints after the line number and `[external]`. */
  note: string;
}

// ---------------------------------------------------------------------------------------------------------------------------
// What counts as a host name

/** A dotted name ending in one of these (lower case) is a host: a short list, because a long one makes `main.py` and `logo.ai` hosts. */
const PUBLIC_SUFFIXES = new Set([
  'com',
  'net',
  'org',
  'edu',
  'gov',
  'mil',
  'io',
  'dev',
  'app',
  'ai',
  'co',
  'cloud',
  'biz',
  'us',
  'uk',
  'eu',
  'de',
]);
/** Suffixes that only ever name somebody's own network. */
const INTERNAL_SUFFIXES = new Set(['internal', 'local', 'corp', 'lan', 'intra']);
/** The names RFC 2606 reserves for documentation, and every name under them: a page may show them. Lower case. */
const DOC_NAMES = ['example.com', 'example.org', 'example.net', 'example', 'test', 'invalid'];
const isDocHost = (host: string): boolean => DOC_NAMES.some((d) => host === d || host.endsWith(`.${d}`));

/** The documentation ranges of RFC 5737 (IPv4) and RFC 3849 (IPv6, tested on the groups). */
const DOC_V4 = /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\./;

// ---------------------------------------------------------------------------------------------------------------------------
// Patterns

const URL_CHARS = '[^\\s<>"\'`,;|]';
const SCHEME_URL = new RegExp(`(?<![A-Za-z0-9])(?:https?|ftp|s3)://${URL_CHARS}+`, 'gi');
const WWW_URL = new RegExp(`(?<![A-Za-z0-9.@-])www\\.${URL_CHARS}+`, 'gi');
const WWW_HOST = /^www\.[A-Za-z0-9-]+\.[A-Za-z0-9-]+/i;

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const V4 = new RegExp(`(?<![\\w.])(?:${OCTET}\\.){3}${OCTET}(?:/(?:3[0-2]|[12]?\\d))?(?!\\w|\\.\\d)`, 'g');
// Hex and colons from the start of a run, with a colon in it: the groups are judged in `ipv6`.
const V6 = /(?<![\w:.])(?=[0-9A-Fa-f]*:)[0-9A-Fa-f:]{2,}(?:\/\d{1,3})?(?!\w|\.\d)/g;

// Letters of any script, so that `mañana.com` is one name and not `ana.com`.
const RUN = /[\p{L}\p{N}_.-]+/gu;

const AWS_ACCOUNT = /(?<![A-Za-z0-9+]|\d[.,]|[0-9A-Fa-f]{4}-)\d{12}(?![A-Za-z0-9]|[.,]\d)/g;
/** YYYYMMDDhhmm: twelve digits that are a time stamp and not an account. */
const STAMP = /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:[01]\d|2[0-3])[0-5]\d$/;
const ARN = /(?<![A-Za-z0-9_-])arn:aws[A-Za-z-]*:[A-Za-z0-9-]+:[A-Za-z0-9-]*:[A-Za-z0-9-]*:[^\s<>"'`,;|\\]+/g;
const GUID = /(?<![0-9A-Fa-f-])[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}(?![0-9A-Fa-f-])/g;
const GCP_PROJECT = /\bprojects?(?:[ _-]?(?:number|num|no|id))?(?:\s+is)?[\s:="'#/(]+(\d{10,13})(?!\d)/gi;

/** Credentials with a shape of their own. */
const KEYS: readonly RegExp[] = [
  /(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g,
  /(?<![A-Za-z0-9])xox[abeoprs]-[A-Za-z0-9-]{10,}/g,
  /(?<![A-Za-z0-9_])[sr]k_live_[A-Za-z0-9]{16,}/g,
  /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];
/** `sk-` and a long token: judged in `looksRandom`, since `sk-learn-the-whole-pipeline` is not a key. */
const OPENAI_KEY = /(?<![A-Za-z0-9_-])sk-([A-Za-z0-9_-]{20,})/g;
const PEM_HEADER = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g;
/** A word that says a secret follows, some more of the name, a separator, and the value. The separator class shares no character with the value's. */
const KEYED_VALUE = /(?:key|secret|token|passw(?:or)?d|pwd)[A-Za-z0-9_-]{0,20}[\s:="'(]+([A-Za-z0-9+/_-]{32,}={0,2})/gi;

// ---------------------------------------------------------------------------------------------------------------------------
// The scan

interface Hit {
  kind: ExternalKind;
  start: number;
  end: number;
  /** Where the finding's text ends when that is not `end` (a PEM block). */
  textEnd?: number;
}

/** Longer spans win an overlap; equal spans go to the kind that says more. */
const PRIORITY: Readonly<Record<ExternalKind, number>> = { key: 0, url: 1, email: 2, account: 3, ip: 4, host: 5 };

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isLocal = (c: string): boolean =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || isDigit(c) || c === '.' || c === '_' || c === '%' || c === '+' || c === '-';
const isDomain = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || isDigit(c) || c === '.' || c === '-';

/** The end of `s[from..to)` after the punctuation that closes a sentence or a link is taken off it. A `)` stays if the text opened one. */
function trimTail(s: string, from: number, to: number): number {
  let open = 0;
  let close = 0;
  let openSq = 0;
  let closeSq = 0;
  for (let i = from; i < to; i++) {
    const c = s[i];
    if (c === '(') open++;
    else if (c === ')') close++;
    else if (c === '[') openSq++;
    else if (c === ']') closeSq++;
  }
  let end = to;
  while (end > from) {
    const c = s[end - 1];
    if ('.:!?*_~'.includes(c)) end--;
    else if (c === ')' && close > open) {
      close--;
      end--;
    } else if (c === ']' && closeSq > openSq) {
      closeSq--;
      end--;
    } else break;
  }
  return end;
}

/**
 * The host a URL names (lower case, no port or brackets), and whether it carries credentials before the `@`. It reads the URL the
 * browser loads (`browserUrl`), so `https://a.com\@b.com/` is a.com with no credentials, as url.ts judges an image's src. The authority
 * is cut out by hand and not by `new URL`, whose `hostname` is the punycode form: `mañana.com` must meet `--allow` as written.
 */
function urlHost(url: string): { host: string; userinfo: boolean } {
  let s = browserUrl(url).replace(/^[A-Za-z0-9]+:\/\//, '');
  const cut = s.search(/[/?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  const at = s.lastIndexOf('@');
  if (at >= 0) s = s.slice(at + 1);
  if (s.startsWith('[')) s = s.slice(1, Math.max(1, s.indexOf(']')));
  else {
    const colon = s.lastIndexOf(':');
    if (colon >= 0 && /^\d*$/.test(s.slice(colon + 1))) s = s.slice(0, colon);
  }
  return { host: s.toLowerCase().replace(/\.$/, ''), userinfo: at >= 0 };
}

/** The groups of an IPv6 literal (no prefix length), or null when `s` is not one. It needs a digit: `Dec::Face` is a name. */
function ipv6(s: string): { doc: boolean } | null {
  if (!/\d/.test(s)) return null;
  const dbl = s.indexOf('::');
  if (dbl !== s.lastIndexOf('::')) return null;
  const head = (dbl < 0 ? s : s.slice(0, dbl)).split(':');
  const tail = dbl < 0 ? [] : s.slice(dbl + 2).split(':');
  if (dbl >= 0) {
    if (head.length === 1 && head[0] === '') head.length = 0;
    if (tail.length === 1 && tail[0] === '') tail.length = 0;
  }
  const groups = [...head, ...tail];
  if (!groups.every((g) => g.length >= 1 && g.length <= 4 && /^[0-9A-Fa-f]+$/.test(g))) return null;
  if (dbl < 0 ? groups.length !== 8 : groups.length > 7) return null;
  return { doc: head.length >= 2 && Number.parseInt(head[0], 16) === 0x2001 && Number.parseInt(head[1], 16) === 0xdb8 };
}

/** Hex of 32 or more, or a token that mixes digits, upper and lower case: what a generated secret looks like, and a name does not. */
function looksRandom(v: string, hexOk: boolean): boolean {
  const bare = v.replace(/=+$/, '');
  if (hexOk && /^[0-9A-Fa-f]+$/.test(bare)) return true;
  if (/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(bare)) return false;
  return /\d/.test(bare) && /[a-z]/.test(bare) && /[A-Z]/.test(bare);
}

class Scan {
  readonly hits: Hit[] = [];
  private readonly allow: Set<string>;
  private pem: { from: number; at: number; end: number } | null = null;

  readonly src: string;
  /** Where the line being scanned starts in `src`. */
  private base = 0;

  constructor(src: string, allow: readonly string[]) {
    this.src = src;
    this.allow = new Set(allow.map((a) => a.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean));
  }

  /** Where the END line of a private key that begins at or after `from` stops, or -1 when there is none. Each END is looked up once. */
  pemEnd(from: number): number {
    const c = this.pem;
    if (!c || from < c.from || (c.at >= 0 && c.at < from)) {
      const at = this.src.indexOf('-----END ', from);
      let end = -1;
      if (at >= 0) {
        // The label is short, so the closing dashes are looked for in a short window and a missing one costs nothing.
        const window = this.src.slice(at + 9, at + 9 + 40);
        const close = window.indexOf('-----');
        const label = close < 0 ? '' : window.slice(0, close);
        if (label === 'PRIVATE KEY' || label.endsWith(' PRIVATE KEY') || label.endsWith(' PRIVATE KEY BLOCK')) end = at + 9 + close + 5;
      }
      this.pem = { from, at, end };
      return end;
    }
    return c.at < 0 ? -1 : c.end;
  }

  scanLine(line: string, base: number): void {
    if (line.length < 3) return;
    this.base = base;
    this.urls(line);
    if (line.includes('@')) this.emails(line);
    if (line.includes('.')) {
      this.ipv4(line);
      this.hosts(line);
    }
    if (line.includes(':')) this.ipv6(line);
    this.accounts(line);
    this.keys(line);
  }

  /** A hit at `start..end` of the line being scanned; `textEnd`, where its text ends when that is not `end`. */
  private add(kind: ExternalKind, start: number, end: number, textEnd?: number): void {
    const hit: Hit = { kind, start: this.base + start, end: this.base + end };
    if (textEnd !== undefined) hit.textEnd = this.base + textEnd;
    this.hits.push(hit);
  }

  private urls(line: string): void {
    for (const re of [SCHEME_URL, WWW_URL]) {
      for (const m of line.matchAll(re)) {
        const start = m.index;
        const end = trimTail(line, start, start + m[0].length);
        const text = line.slice(start, end);
        if (re === WWW_URL) {
          if (!WWW_HOST.test(text)) continue;
        } else if (!/^[^:]+:\/\/[A-Za-z0-9[]/.test(text)) continue; // `https://{tenant}`, `http://$HOST` and `https://<host>` name nothing
        const { host, userinfo } = urlHost(text);
        if (!userinfo && (this.allow.has(host) || isDocHost(host))) continue;
        this.add('url', start, end);
      }
    }
  }

  private emails(line: string): void {
    for (let at = line.indexOf('@'); at >= 0; at = line.indexOf('@', at + 1)) {
      let from = at;
      while (from > 0 && at - from < 65 && isLocal(line[from - 1])) from--;
      if (at - from > 64) continue;
      while (from < at && (line[from] === '.' || line[from] === '-')) from++;
      if (from === at) continue;
      let to = at + 1;
      while (to < line.length && isDomain(line[to])) to++;
      while (to > at + 1 && (line[to - 1] === '.' || line[to - 1] === '-')) to--;
      const domain = line.slice(at + 1, to);
      const labels = domain.split('.');
      const tld = labels[labels.length - 1];
      if (labels.length < 2 || !/^[A-Za-z]{2,24}$/.test(tld) || labels.some((l) => l === '' || l.startsWith('-') || l.endsWith('-')))
        continue;
      if (isDocHost(domain.toLowerCase())) continue;
      this.add('email', from, to);
    }
  }

  private ipv4(line: string): void {
    for (const m of line.matchAll(V4)) {
      if (DOC_V4.test(m[0]) || this.allow.has(m[0].replace(/\/\d+$/, ''))) continue;
      this.add('ip', m.index, m.index + m[0].length);
    }
  }

  private ipv6(line: string): void {
    for (const m of line.matchAll(V6)) {
      let s = m[0];
      const slash = s.indexOf('/');
      const prefix = slash < 0 ? null : s.slice(slash + 1);
      if (slash >= 0) s = s.slice(0, slash);
      if (prefix !== null && Number(prefix) > 128) continue;
      let length = m[0].length;
      if (s.endsWith(':') && !s.endsWith('::')) {
        // `fe80::1: the link-local address`: the colon is the sentence's.
        if (prefix !== null) continue;
        s = s.slice(0, -1);
        length = s.length;
      }
      const v = ipv6(s);
      if (!v || v.doc || this.allow.has(s.toLowerCase())) continue;
      this.add('ip', m.index, m.index + length);
    }
  }

  private hosts(line: string): void {
    for (const m of line.matchAll(RUN)) {
      const run = m[0];
      if (!run.includes('.')) continue;
      const parts = run.split('.');
      let pos = m.index; // where parts[k] begins in the line
      let first = -1; // the first part of the dotted name being read
      let firstAt = 0;
      const close = (k: number, end: number): void => {
        // parts[first..k) are the labels of one dotted name, ending at `end`. A name that opens a run with a single dot is a dot file.
        if (first >= 0 && k - first >= 2 && !(first === 1 && parts[0] === '')) this.name(line, parts, first, k, firstAt, end);
        first = -1;
      };
      for (let k = 0; k < parts.length; k++) {
        if (parts[k] === '') close(k, pos - 1);
        else if (first < 0) {
          first = k;
          firstAt = pos;
        }
        pos += parts[k].length + 1;
      }
      close(parts.length, pos - 1);
    }
  }

  private name(line: string, parts: string[], from: number, to: number, start: number, end: number): void {
    const tld = parts[to - 1];
    if (!PUBLIC_SUFFIXES.has(tld) && !INTERNAL_SUFFIXES.has(tld)) return;
    // `1.2.3.dev` is a version; a name needs a letter in the label before its suffix. A call, `log.info(`, is not a name either.
    if (!/\p{L}/u.test(parts[to - 2]) || line[end] === '(') return;
    for (let k = from; k < to; k++) if (parts[k].startsWith('-') || parts[k].endsWith('-')) return;
    const name = line.slice(start, end).toLowerCase();
    if (isDocHost(name) || this.allow.has(name)) return;
    this.add('host', start, end);
  }

  private accounts(line: string): void {
    // Not a time stamp, and not a round number: an account id does not end in five zeros.
    for (const m of line.matchAll(AWS_ACCOUNT))
      if (!STAMP.test(m[0]) && !m[0].endsWith('00000')) this.add('account', m.index, m.index + 12);
    if (line.includes('arn:'))
      for (const m of line.matchAll(ARN)) this.add('account', m.index, trimTail(line, m.index, m.index + m[0].length));
    if (line.includes('-'))
      for (const m of line.matchAll(GUID))
        if (/subscription/i.test(line.slice(Math.max(0, m.index - 40), m.index))) this.add('account', m.index, m.index + 36);
    if (/project/i.test(line))
      for (const m of line.matchAll(GCP_PROJECT)) this.add('account', m.index + m[0].length - m[1].length, m.index + m[0].length);
  }

  private keys(line: string): void {
    const base = this.base;
    for (const re of KEYS) for (const m of line.matchAll(re)) this.add('key', m.index, m.index + m[0].length);
    for (const m of line.matchAll(OPENAI_KEY)) if (looksRandom(m[1], false)) this.add('key', m.index, m.index + m[0].length);
    for (const m of line.matchAll(KEYED_VALUE)) {
      if (looksRandom(m[1], true)) this.add('key', m.index + m[0].length - m[1].length, m.index + m[0].length);
    }
    if (line.includes('-----BEGIN '))
      for (const m of line.matchAll(PEM_HEADER)) {
        const headerEnd = m.index + m[0].length;
        const end = this.pemEnd(base + headerEnd);
        this.add('key', m.index, end < 0 ? headerEnd : end - base, headerEnd);
      }
  }

  /** The hits, shortest dropped wherever two overlap, as findings in source order. */
  finish(): ExternalFinding[] {
    const hits = this.hits.toSorted((a, b) => a.start - b.start || b.end - a.end);
    const kept: Hit[] = [];
    for (const h of hits) {
      const top = kept[kept.length - 1];
      if (!top || h.start >= top.end) kept.push(h);
      else {
        const [hl, tl] = [h.end - h.start, top.end - top.start];
        if (hl > tl || (hl === tl && PRIORITY[h.kind] < PRIORITY[top.kind])) kept[kept.length - 1] = h;
      }
    }
    // Each key hit belongs to the kept finding whose span holds it, whether or not it is that finding.
    const keys = hits.filter((h) => h.kind === 'key');
    let k = 0;
    // Line and column come from the start of the span, found by walking the line breaks once.
    const findings: ExternalFinding[] = [];
    let line = 1;
    let lineStart = 0;
    let next = this.src.indexOf('\n');
    if (next < 0) next = Infinity;
    for (const h of kept) {
      while (next < h.start) {
        line++;
        lineStart = next + 1;
        next = this.src.indexOf('\n', lineStart);
        if (next < 0) next = Infinity;
      }
      while (k < keys.length && keys[k].start < h.start) k++;
      const secrets: string[] = [];
      for (let j = k; j < keys.length && keys[j].start < h.end; j++)
        if (keys[j].end <= h.end) {
          const key = keys[j];
          secrets.push(this.src.slice(key.start, key.textEnd ?? key.end));
          // A private key's body lines are secrets too: a message that quotes one is masked like the header.
          if (key.textEnd !== undefined)
            for (const l of this.src.slice(key.textEnd, key.end).split('\n'))
              if (l.trim().length >= 8 && !l.startsWith('-----END ')) secrets.push(l.trim());
        }
      findings.push({
        kind: h.kind,
        text: this.src.slice(h.start, h.textEnd ?? h.end),
        line,
        col: h.start - lineStart + 1,
        start: h.start,
        end: h.end,
        secrets,
      });
    }
    return findings;
  }
}

/**
 * Everything in `src` that names a place, a person or a credential outside the page, in source order, one finding per span: where two
 * overlap (a host inside a URL, a key inside a URL) the longer span is the finding. A line that ends in CR is read without it.
 * `allow` lists host names and IP literals to leave alone along with the URLs on them; the documentation names and ranges
 * (example.com, 192.0.2.0/24, 2001:db8::/32) are always left alone.
 */
export function scanExternal(src: string, opts: ExternalOptions = {}): ExternalFinding[] {
  const scan = new Scan(src, opts.allow ?? []);
  let at = 0;
  while (at <= src.length) {
    let nl = src.indexOf('\n', at);
    if (nl < 0) nl = src.length;
    const end = nl > at && src[nl - 1] === '\r' ? nl - 1 : nl;
    scan.scanLine(src.slice(at, end), at);
    at = nl + 1;
  }
  return scan.finish();
}

const WHAT: Readonly<Record<ExternalKind, string>> = {
  url: 'a URL',
  ip: 'an IP address',
  host: 'a host name',
  account: 'an account id',
  key: 'a credential',
  email: 'an email address',
};

/** A text for a message: a long one is cut, so a data URI or a key does not fill the terminal. */
const shown = (text: string): string => (text.length > 60 ? `${text.slice(0, 57)}...` : text);

/** What a report may print of a credential: its first four characters and its length. */
const maskedKey = (key: string): string => `${key.slice(0, 4)}... (${key.length} characters)`;

/**
 * `text` with each of `secrets` masked as `AKIA... (20 characters)`, so a log or a JSON report never holds one whole. A message that
 * quotes a credential cut short (`row "AKIAABCD..."`) is masked too: wherever a secret's first eight characters start a run that
 * matches the secret, the run is masked.
 */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    const head = secret.slice(0, 8);
    let at = out.indexOf(head);
    while (at >= 0) {
      let n = 8;
      while (n < secret.length && out[at + n] === secret[n]) n++;
      const mask = maskedKey(secret);
      out = out.slice(0, at) + mask + out.slice(at + n);
      at = out.indexOf(head, at + mask.length);
    }
  }
  return out;
}

/** Every credential the findings hold, for `maskSecrets`: what a report under `--external` must never print whole. */
export const findingSecrets = (findings: readonly ExternalFinding[]): string[] => [...new Set(findings.flatMap((f) => f.secrets))];

/** What a report may print of a finding: each credential in it keeps its first four characters. */
const reportText = (f: ExternalFinding): string => maskSecrets(f.text, f.secrets);

/** `scanExternal` as warnings, code `external`, with `detail {kind, text}`. A caller that has scanned `src` already passes its `findings`. */
export function externalDiagnostics(
  src: string,
  opts: ExternalOptions = {},
  findings: readonly ExternalFinding[] = scanExternal(src, opts),
): Diagnostic[] {
  return findings.map((f) => ({
    severity: 'warning' as const,
    code: 'external',
    message: `${WHAT[f.kind]} (${shown(reportText(f))}) would leave with the page; replace it with ${EXTERNAL_PLACEHOLDERS[f.kind]}${f.kind === 'url' || f.kind === 'host' || f.kind === 'ip' ? ', or list its host with --allow' : ''}`,
    line: f.line,
    col: f.col,
    detail: { kind: f.kind, text: reportText(f) },
  }));
}

/**
 * `src` with each finding's span replaced by a placeholder, one repair per replacement, and the findings left as written. The line
 * count does not change: a span that runs over several lines (a private key) leaves its line breaks behind. Reading the result finds
 * nothing more to replace, except the findings it left.
 *
 * The result never parses with more errors than `src` (with `parse`'s options): where `<host>` would break a line (a diagram node id,
 * a data cell read as a number, an option value) the finding takes an identifier-safe placeholder instead, `host-1`, numbered per
 * distinct text so two references to one host stay one node; a finding that cannot be replaced without a new error is left, in
 * `skipped`, and is still a finding.
 */
export function redactExternal(
  src: string,
  opts: ExternalOptions = {},
  parseOpts: ParseOptions = {},
): { src: string; applied: ExternalRepair[]; skipped: ExternalFinding[] } {
  const found = scanExternal(src, opts);
  if (!found.length) return { src, applied: [], skipped: [] };
  /** Per finding: 0 writes `<kind>`, 1 the identifier-safe placeholder, 2 leaves the text. */
  const choice: number[] = found.map(() => 0);
  const lastLine = found.map((f) => f.line + (src.slice(f.start, f.end).match(/\n/g)?.length ?? 0));
  const taken = new Set(src.match(/\b(?:url|ip|host|account|key|email)-\d+\b/g) ?? []);
  const write = (): { out: string; placeholders: (string | null)[] } => {
    const names = new Map<string, string>();
    const next: Partial<Record<ExternalKind, number>> = {};
    let out = '';
    let at = 0;
    const placeholders = found.map((f, i) => {
      if (choice[i] === 2) return null;
      let p = EXTERNAL_PLACEHOLDERS[f.kind];
      if (choice[i] === 1) {
        const k = `${f.kind}\n${f.text}`;
        let name = names.get(k);
        if (name === undefined) {
          let n = next[f.kind] ?? 1;
          while (taken.has(`${f.kind}-${n}`)) n++;
          name = `${f.kind}-${n}`;
          next[f.kind] = n + 1;
          names.set(k, name);
        }
        p = name;
      }
      out += src.slice(at, f.start) + p + src.slice(f.start, f.end).replace(/[^\r\n]/g, '');
      at = f.end;
      return p;
    });
    return { out: out + src.slice(at), placeholders };
  };
  /** The errors of a text, in all and by line. */
  const errors = (text: string): { total: number; byLine: Map<number, number> } => {
    const byLine: Map<number, number> = new Map();
    let total = 0;
    for (const d of parse(text, parseOpts).diagnostics)
      if (d.severity === 'error') {
        total++;
        byLine.set(d.line, (byLine.get(d.line) ?? 0) + 1);
      }
    return { total, byLine };
  };
  const base = errors(src);
  let w = write();
  let now = errors(w.out);
  // Each round moves at least one finding up a step (to the identifier, then to the text as written), so this ends: at worst with
  // every finding left and the source unchanged.
  while (now.total > base.total) {
    const worse = new Set([...now.byLine].filter(([l, n]) => n > (base.byLine.get(l) ?? 0)).map(([l]) => l));
    const onWorse = found.map((f, i) => i).filter((i) => choice[i] < 2 && [...worse].some((l) => l >= found[i].line && l <= lastLine[i]));
    if (onWorse.length) {
      // The findings on a line that got worse are tried one at a time, from the line as written: the first placeholder that adds
      // no error stays.
      for (const i of onWorse) choice[i] = 2;
      let at = errors(write().out).total;
      for (const i of onWorse)
        for (const c of [0, 1]) {
          choice[i] = c;
          const e = errors(write().out).total;
          if (e <= at) {
            at = e;
            break;
          }
          choice[i] = 2;
        }
    } else {
      // A new error away from every finding's line (a name that now clashes): step every finding up.
      for (let i = 0; i < found.length; i++) if (choice[i] < 2) choice[i]++;
    }
    w = write();
    now = errors(w.out);
    if (onWorse.length && now.total > base.total) for (const i of onWorse) choice[i] = 2;
  }
  const applied: ExternalRepair[] = [];
  const skipped: ExternalFinding[] = [];
  found.forEach((f, i) => {
    const placeholder = w.placeholders[i];
    if (placeholder === null) skipped.push(f);
    else
      applied.push({
        line: f.line,
        kind: f.kind,
        text: f.text,
        placeholder,
        note: `replaced ${f.kind} ${shown(reportText(f))} with ${placeholder}`,
      });
  });
  return { src: w.out, applied, skipped };
}
