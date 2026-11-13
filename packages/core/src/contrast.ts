// WCAG 2.x contrast for `@accent` (D49). The HTML theme sets the accent as the link color and as
// the ink of note labels, picked table headers and timeline dates, so it is text and needs 4.5:1
// against every surface it sits on. The surfaces are read from the palette table (`palette.ts`), which
// the renderer writes its stylesheet from, so the two cannot drift.
import { paletteSurfaces, type ThemeName } from './palette.ts';

/**
 * The surfaces of the house palette, `paper`. Kept for compatibility: it is exported from `@lede-lang/core`, and is now derived from
 * the palette table. `paletteSurfaces` is the entry point.
 */
export const THEME_SURFACES = {
  light: paletteSurfaces('paper', 'light'),
  dark: paletteSurfaces('paper', 'dark'),
} as const;

export type { ThemeName };

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

/** An sRGB channel, 0..255, as linear light, 0..1. */
export function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: readonly number[]): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio of two opaque colors, 1 to 21. */
export function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `contrastRatio` rounded down to two decimals, so a value at a boundary never reads as passing. */
export function flooredRatio(a: readonly number[], b: readonly number[]): number {
  return Math.floor(contrastRatio(a, b) * 100) / 100;
}

/**
 * The lowest contrast of `accent` against the theme's surfaces (`flooredRatio`). A translucent accent is composited over each
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
    const ratio = flooredRatio(painted, bg);
    if (!worst || ratio < worst.ratio) worst = { ratio, against: name };
  }
  return worst;
}

/** The theme an `@accent` lands on: `dark` with `@theme dark`, else `light` (dark mode keeps the house accent). */
export function accentTheme(theme: string | undefined): ThemeName {
  return theme === 'dark' ? 'dark' : 'light';
}

/**
 * The accent the renderer paints (D49, D77): a hex color that meets AA text contrast, 4.5:1, on the theme it lands on.
 * Anything else, a failing color included, is null and the house accent is used, so the page's text contrast never
 * depends on a writer's choice. The parser warns on exactly the colors this refuses (`accent-contrast`).
 */
export function usableAccent(accent: string | undefined, theme: string | undefined): string | null {
  if (!accent) return null;
  const c = accentContrast(accent, accentTheme(theme));
  return c && c.ratio >= AA_TEXT ? accent : null;
}
