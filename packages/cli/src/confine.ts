// The one place that decides whether a path a document names may be read: `data x < file.csv` and local images both come here.
import { realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

/** A path that cannot be used: it is `outside` the document's directory tree, or `missing` (not there, or not readable). */
export class Unreachable extends Error {
  reason: 'outside' | 'missing';
  constructor(message: string, reason: 'outside' | 'missing') {
    super(message);
    this.reason = reason;
  }
}

/** True when `path` is `root` or lies under it. Both are absolute and normalized. */
const inside = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/** The error for a file that cannot be read. Node's message holds the absolute path; the document's author needs only the path they wrote. */
export function unreadable(p: string, e: NodeJS.ErrnoException): Unreachable {
  return new Unreachable(
    e.code === 'ENOENT' || e.code === 'ENOTDIR' ? `${p}: no such file` : `${p}: cannot be read (${e.code ?? e.name})`,
    'missing',
  );
}

/**
 * The real path of `p`, a path as a document wrote it, once it is shown to lie inside `base`'s tree; otherwise it throws an
 * `Unreachable`. A document must not be able to read ~/.ssh or ../../secrets just because someone compiled it. `realBase` is `base`
 * with its symlinks resolved, for a caller that confines many paths to one base.
 */
export function confine(base: string, p: string, realBase: string = realpathSync(base)): string {
  const outside = () => new Unreachable(`${p} is outside the document's directory`, 'outside');
  // It must not matter whether a path that escapes exists: if the answer were "no such file" for one and "outside" for the
  // other, a document could ask which files are there. So first the path as written, resolved against the directory and
  // nothing else.
  const wanted = resolve(base, p);
  if (!inside(wanted, base)) throw outside();
  // Then with symlinks resolved on both sides, or a link inside the folder escapes it. A path that does not resolve is judged
  // by the nearest folder above it that does, so a link out of the tree answers "outside" whether or not the file is there.
  const real = (path: string): string | NodeJS.ErrnoException => {
    try {
      return realpathSync(path);
    } catch (e) {
      return e as NodeJS.ErrnoException;
    }
  };
  const full = real(wanted);
  let nearest = full;
  for (let at = wanted; typeof nearest !== 'string' && at !== dirname(at); nearest = real(at)) at = dirname(at);
  if (typeof nearest !== 'string' || !inside(nearest, realBase)) throw outside();
  if (typeof full !== 'string') throw unreadable(p, full);
  return full;
}
