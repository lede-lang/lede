## What changes, and why

<!-- The problem first, then the change. Link the issue if there is one. -->

## Checklist

- [ ] Tests cover the change (conformance case, unit test, or a security-corpus entry); `pnpm test` passes
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm check:examples` pass
- [ ] `spec/lede-0.1.md`, `spec/model-spec.md` and `skill/lede/SKILL.md` are in step if the language changed
- [ ] A CLI flag, `--json` field, diagnostic code or exit code is in spec §9 and `lede --help`
- [ ] `DECISIONS.md` has an entry if this is a design, format, renderer or benchmark-method decision
- [ ] Commits are Conventional Commits and signed off (`git commit -s`)
