# Security policy

Lede's safety claim is that a compiled page contains no script and fetches nothing from the network by
default. A report that breaks it is a vulnerability: a payload that survives the sanitizer, an output that runs
script or loads a remote resource without `--unsafe-html` or `--allow-remote`, or a way around the CSP meta.

Report privately through GitHub's "Report a vulnerability" on this repository's Security tab, or email security@ledelang.dev. Do not open a
public issue. Include the `.lede` source, the compiled HTML and the browser you saw it in. Expect a first
reply within 3 working days.

Supported: the latest release only.
