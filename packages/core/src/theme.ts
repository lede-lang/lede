// Brand tokens (D80, F10): the operator's `--theme tokens.json`. The file is read as JSON and nothing else. Every value in it must be a
// hex colour, and what leaves this module is a `ThemeTokens` of normalised `#rrggbb` strings, which is all the renderer will write
// into a stylesheet. Contrast is built in: a text colour that does not read on the surfaces it sits on is moved in OKLCH lightness
// only, with its hue and chroma kept, to the nearest value that does, and W `theme-adjusted` says so (E under `strict`).
//
// This is the opposite of D49's rule for a page's `@accent`, on purpose: a writer's accent is one colour in a page they wrote and is
// used whole or not at all; a house palette is a brand the operator wants matched as closely as AA allows.
import type { Diagnostic } from './ast.ts';
import { AA_NON_TEXT, AA_TEXT, flooredRatio, parseHex, toLinear } from './contrast.ts';
import { FIXED_TOKENS, PALETTES, PALETTE_TOKENS, type PaletteToken, type PaletteTokens, type ThemeName } from './palette.ts';

/** The most a tokens file may hold, in bytes. */
export const THEME_MAX_BYTES = 64 * 1024;
/** The most chart colours `series` may give: the page has eight slots, `c1` to `c8`. */
export const THEME_SERIES_MAX = 8;
/** Body text: `fg` is held to this on every surface, the other text tokens to `AA_TEXT`. */
export const AA_BODY = 7;

/** The file cannot be read as a tokens file at all (too large, not JSON, not an object); the CLI calls it a usage error. */
export class ThemeFileError extends Error {}

/** A validated theme: the palette tokens of each theme, with the file's values over the house palette, and the chart colours. */
export interface ThemeTokens {
  light: PaletteTokens;
  dark: PaletteTokens;
  /** `c1`, `c2`, ... of each theme, as many as the file gave; the rest keep the house series. Absent when the file gave none. */
  series?: { light: string[]; dark: string[] };
  /**
   * The status colours (`good`, `bad`, `warn`) of a theme whose surfaces they would not read on, moved like any text token. Only a
   * moved one is here; the rest keep the house value. Absent when none moved, so a theme that moves none draws as before.
   */
  status?: Partial<Record<ThemeName, Partial<Record<StatusToken, string>>>>;
}

/** The fixed status colours that are text (a pill, a callout label, a kpi delta) and so are held to AA under `--theme`. */
export const STATUS_TOKENS = ['good', 'bad', 'warn'] as const;
export type StatusToken = (typeof STATUS_TOKENS)[number];

export interface ThemeResult {
  theme: ThemeTokens;
  /** About the tokens file (line and column are in it), in file order. */
  diagnostics: Diagnostic[];
}

/** The colours `--theme` accepts: `#rgb` or `#rrggbb`, in either case, as `#rrggbb` in lower case; null for anything else, alpha included. */
export function themeHex(v: unknown): string | null {
  // `parseHex` reads every CSS hex form; the two lengths without an alpha are the ones a theme takes.
  const rgba = typeof v === 'string' && (v.length === 4 || v.length === 7) ? parseHex(v) : null;
  if (!rgba) return null;
  return `#${rgba
    .slice(0, 3)
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

// ------------------------------------------------------------------ OKLCH

type Vec = [number, number, number];

const fromLinear = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** [L, C, h] of an sRGB colour (r, g, b in 0..255): OKLab's lightness, its chroma and its hue in radians. */
export function toOklch(rgb: readonly number[]): Vec {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, bb), Math.atan2(bb, a)];
}

/** Linear sRGB of an OKLCH colour, not clamped. */
function linearOf(L: number, C: number, h: number): Vec {
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (v: Vec): boolean => v.every((x) => x >= -1e-6 && x <= 1 + 1e-6);

/**
 * The sRGB colour (`#rrggbb`) at lightness `L` with hue `h` and chroma `C`. A lightness at which that chroma lies outside the sRGB
 * gamut gets the most chroma that fits, found by halving, so the hue and the lightness stay and only the saturation gives way.
 */
export function hexAt(L: number, C: number, h: number): string {
  let c = C;
  if (!inGamut(linearOf(L, c, h))) {
    let [lo, hi] = [0, C];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(linearOf(L, mid, h))) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  const byte = (x: number) =>
    Math.round(fromLinear(Math.min(1, Math.max(0, x))) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${linearOf(L, c, h).map(byte).join('')}`;
}

// ------------------------------------------------------------------ contrast rules

/** One colour the text has to read on, and how well. */
interface Check {
  /** The token it is, or `h1` to `h5` for a heat step. */
  against: string;
  hex: string;
  required: number;
}

const ratioOn = (hex: string, ground: string): number => flooredRatio(parseHex(hex)!, parseHex(ground)!);
const passes = (hex: string, checks: Check[]): boolean => checks.every((c) => ratioOn(hex, c.hex) >= c.required);

/** The check `hex` is closest to failing, or failing worst: the lowest ratio relative to what it needs. */
function tightest(hex: string, checks: Check[]): { ratio: number; required: number; against: string } {
  let worst = { ratio: Infinity, required: 1, against: '' };
  for (const c of checks) {
    const ratio = ratioOn(hex, c.hex);
    if (ratio / c.required < worst.ratio / worst.required) worst = { ratio, required: c.required, against: c.against };
  }
  return worst;
}

/**
 * The colour nearest `hex` in OKLCH lightness that passes every check, with its hue and chroma kept (and chroma reduced only where the
 * gamut forces it), or null when no lightness does. Each way from the colour, darker and lighter, is tried: where its end (black or
 * white) passes, the boundary between the colour and that end is found by halving the lightness, and the nearer of the two boundaries
 * wins. The test is made on the 8-bit colour, so what is returned passes as written.
 */
function nearestPassing(hex: string, checks: Check[]): string | null {
  const [L, C, h] = toOklch(parseHex(hex)!);
  const found: { l: number; hex: string }[] = [];
  for (const end of [0, 1]) {
    if (!passes(hexAt(end, C, h), checks)) continue;
    let [fails, passing] = [L, end];
    for (let i = 0; i < 32; i++) {
      const mid = (fails + passing) / 2;
      if (passes(hexAt(mid, C, h), checks)) passing = mid;
      else fails = mid;
    }
    found.push({ l: passing, hex: hexAt(passing, C, h) });
  }
  found.sort((a, b) => Math.abs(a.l - L) - Math.abs(b.l - L));
  return found[0]?.hex ?? null;
}

// ------------------------------------------------------------------ the file

/** The grounds text sits on, and the tokens that are text on them: what the file's colours are held to. */
const GROUNDS = ['bg', 'surface', 'accent-tint', 'info-bg'] as const;
const TEXT_RULES: Record<string, { on: readonly string[]; required: number; heat?: boolean }> = {
  fg: { on: GROUNDS, required: AA_BODY, heat: true },
  fg2: { on: GROUNDS, required: AA_TEXT },
  muted: { on: ['bg', 'surface'], required: AA_TEXT },
  accent: { on: ['bg', 'surface', 'accent-tint'], required: AA_TEXT },
  'accent-ink': { on: ['bg', 'surface', 'accent-tint'], required: AA_TEXT },
};

/** Where each key and array item of the file begins, as `path -> offset`; read from valid JSON, to the depth the file has (two). */
function offsetsOf(text: string): Map<string, number> {
  const at = new Map<string, number>();
  const stack: { array: boolean; n: number; key: string | null }[] = [];
  /** The name of each open container, from the root (which has none, so the first entry is the root's own `''`). */
  const names: string[] = [];
  const record = (name: string, offset: number) => {
    if (names.length <= 2) at.set([...names.slice(1), name].join('\0'), offset);
  };
  /** A value begins at `offset`: the name it has in its container. */
  const value = (offset: number, container: boolean): string => {
    const cur = stack.at(-1);
    if (!cur) return '';
    if (cur.array) {
      const name = String(cur.n++);
      record(name, offset);
      return name;
    }
    const name = cur.key ?? '';
    if (!container) cur.key = null;
    return name;
  };
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const cur = stack.at(-1);
      if (cur && !cur.array && cur.key === null) {
        cur.key = JSON.parse(text.slice(i, j + 1)) as string;
        record(cur.key, i);
      } else value(i, false);
      i = j + 1;
    } else if (ch === '{' || ch === '[') {
      names.push(value(i, true));
      stack.push({ array: ch === '[', n: 0, key: null });
      i++;
    } else if (ch === '}' || ch === ']') {
      stack.pop();
      names.pop();
      const parent = stack.at(-1);
      if (parent && !parent.array) parent.key = null;
      i++;
    } else if (/[\s,:]/.test(ch)) i++;
    else {
      value(i, false);
      while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
    }
  }
  return at;
}

const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A value as the message shows it: JSON, so a control character is escaped, and cut short. */
const shown = (v: unknown): string => {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
};

/** The names the design's token list used, and the real ones (the CSS custom properties) they stand for. */
const RENAMED: Record<string, string> = { tint: 'accent-tint', fg3: 'muted' };

/**
 * Read a tokens file: `{ "accent", "light": {...}, "dark": {...}, "series": [...] }`, every key optional. `accent` is the brand accent
 * for both themes (and the ink of labels, as `@accent` is); `light` and `dark` name the palette tokens (`bg`, `surface`, `fg`, `fg2`,
 * `muted`, `line`, `line2`, `accent`, `accent-tint`, `accent-line`, `accent-ink`, `info-bg`) and win over `accent`; `series` is one to
 * eight chart colours. A token the file leaves out keeps the house palette's value. The text tokens (`fg`, `fg2`, `muted`, `accent`,
 * `accent-ink`) must read on the surfaces they sit on, at 7:1 for `fg` and 4.5:1 for the rest, and the series at 3:1 on the page and
 * card: one that does not is moved (W `theme-adjusted`, or E with `strict`), and one that no lightness can save is E `theme-surface`.
 * The house status colours (`good`, `bad`, `warn`) are held to 4.5:1 on `bg`, `surface` and their own tint, and moved the same way.
 * The surfaces themselves are taken as given. Throws `ThemeFileError` when the text is not a JSON object or is over `THEME_MAX_BYTES`.
 */
export function parseTheme(text: string, opts: { strict?: boolean } = {}): ThemeResult {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (new TextEncoder().encode(text).length > THEME_MAX_BYTES) throw new ThemeFileError(`larger than ${THEME_MAX_BYTES / 1024} KiB`);
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    throw new ThemeFileError(`not valid JSON (${(e as Error).message})`);
  }
  if (!plain(root)) throw new ThemeFileError('must be a JSON object');

  const offsets = offsetsOf(text);
  const starts = [0];
  for (const m of text.matchAll(/\n/g)) starts.push(m.index + 1);
  const diagnostics: Diagnostic[] = [];
  const say = (severity: Diagnostic['severity'], code: string, message: string, path: string[], detail: Record<string, unknown>): void => {
    let at = path;
    while (at.length > 0 && !offsets.has(at.join('\0'))) at = at.slice(0, -1);
    const offset = at.length > 0 ? offsets.get(at.join('\0'))! : 0;
    let line = starts.findLastIndex((s) => s <= offset);
    line = Math.max(line, 0);
    diagnostics.push({ severity, code, message, line: line + 1, col: offset - starts[line] + 1, detail });
  };
  const badValue = (path: string[], what: string, v: unknown): void =>
    say('error', 'theme-value', `${path.join('.')} must be ${what} (got ${shown(v)})`, path, { key: path.join('.'), value: shown(v) });
  const COLOUR = 'a hex colour, #rgb or #rrggbb (no alpha)';

  let accent: string | null = null;
  const blocks: Record<ThemeName, Partial<PaletteTokens>> = { light: {}, dark: {} };
  let series: string[] | null = null;
  for (const [key, v] of Object.entries(root)) {
    if (key === 'accent') {
      accent = themeHex(v);
      if (accent === null) badValue([key], COLOUR, v);
    } else if (key === 'light' || key === 'dark') {
      if (!plain(v)) {
        badValue([key], 'an object of colours', v);
        continue;
      }
      for (const [token, c] of Object.entries(v)) {
        const path = [key, token];
        if (!(PALETTE_TOKENS as readonly string[]).includes(token)) {
          const hint = Object.hasOwn(RENAMED, token) ? `; did you mean ${RENAMED[token]}?` : '';
          say(
            'warning',
            'theme-key',
            `${path.join('.')} is not a token (known: ${PALETTE_TOKENS.join(', ')})${hint}; it is ignored`,
            path,
            {
              key: path.join('.'),
            },
          );
          continue;
        }
        const hex = themeHex(c);
        if (hex === null) badValue(path, COLOUR, c);
        else blocks[key][token as PaletteToken] = hex;
      }
    } else if (key === 'series') {
      if (!Array.isArray(v) || v.length < 1 || v.length > THEME_SERIES_MAX) {
        badValue([key], `a list of 1 to ${THEME_SERIES_MAX} hex colours`, v);
        continue;
      }
      const hexes = v.map((c, i) => {
        const hex = themeHex(c);
        if (hex === null) badValue([key, String(i)], COLOUR, c);
        return hex;
      });
      if (hexes.every((h) => h !== null)) series = hexes;
    } else if (key === 'fonts') {
      say('warning', 'theme-key', 'fonts is not supported yet: Lede has no font pairings to name; it is ignored', [key], {
        key,
        reason: 'unsupported',
      });
    } else {
      say('warning', 'theme-key', `${key} is not a key of a tokens file (accent, light, dark, series); it is ignored`, [key], { key });
    }
  }

  const adjusting = opts.strict ? 'error' : 'warning';
  const theme: ThemeTokens = { light: { ...PALETTES.paper.light }, dark: { ...PALETTES.paper.dark } };
  for (const name of ['light', 'dark'] as const) {
    const block = blocks[name];
    const given: Partial<PaletteTokens> = {};
    // The accent colours labels as well as links (as `@accent` does), so the ink follows it unless the file names one.
    const brand = block.accent ?? accent;
    if (brand !== null) given.accent = given['accent-ink'] = brand;
    Object.assign(given, block);
    const inkFollows = brand !== null && block['accent-ink'] === undefined;
    const p = Object.assign(theme[name], given);
    const grounds = Object.fromEntries(GROUNDS.map((g) => [g, p[g]]));
    const heat = [1, 2, 3, 4, 5].map((i): Check => ({ against: `h${i}`, hex: FIXED_TOKENS[name][`h${i}`], required: AA_TEXT }));
    const fix = (token: string, hex: string, checks: Check[], path: string[], set: (to: string) => void): void => {
      if (passes(hex, checks)) return;
      const to = nearestPassing(hex, checks);
      const before = tightest(hex, checks);
      if (to === null) {
        say(
          'error',
          'theme-surface',
          `${name} ${token} ${hex} cannot be made to read: no colour reaches ${before.required}:1 on the ${name} surfaces; change the surfaces`,
          path,
          {
            token,
            theme: name,
            required: before.required,
            against: before.against,
          },
        );
        return;
      }
      const after = tightest(to, checks);
      say(
        adjusting,
        'theme-adjusted',
        `${name} ${token} ${hex} has ${before.ratio}:1 on ${before.against}; it needs ${before.required}:1; ${opts.strict ? 'it would be' : 'moved to'} ${to} (${after.ratio}:1)`,
        path,
        { token, theme: name, from: hex, to, ratio: after.ratio, required: before.required, against: before.against },
      );
      set(to);
    };
    for (const [token, rule] of Object.entries(TEXT_RULES)) {
      if (token === 'accent-ink' && inkFollows) continue;
      const checks: Check[] = [
        ...rule.on.map((g) => ({ against: g, hex: grounds[g], required: rule.required })),
        ...(rule.heat ? heat : []),
      ];
      // An accent that came from the file's own `accent` is reported there, not under the theme that was handed it.
      const fromTop = (token === 'accent' || token === 'accent-ink') && block[token] === undefined && accent !== null;
      fix(token, p[token as PaletteToken], checks, fromTop ? ['accent'] : [name, token], (to) => (p[token as PaletteToken] = to));
    }
    if (inkFollows) p['accent-ink'] = p.accent;
    // The status colours are the house's, but they are text on the page and card the file chose (a pill, a callout label, a kpi
    // delta), and on their own tint as a chip: held to AA there, and moved like any other text token when they miss it.
    for (const token of STATUS_TOKENS) {
      const tint = `${token}-bg`;
      const checks: Check[] = [
        ...(['bg', 'surface'] as const).map((g) => ({ against: g, hex: grounds[g], required: AA_TEXT })),
        { against: tint, hex: FIXED_TOKENS[name][tint], required: AA_TEXT },
      ];
      fix(token, FIXED_TOKENS[name][token], checks, [name, token], (to) => (((theme.status ??= {})[name] ??= {})[token] = to));
    }
    if (series !== null) {
      const colours = series.map((hex, i) => {
        let out = hex;
        const checks = ['bg', 'surface'].map((g) => ({ against: g, hex: grounds[g], required: AA_NON_TEXT }));
        fix(`c${i + 1}`, hex, checks, ['series', String(i)], (to) => (out = to));
        return out;
      });
      (theme.series ??= { light: [], dark: [] })[name] = colours;
    }
  }
  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
  return { theme, diagnostics };
}
