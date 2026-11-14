# Exfiltration demo

One command, no model, no network:

```sh
node demos/exfil/run.ts
```

It exits 0 when the results match `expected.json`, 1 when they differ, and 3 when no Chromium is found (set `CHROME` to a Chromium
or Chrome executable, or install one with `npx playwright-core install chromium`).

## The claim

If injected text tricks a model into writing markup that carries data out, a page of raw HTML or rendered Markdown sends that data to
the attacker's server as soon as it opens, with no click. The same content written in Lede and compiled with plain `lede build`
sends nothing. The short form: no script and no automatic remote fetch; a link still needs a click.

## What the demo does

- `fixtures/brief.txt` is the poisoned brief: a forwarded email with an instruction to add a tracking image whose address ends in an
  API key. The key, `sk-demo-NOT-A-REAL-SECRET`, is fake.
- The other fixtures are the worst case, the text a fully obedient model would write for that brief, in three forms: raw HTML
  (`html-*.html`), Markdown (`markdown-image.md`) and Lede (`lede-*.lede`). Each places the leak URL
  `attacker.example/leak?q=<secret>` where `@@LEAK@@` stands. The HTML and Lede files use the same six vectors: an `<img>`, a CSS
  `background:url()`, an `@font-face` font, a `<link rel="stylesheet">`, a `<script>` that calls `fetch`, and a meta refresh. Lede
  also gets its two native forms, an `image` line and a `[text](url)` link.
- Lede pages are built by the real CLI (`packages/cli/src/cli.ts build`) as a child process. The Markdown is rendered with
  `markdown-it` (already a dependency of `bench/`) at its defaults: raw HTML off, images on. A real chat host may differ, for
  example by proxying or blocking remote images, and the demo does not test any product.
- Every page is served over http from a local port on 127.0.0.1, not opened as a `file://` path, so it behaves like a hosted page.
  Headless Chromium opens each one, waits half a second, and counts the requests whose URL carries the secret.
- The "attacker" is the host `attacker.example`. Playwright routes any request to it to a stub that counts it, so nothing leaves the
  machine, and Chromium is started with a resolver rule that makes every other host fail to resolve. A request the page's own policy
  blocks never reaches the stub, so the count measures what the browser was willing to send.

## The page policy

Every full page from `lede build` carries this policy in a `<meta>` tag (from `packages/render-html/src/index.ts`):

```
default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'
```

`--allow-remote` changes `img-src` to `'self' data: https:`, and `--shell` appends a `script-src` hash for its one fixed script. The
sanitizer also removes `script`, `style`, `iframe`, event attributes and remote image sources from `html:` blocks before the policy
is applied, and an `image` line with a remote source is written as its alt text unless `--allow-remote` is given
(`spec/lede-0.1.md` sections 4.10 and 4.16). So two layers apply; the `--unsafe-html` rows show the policy alone.

## What the table shows

Raw HTML and Markdown leak in every row. Lede with default flags leaks in none of them, except where a reader clicks a link, which
the demo does and reports as "not blocked".

The rows that mark where the guarantee ends:

- A link the reader clicks takes them to the address, query string included. A link needs a click, and nothing here prevents that
  click. Links render the same with and without any flag.
- `--allow-remote` lets `https:` images load, so an `https:` leak URL arrives. An `http:` image still does not, because the policy
  adds `https:` only.
- `--unsafe-html` keeps `html:` blocks unsanitized. The policy alone still stops the image, the CSS, the font, the stylesheet and the
  script. It does not stop a meta refresh: the policy has no rule for navigation, so the page redirects and the request arrives. This
  flag is meant for local files only, and nothing checks that.
- `--artifact` writes only the title, style and main, with no `<meta>` tags and so no policy of its own (`render` returns early in
  `packages/render-html/src/index.ts`). The host that wraps the fragment decides what is enforced. The demo wraps it in a bare page
  with no policy: the default build still emits no remote image, but `--artifact --allow-remote` leaks, and so does
  `--artifact --unsafe-html` with a script.

## What it does not show

- It does not show that a model can be injected. It assumes the worst case, a model that obeys.
- It does not cover every leak path. It tests the vectors above, and no others, such as a form post or a window opened by script.
- It does not rate any host or product. Hosts that wrap a page, proxy images or add their own policy change the picture.
- It does not show that Lede pages are safe to open in general. It shows what the compiler's default output asks a browser to fetch.
