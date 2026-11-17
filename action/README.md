# Build Lede pages (GitHub Action)

A composite action that builds `.lede` files to self-contained HTML pages with the `lede` CLI. It lives in this repository's
`action/` folder, so it is used as `lede-lang/lede/action@<ref>`.

Not released yet: no tag of this repository contains `action/` until a release that includes it is cut. Until then use a commit
SHA or a branch of a checkout that has it.

Why a subfolder and not a root `action.yml`: a root manifest would turn the whole repository (a monorepo with a spec, a
benchmark and three packages) into the action's identity and make every repository tag an action version. A subfolder keeps the
two apart and costs one path segment in `uses:`. Moving it to the root later is a rename.

## Inputs

| Input      | Default      | Meaning                                                                                                    |
| ---------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `files`    | `**/*.lede`  | Globs or paths of `.lede` files, one per line, relative to the repository root. `**` spans folders, `*` and `?` match within a name, and nothing else is special. `node_modules`, `.git`, `out-dir` and symbolic links are skipped. |
| `out-dir`  | `_site`      | Where the HTML goes. Each file keeps its folders: `docs/a.lede` becomes `_site/docs/a.html`.               |
| `version`  | (empty)      | The `@lede-lang/cli` version or dist-tag to run through `npx`. See below.                                  |
| `check`    | `true`       | Run `lede check` on every file first; an error fails the step (a warning does not).                        |
| `artifact` | `false`      | Pass `--artifact`: write only title, style and main, for a host that wraps the page itself.                |

Outputs: `files` (the built HTML files, one path per line) and `out-dir`.

There is no input for `--unsafe-html` or `--allow-remote`, and the action never passes them: raw `html` blocks stay sanitized and
no remote image is loaded. A page that needs either is built by running the CLI yourself.

### The `version` default

Empty means: the action's own release when it was referenced by a version tag (`@v0.2.4` runs `@lede-lang/cli@0.2.4`), and the
latest published CLI for any other ref (a branch, a commit SHA, a major tag such as `v0`). The CLI on npm can lag this repository,
so an action pinned to a commit builds with the newest published CLI, not with that commit's. Set `version` when the output must
not change between runs.

### Safety of inputs

Every input reaches the script through an environment variable, never inside the text of a `run:` script, so a value cannot become
shell code. The script runs the CLI with an argument list and no shell. `files` and `out-dir` must be relative paths inside the
repository.

## Workflow: build and deploy to GitHub Pages

```yaml
name: pages
on:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: lede-lang/lede/action@main # pin a version tag or a SHA once one has the action
        id: lede
        with:
          out-dir: _site
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ${{ steps.lede.outputs.out-dir }}
  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

In the repository settings, set Pages to "GitHub Actions" as the source. A page `index.lede` becomes `index.html`.

## Workflow: build on a pull request, upload, and comment once

GitHub strips styles from HTML in comments, so the comment never carries the page. It carries a link to the workflow artifact and
a short text summary, and it is updated in place, not posted again.

```yaml
name: preview
on:
  pull_request:
    paths: ['**/*.lede']
permissions:
  contents: read
  pull-requests: write
jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: lede-lang/lede/action@main
        id: lede
      - uses: actions/upload-artifact@v4
        id: upload
        with:
          name: lede-pages
          path: ${{ steps.lede.outputs.out-dir }}
      - uses: actions/github-script@v7
        env:
          FILES: ${{ steps.lede.outputs.files }}
          ARTIFACT_URL: ${{ steps.upload.outputs.artifact-url }}
        with:
          script: |
            const marker = '<!-- lede-preview -->';
            const files = process.env.FILES.split('\n').filter(Boolean);
            const body = [
              marker,
              `Built ${files.length} Lede page${files.length === 1 ? '' : 's'}. Download the HTML: [lede-pages](${process.env.ARTIFACT_URL}).`,
              '',
              ...files.map((f) => `- \`${f}\``),
            ].join('\n');
            const { owner, repo } = context.repo;
            const issue_number = context.issue.number;
            const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number });
            const mine = comments.find((c) => c.body?.startsWith(marker));
            if (mine) await github.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body });
            else await github.rest.issues.createComment({ owner, repo, issue_number, body });
```

Use `pull_request`, not `pull_request_target`. `pull_request_target` runs with the base repository's secrets and a write token
while the workflow builds files that the pull request's author controls; `pull_request` runs the pull request's own code with a
token that cannot do harm. The cost: on a pull request from a fork the token is read-only, so the comment step fails there. The
build and the artifact still work, so put `continue-on-error: true` on the comment step if forks matter to you.

## Workflow: attach the pages to a release

```yaml
name: release-pages
on:
  release:
    types: [published]
permissions:
  contents: write
jobs:
  attach:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.release.tag_name }}
          persist-credentials: false
      - uses: lede-lang/lede/action@main
        id: lede
      - name: Attach
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ github.event.release.tag_name }}
          OUT_DIR: ${{ steps.lede.outputs.out-dir }}
        run: |
          zip -r pages.zip "$OUT_DIR"
          gh release upload "$TAG" pages.zip --clobber --repo "$GITHUB_REPOSITORY"
```

One zip keeps the folders: release assets are a flat list, so two `a.html` files from different folders would collide.

## Pinning

The examples pin third-party actions by major version for readability. For a stricter supply chain, pin each by full commit SHA
with the version in a comment (`uses: actions/checkout@<sha> # v4.x.y`). The action's own `actions/setup-node` step is pinned by
SHA. It installs Node 22 and puts it first on `PATH`, so later steps in the same job run Node 22 too.

## Trying it locally

`node action/build.mjs` reads the same environment variables the action sets (`LEDE_FILES`, `LEDE_OUT_DIR`, `LEDE_VERSION`,
`LEDE_CHECK`, `LEDE_ARTIFACT`, `LEDE_ACTION_REF`, `GITHUB_WORKSPACE`). `LEDE_CLI` replaces the `npx` command, for example
`LEDE_CLI="node packages/cli/src/cli.ts"`; it is a program and arguments split on spaces, run without a shell.
