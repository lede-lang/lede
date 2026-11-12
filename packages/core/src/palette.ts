// The palette table (D74, built here for the operator's brand tokens, D80). Five presets of twelve surface, grey, rule and accent
// tokens in light and dark, and the colours every palette shares. The renderer writes its stylesheet from this table, so there is one
// copy of every hex value, and `contrast.ts` reads the surfaces the accent sits on from it. This file has no imports.
//
// There is no writer word that picks a preset yet (internal spec, lede-lang/meta): `paper` is the palette in force, and a `--theme`
// file is laid over it. The other four are held to the same rules as `paper` by a test, so a later `@palette` has a table to read.

export const PALETTE_NAMES = ['paper', 'slate', 'sand', 'forest', 'plum'] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];
export type ThemeName = 'light' | 'dark';

/** The tokens a palette sets, named as the CSS custom properties are (`--bg`, `--accent-tint`, ...). */
export const PALETTE_TOKENS = [
  'bg',
  'surface',
  'fg',
  'fg2',
  'muted',
  'line',
  'line2',
  'accent',
  'accent-tint',
  'accent-line',
  'accent-ink',
  'info-bg',
] as const;
export type PaletteToken = (typeof PALETTE_TOKENS)[number];
export type PaletteTokens = Record<PaletteToken, string>;

/** One palette's tokens, written in `PALETTE_TOKENS` order. */
const tokens = (...v: string[]): PaletteTokens => Object.fromEntries(PALETTE_TOKENS.map((k, i) => [k, v[i]])) as PaletteTokens;

export const PALETTES: Record<PaletteName, Record<ThemeName, PaletteTokens>> = {
  paper: {
    light: tokens(
      '#fbfbfa',
      '#ffffff',
      '#16181d',
      '#4d515c',
      '#6b707c',
      '#dcdde1',
      '#c4c6cc',
      '#2357c6',
      '#e9effb',
      '#bccbec',
      '#1d4aa8',
      '#f1f2f4',
    ),
    dark: tokens(
      '#131416',
      '#1b1c1f',
      '#eceef1',
      '#b9bcc4',
      '#9a9ea8',
      '#2e3035',
      '#41444b',
      '#7aa7ff',
      '#1b2944',
      '#2f4670',
      '#9dbdff',
      '#24262b',
    ),
  },
  slate: {
    light: tokens(
      '#f4f6f9',
      '#ffffff',
      '#151a24',
      '#475062',
      '#626b7d',
      '#d7dce5',
      '#bfc6d2',
      '#3451c9',
      '#e6ebfa',
      '#b8c4ee',
      '#2a44b5',
      '#eaeef4',
    ),
    dark: tokens(
      '#0f1420',
      '#171d2b',
      '#e8ecf4',
      '#b3bccd',
      '#94a0b6',
      '#28324a',
      '#3a4761',
      '#8fa8ff',
      '#1d2a4a',
      '#34488a',
      '#a9bcff',
      '#1e2638',
    ),
  },
  sand: {
    light: tokens(
      '#faf6ee',
      '#fffdf8',
      '#1f1a14',
      '#5a4f41',
      '#716655',
      '#e6dfd0',
      '#d1c7b3',
      '#9c421c',
      '#f7e8de',
      '#e2bda7',
      '#86381a',
      '#f1ebe0',
    ),
    dark: tokens(
      '#171411',
      '#201c17',
      '#f3eee6',
      '#c4b9a9',
      '#a69a88',
      '#352f27',
      '#4a4236',
      '#f0a07a',
      '#3a2518',
      '#6b3f28',
      '#f5b899',
      '#2a241d',
    ),
  },
  forest: {
    light: tokens(
      '#f3f7f3',
      '#ffffff',
      '#141c16',
      '#44524a',
      '#5f6e65',
      '#d5dfd7',
      '#bccabf',
      '#1f6f4a',
      '#e2f1e7',
      '#a9d2b7',
      '#185c3d',
      '#e9efea',
    ),
    dark: tokens(
      '#0f1512',
      '#161e19',
      '#e7efe9',
      '#b2c2b7',
      '#93a699',
      '#27332c',
      '#3a4a40',
      '#6fcf97',
      '#173126',
      '#2d5a42',
      '#8fdcb0',
      '#1d2823',
    ),
  },
  plum: {
    light: tokens(
      '#f8f5fa',
      '#ffffff',
      '#1c1522',
      '#514860',
      '#6b617a',
      '#e1dae8',
      '#c9bfd4',
      '#7a3b9a',
      '#f0e6f6',
      '#cfb6e0',
      '#65307f',
      '#ede8f1',
    ),
    dark: tokens(
      '#15111a',
      '#1d1823',
      '#f1edf5',
      '#bfb4c9',
      '#a094ab',
      '#302838',
      '#44394f',
      '#c99bea',
      '#2c1f38',
      '#563b6b',
      '#d9b6f3',
      '#241d2c',
    ),
  },
};

/**
 * The colours every palette shares: status (`good`, `bad`, `warn` and their tints and rules), the eight categorical chart series
 * and the neutral `cm` (D11's validated order), and the five heat steps, which carry `--fg` text. A palette cannot move them: the
 * luminance band its grounds keep is what holds their validation.
 */
export const FIXED_TOKENS: Record<ThemeName, Record<string, string>> = {
  light: {
    good: '#1c7a4a',
    'good-bg': '#e6f4ec',
    bad: '#b4372f',
    'bad-bg': '#fbeceb',
    'bad-line': '#e9a9a3',
    warn: '#8a5a00',
    'warn-bg': '#fff6e0',
    'warn-line': '#e8c26b',
    c1: '#2a78d6',
    c2: '#eb6834',
    c3: '#1baf7a',
    c4: '#eda100',
    c5: '#e87ba4',
    c6: '#008300',
    c7: '#6250d6',
    c8: '#e34948',
    cm: '#b4b7bf',
    h1: '#cde2fb',
    h2: '#9ec5f4',
    h3: '#6da7ec',
    h4: '#5598e7',
    h5: '#3987e5',
  },
  dark: {
    good: '#5cc48d',
    'good-bg': '#15291e',
    bad: '#f07a70',
    'bad-bg': '#2e1715',
    'bad-line': '#6e2f2a',
    warn: '#f0c062',
    'warn-bg': '#2a2210',
    'warn-line': '#6b5420',
    c1: '#3987e5',
    c2: '#d95926',
    c3: '#199e70',
    c4: '#c98500',
    c5: '#d55181',
    c6: '#008300',
    c7: '#9085e9',
    c8: '#e66767',
    cm: '#4b4e56',
    h1: '#0d366b',
    h2: '#104281',
    h3: '#184f95',
    h4: '#1c5cab',
    h5: '#256abf',
  },
};

/** The page, card and note-tint surfaces of a palette (an unknown or missing name is `paper`): what an accent is text on (D49). */
export function paletteSurfaces(name: string | undefined, theme: ThemeName): { bg: string; surface: string; 'accent-tint': string } {
  const p = (name !== undefined && Object.hasOwn(PALETTES, name) ? PALETTES[name as PaletteName] : PALETTES.paper)[theme];
  return { bg: p.bg, surface: p.surface, 'accent-tint': p['accent-tint'] };
}
