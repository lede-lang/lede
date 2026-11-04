# Security policy

Lede's safety claim is that a page built without `--shell` contains no script and fetches nothing from the network by
default, and that a page built with `--shell` runs only the compiler's own fixed runtime, pinned by SHA-256 in its CSP meta, which
receives page content only as inert JSON. A report that breaks either claim is a vulnerability: a payload that survives the
sanitizer, an output that runs script (or, with `--shell`, a second script, or page text reaching the runtime other than through
its data block) or loads a remote resource without `--unsafe-html` or `--allow-remote`, or a way around the CSP meta. A change to
the runtime changes its hash; the current value is `RUNTIME_SHA256` in `@lede-lang/html`.

Report privately through GitHub's "Report a vulnerability" on this repository's Security tab, or email security@ledelang.dev. Do not open a
public issue. Include the `.lede` source, the compiled HTML and the browser you saw it in. Expect a first
reply within 3 working days.

Supported: the latest release only.
