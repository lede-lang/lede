// URL checks have to judge the URL the browser will load, not the string as written: the WHATWG URL
// parser drops leading and trailing C0 controls and spaces, removes tabs and newlines anywhere, and
// reads `\` as `/` in a URL with a special scheme (http, https, file and a few more) or none, since a
// relative URL takes the page's. So `\u0001//host/x.png` and `/\host/x.png` are both the remote
// `//host/x.png`, and `https:host/x.png` (no slashes) is remote too on a file:// page. In `data:` and
// other non-special schemes `\` is content: `data:image\svg+xml,…` is not an image type.

const SPECIAL = new Set(['http', 'https', 'ws', 'wss', 'ftp', 'file']);

/** The string a browser's URL parser actually reads from `s`. */
export function browserUrl(s: string): string {
  const t = s
    // oxlint-disable-next-line no-control-regex -- these are the characters the URL parser drops
    .replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')
    .replace(/[\t\n\r]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(t)?.[1].toLowerCase();
  return scheme && !SPECIAL.has(scheme) ? t : t.replaceAll('\\', '/');
}

/** How an image src loads: `local` (a path), `data` (a data:image URI), `remote` (http, https or `//`), or `bad` (any other scheme). */
export function imageSrcKind(src: string): 'local' | 'data' | 'remote' | 'bad' {
  const u = browserUrl(src);
  if (/^(https?:|\/\/)/i.test(u)) return 'remote';
  if (/^data:image\//i.test(u)) return 'data';
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? 'bad' : 'local';
}

/**
 * The normalised `href` of `s` when it is an absolute `https:` URL, and null for anything else (a relative path, another scheme, text
 * that does not parse). It is what a scraper or a search engine resolves, which is why a share image or a canonical link must be one
 * (`@image`, `@canonical`, spec §4.3): `https://x.example/a/../b` is `https://x.example/b`, and a bare host gains its `/`.
 */
export function httpsUrl(s: string): string | null {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Why `s` is not an `httpsUrl`, or null when it is one: `data` (a `data:` URL), `scheme` (it parses, with another scheme, `http:` and
 * `javascript:` included), `relative` (it does not parse and has no scheme: a path, `//host/x`, or nothing) or `invalid` (it does not
 * parse and has a scheme, as `https://` alone does).
 */
export function httpsUrlProblem(s: string): 'relative' | 'data' | 'scheme' | 'invalid' | null {
  if (httpsUrl(s)) return null;
  const t = browserUrl(s);
  if (/^data:/i.test(t)) return 'data';
  try {
    return new URL(t).protocol === '' ? 'invalid' : 'scheme';
  } catch {
    return /^[^/]*:/.test(t) ? 'invalid' : 'relative';
  }
}
