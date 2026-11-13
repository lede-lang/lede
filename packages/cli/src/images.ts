// D80: `build`, `watch` and `check` turn a local image into a data: URI, so a page with pictures is one file. The libraries read no
// files, so the rewrite is here: it changes `ImageBlock.src` after the parse and before the render.
import { closeSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { browserUrl, imageSrcKind, walkBlocks, type Diagnostic, type ImageBlock, type LedeDocument } from '@lede-lang/core';
import { confine, Unreachable } from './confine.ts';

/** The largest image inlined by default; a page may inline eight times as much in all. */
export const DEFAULT_IMAGE_MAX = 512 * 1024;
const PAGE_FACTOR = 8;

/** Why an image kept its path (the `reason` of W `image-inline`). */
type Reason = 'size' | 'page-size' | 'type' | 'missing' | 'outside';

const ascii = (b: Buffer, at: number, len: number): string => b.toString('latin1', at, at + len);

/** True when `b` starts with an `<svg` root, after an optional byte order mark, white space, XML declaration, comments and doctype. */
function isSvg(b: Buffer): boolean {
  const s = b.toString('utf8');
  let i = s.charCodeAt(0) === 0xfeff ? 1 : 0;
  // A scan, not a regular expression: a file made of thousands of comments must cost one pass.
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    const close = s.startsWith('<?', i) ? '?>' : s.startsWith('<!--', i) ? '-->' : s.startsWith('<!DOCTYPE', i) ? '>' : null;
    if (close === null) break;
    const end = s.indexOf(close, i + 2);
    if (end < 0) return false;
    i = end + close.length;
  }
  return /^<svg[\s/>]/.test(s.slice(i, i + 5));
}

/** The MIME type of an image file, read from its first bytes and never from its name, or null for anything that is not one of the six. */
function imageType(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && /^GIF8[79]a$/.test(ascii(b, 0, 6))) return 'image/gif';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    // The major brand at 8, then a version, then the compatible brands, up to the box's own size.
    const end = Math.min(b.length, Math.max(12, b.readUInt32BE(0)));
    for (let at = 8; at + 4 <= end; at += at === 8 ? 8 : 4) if (/^avi[fs]$/.test(ascii(b, at, 4))) return 'image/avif';
  }
  return isSvg(b) ? 'image/svg+xml' : null;
}

/** A byte count the way `--image-max` is written: `500 bytes`, `512 KB`, `5.5 KB`, `4 MB`. */
function size(n: number): string {
  const [v, unit] = n >= 1024 * 1024 ? [n / 1024 / 1024, 'MB'] : n >= 1024 ? [n / 1024, 'KB'] : [n, 'bytes'];
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${unit}`;
}

const REASONS: Record<Reason, (src: string, max: number) => string> = {
  size: (src, max) =>
    `image ${src} is over ${size(max)}, the largest image inlined; it stays a path. Shrink it, or raise the limit with --image-max=SIZE`,
  'page-size': (src, max) =>
    `inlining ${src} would take the page's images past ${size(max * PAGE_FACTOR)}; it stays a path. Shrink the images, or raise the limit with --image-max=SIZE`,
  type: (src) => `image ${src} is not a PNG, JPEG, GIF, WebP, AVIF or SVG file, so it is not inlined and stays a path`,
  missing: (src) => `image ${src} cannot be read (no such file, or not a readable file), so it stays a path; check the path`,
  outside: (src) => `image ${src} is outside the document's directory, so it is not inlined and stays a path; copy it next to the page`,
};

/** The file a browser would load for a relative URL: no query or fragment, and percent escapes decoded (`my%20pic.png`). */
function filePath(url: string): string {
  const bare = url.replace(/[?#].*$/s, '');
  try {
    return decodeURIComponent(bare);
  } catch {
    return bare; // a stray `%` is a literal character in a file name
  }
}

/** Bytes enough for every raster type's signature; an SVG's prolog can run longer, and then the whole file is read. */
const HEAD = 4096;

/** The first `n` bytes of the file at `path`. */
function head(path: string, n: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(n);
    return buf.subarray(0, readSync(fd, buf, 0, n, 0));
  } finally {
    closeSync(fd);
  }
}

/**
 * The type of the image file at `path` of `length` bytes, as `imageType` reads the whole file, from as little of it as settles it: the
 * first `HEAD` bytes settle every raster type, and only a file they do not settle is read whole, for an SVG with a long prolog.
 */
function sniff(path: string, length: number): string | null {
  const first = head(path, Math.min(length, HEAD));
  return imageType(first) ?? (length > first.length ? imageType(readFileSync(path)) : null);
}

/** What an image file can be inlined as: its data: URI (`encode`) and size, or the reason it cannot be. */
type Inlined = { uri: string; bytes: number } | Reason;

/**
 * Replaces the `src` of every `image` block whose source is a local path with a data: URI of the file, and returns W `image-inline`
 * for each one it leaves as a path. The path is read as the browser reads it, confined to `base`'s tree like `data x < file.csv`
 * (symlinks resolved), and typed by its first bytes. `max` is the per-image size in bytes; the whole page may inline `PAGE_FACTOR`
 * times that, counting an image once for each place it is used. Remote and data: sources are left as they are. A file used in more
 * than one place is read once. Without `encode` (`lede check`, which draws no page) the warnings are the same and no image is read
 * whole or encoded: the src becomes `data:TYPE;base64,` with no payload, so what reads the document after sees an inlined image.
 */
export function inlineImages(doc: LedeDocument, base: string, max: number, encode = true): Diagnostic[] {
  const out: Diagnostic[] = [];
  let total = 0;
  const realBase = realpathSync(base);
  const files = new Map<string, Inlined>();
  /** The data: URI for the file at `full`, without the page's running total. */
  const read = (full: string): Inlined => {
    const stat = statSync(full);
    if (!stat.isFile()) return 'missing';
    if (stat.size > max) return 'size';
    if (!encode) {
      const mime = sniff(full, stat.size);
      return mime === null ? 'type' : { uri: `data:${mime};base64,`, bytes: stat.size };
    }
    const bytes = readFileSync(full);
    const mime = imageType(bytes);
    return mime === null ? 'type' : { uri: `data:${mime};base64,${bytes.toString('base64')}`, bytes: bytes.length };
  };
  /** The data: URI for `b`'s file, or the reason it cannot be one. */
  const inline = (b: ImageBlock): Inlined => {
    try {
      const full = confine(base, filePath(browserUrl(b.src)), realBase);
      let got = files.get(full);
      if (got === undefined) files.set(full, (got = read(full)));
      if (typeof got !== 'string' && total + got.bytes > max * PAGE_FACTOR) return 'page-size';
      return got;
    } catch (e) {
      // Outside the tree, or a file system error (no such file, no permission, a directory): both leave the path as it was.
      return e instanceof Unreachable ? e.reason : 'missing';
    }
  };
  walkBlocks(doc.blocks, (b) => {
    if (b.type !== 'image' || imageSrcKind(b.src) !== 'local') return;
    const got = inline(b);
    if (typeof got === 'string')
      out.push({
        severity: 'warning',
        code: 'image-inline',
        message: REASONS[got](b.src, max),
        line: b.line,
        col: 1,
        detail: { src: b.src, reason: got },
      });
    else {
      total += got.bytes;
      b.src = got.uri;
    }
  });
  return out;
}
