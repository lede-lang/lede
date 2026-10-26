// Arm A's "good default stylesheet": a GitHub-like reading page with dark mode.
// Arm A gets the same care as Lede's theme so the comparison is about the format, not the CSS.
export const MD_CSS = `
:root{--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--code:#f6f8fa;--accent:#0969da;--quote:#59636e;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#3d444d;--code:#151b23;--accent:#4493f8;--quote:#9198a1;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;padding:0 16px}
.markdown-body{max-width:860px;margin:0 auto;padding:32px 0 64px}
h1,h2,h3,h4{line-height:1.25;margin:24px 0 16px;font-weight:600}
h1{font-size:2em;padding-bottom:.3em;border-bottom:1px solid var(--line)}
h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid var(--line)}
h3{font-size:1.25em}
p,ul,ol,blockquote,table,pre{margin:0 0 16px}
a{color:var(--accent)}
code{font:85% ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:.2em .4em;border-radius:6px}
pre{background:var(--code);padding:16px;border-radius:6px;overflow:auto}
pre code{background:none;padding:0}
blockquote{padding:0 1em;color:var(--quote);border-left:.25em solid var(--line)}
table{border-collapse:collapse;display:block;overflow:auto;width:max-content;max-width:100%}
th,td{padding:6px 13px;border:1px solid var(--line)}
th{font-weight:600} tr:nth-child(2n){background:var(--code)}
img{max-width:100%}
hr{border:0;border-top:1px solid var(--line);margin:24px 0}
.mermaid{margin:0 0 16px;overflow:auto;text-align:center}
.mermaid svg{max-width:100%;height:auto}
`;
