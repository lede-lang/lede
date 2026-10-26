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
