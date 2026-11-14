# Lede in other agent hosts

The skill is one source, `skill/lede/SKILL.md`. Everything under this folder except this file is generated from it by
`node scripts/gen-integrations.ts` (`--check` fails when a file is stale, and the test suite runs that check). Do not edit a
generated file; edit the skill and regenerate. Each file holds the same model reference, byte for byte.

Every route needs the compiler: `npx @lede-lang/cli build page.lede -o page.html` (Node 22.12 or later). The agent asks before
installing anything.

Status words: **tested** means this repo exercised the route in a host. **structure checked** means only a static test or
validator read the files. **untested** means no host has loaded the file here; a route counts as tested once that host, given
the file and a request for a page, produces a `.lede` file that passes `lede check`.

| Host | File to use | Where it goes | Install | Status |
|---|---|---|---|---|
| Claude Code (plugin) | `skill/` (plugin `lede`, marketplace `.claude-plugin/marketplace.json`) | Claude Code plugin cache | `/plugin marketplace add lede-lang/lede`, then `/plugin install lede@lede` | structure checked: `claude plugin validate` and `packages/cli/test/plugin-manifests.test.ts`; the install and a page produced from it are untested here |
| Claude Code (skill folder) | `skill/lede/` | `~/.claude/skills/lede/` or `<project>/.claude/skills/lede/` | copy the folder | structure checked (it is the plugin's skill); untested as a copied folder |
| OpenAI Codex (plugin) | `skill/` with `skill/.codex-plugin/plugin.json`, marketplace `.agents/plugins/marketplace.json` | Codex plugin marketplace | add this repository as a plugin marketplace in Codex, install `lede` | structure checked: `plugin-manifests.test.ts` reads the manifest; untested in Codex |
| OpenAI Codex (instructions) | `integrations/agents-md/AGENTS.md` | append to the project's `AGENTS.md` (Codex reads 32 KiB combined by default; the snippet is about 10 KB) | `cat integrations/agents-md/AGENTS.md >> AGENTS.md` | untested |
| Hosts that read `.agents/skills/` (Codex, Copilot, others) | `skill/lede/` | `<project>/.agents/skills/lede/` | `npx skills add lede-lang/lede`, or copy the folder | untested |
| GitHub Copilot (skill) | `skill/lede/` | `.github/skills/lede/`, `.claude/skills/lede/` or `.agents/skills/lede/` | copy the folder | untested |
| GitHub Copilot (instructions) | `integrations/copilot/copilot-instructions.md` | add to `.github/copilot-instructions.md` | `cat integrations/copilot/copilot-instructions.md >> .github/copilot-instructions.md` | untested |
| Cursor | `integrations/cursor/lede.mdc` | `.cursor/rules/lede.mdc` (the extension must be `.mdc`); applies when `.lede` files are in play, or ask for it | `mkdir -p .cursor/rules && cp integrations/cursor/lede.mdc .cursor/rules/` | structure checked (frontmatter shape); untested in Cursor. Cursor also reads `AGENTS.md`, so the Codex row works there too |
| Gemini CLI | `integrations/gemini/` (manifest, `GEMINI.md`, `skills/lede/`) | a Gemini CLI extension | `gemini extensions install <path or git URL of this folder>` | structure checked (manifest parses, version equals the CLI's); untested in Gemini CLI |
| Any chat model or API | `integrations/system-prompt/lede.txt` | the system prompt, or the first message | paste it; compile the reply with `npx @lede-lang/cli build page.lede -o page.html` | untested |
