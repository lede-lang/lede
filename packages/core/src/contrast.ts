// WCAG 2.x contrast for `@accent` (D49). The HTML theme sets the accent as the link color and as
// the ink of note labels, picked table headers and timeline dates, so it is text and needs 4.5:1
// against every surface it sits on. These surfaces mirror the tokens in render-html's theme.ts;
// a test there holds the two in step.

export const THEME_SURFACES = {
  light: { bg: '#fbfbfa', surface: '#ffffff', 'accent-tint': '#e9effb' },
  dark: { bg: '#131416', surface: '#1b1c1f', 'accent-tint': '#1b2944' },
} as const;

export type ThemeName = keyof typeof THEME_SURFACES;

/** WCAG AA: 4.5:1 for normal-size text, 3:1 for non-text marks (borders, bars, rules). */
export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`: the hex forms CSS accepts. */
export const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** [r, g, b, a] with r, g, b in 0..255 and a in 0..1, or null for anything but a CSS hex color. */
export function parseHex(s: string): [number, number, number, number] | null {
  if (!HEX_COLOR.test(s)) return null;
  let h = s.slice(1);
  if (h.length <= 4) h = h.replace(/./g, '$&$&');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

function luminance([r, g, b]: readonly number[]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two opaque colors, 1 to 21. */
export function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The lowest contrast of `accent` against the theme's surfaces, rounded down to two decimals so a
 * value at the boundary never reads as passing. A translucent accent is composited over each
 * surface first, which is what the browser paints. Null when `accent` is not a hex color.
 */
export function accentContrast(accent: string, theme: ThemeName): { ratio: number; against: string } | null {
  const fg = parseHex(accent);
  if (!fg) return null;
  let worst: { ratio: number; against: string } | null = null;
  for (const [name, hex] of Object.entries(THEME_SURFACES[theme])) {
    const bg = parseHex(hex)!;
    const a = fg[3];
    const painted = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    const ratio = Math.floor(contrastRatio(painted, bg) * 100) / 100;
    if (!worst || ratio < worst.ratio) worst = { ratio, against: name };
  }
  return worst;
}
