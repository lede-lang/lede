# When not to use Lede

Lede is for a model writing a page for people. Other jobs have better tools.

- **Pixel-specific or brand-exact design.** The compiler owns layout, spacing and type. You can pass a colour token file with `--theme`, but you cannot place things to the pixel. Write HTML for that.
- **Interactive apps.** `--shell` is one small fixed script that supports questions and export. It is not an app runtime.
- **Deterministic reports with a fixed structure.** A template filled with data costs no model output at all. Lede saves tokens a model would spend; a script spends none.
- **Content that must render on GitHub or in an editor preview.** Nothing there reads `.lede`. Markdown and Mermaid render in both.
- **Documents meant for models to read.** That is a different job. Lede compiles to a page for a person's browser.
- **UI that a client app interprets at run time.** Generative-UI JSON specs fit there, because the app draws the interface from data.
- **When the best-looking page matters more than cost.** The launch decision says frontier-model HTML usually still looks better (D47). On fresh tasks a blind judge rated Lede at least as good as each tier's own HTML in 60.0% of pairs for Haiku, 21.7% for Opus and 10.0% for Sonnet (D37).
- **Multi-turn agent loops where output tokens are a small part of the bill.** Lede pages took about 7 times fewer output tokens than HTML for Opus and Sonnet, and 4.6 times fewer for Haiku (D50). That matters most for single-shot pages at volume. If a loop spends its tokens on tool calls and context, the saving is small.
- **Safety limits you should know.** A link the reader clicks is not blocked, so a page can still send a reader to an address that carries data. The default output asks the browser for no script and no automatic remote fetch; a link still needs a click. `--allow-remote` lets `https:` images load, `--unsafe-html` keeps raw `html:` blocks, and `--artifact` writes no page policy of its own, so the host's policy decides. [`demos/exfil`](../demos/exfil/README.md) runs each of these in a browser.

## What it is for

Single-shot reports, status pages, comparisons, runbooks and decision pages that a model writes once and a person reads, on a phone or a desktop, in light or dark. The model writes far fewer tokens and the compiler handles layout, charts, diagrams and accessibility. The page is one self-contained file with no script.
