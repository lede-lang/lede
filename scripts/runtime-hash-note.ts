// The release-notes line for the shell runtime's hash (issue #19; D54, D63, D65). A reviewer who pins a `--shell` page's policy needs
// the runtime's SHA-256 (packages/render-html/src/shell-runtime.sha256; RUNTIME_SHA256 in @lede-lang/html is the same digest in
// base64) when it changes, and a change otherwise shows in review as three changed files and nowhere in the notes.
//
// semantic-release runs this as the exec plugin's `generateNotesCmd` (.releaserc.json), after the notes generator, and appends what
// it prints to the notes as a last paragraph, so the line reaches CHANGELOG.md, the GitHub release and the release commit alike.
// It prints `Shell runtime SHA-256: <hex>` when the file's content at HEAD differs from its content at the previous release tag,
// and nothing when it does not. The content is compared, not the history: a change that was reverted before the release prints
// nothing. When the old hash cannot be read (no previous tag, the tag is unknown, or the file is new) the new one is printed.
//   node scripts/runtime-hash-note.ts [previous-tag]      run from the repository root
import { execFileSync } from 'node:child_process';

/** Repo-relative path of the file that holds the runtime's SHA-256 as hex. */
export const HASH_FILE = 'packages/render-html/src/shell-runtime.sha256';

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The hash file as `rev` has it, trimmed; throws when git has no such revision or file. */
function hashAt(root: string, rev: string): string {
  return execFileSync('git', ['show', `${rev}:${HASH_FILE}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** The note to append to the release notes, or '' when the runtime's hash is the one the previous release tag already had. */
export function runtimeHashNote(root: string, previousTag?: string): string {
  const now = hashAt(root, 'HEAD');
  if (!SHA256_HEX.test(now)) throw new Error(`${HASH_FILE} at HEAD is not a SHA-256 in lowercase hex: ${JSON.stringify(now.slice(0, 80))}`);
  let before: string | null = null;
  if (previousTag) {
    try {
      // `refs/tags/` makes the argument unambiguous: a tag name cannot be read as an option or as a branch of the same name.
      before = hashAt(root, `refs/tags/${previousTag}`);
    } catch {
      before = null;
    }
  }
  return before === now ? '' : `Shell runtime SHA-256: ${now}`;
}

if (import.meta.main) {
  const note = runtimeHashNote(process.cwd(), process.argv[2]);
  if (note) console.log(note);
}
