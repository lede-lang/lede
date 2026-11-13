# Changelog

## <small>0.2.4 (2026-11-13)</small>

* Merge pull request #42 from lede-lang/claude/project-thread-lf1cmv ([93915e6](https://github.com/lede-lang/lede/commit/93915e6)), closes [#42](https://github.com/lede-lang/lede/issues/42)
* Merge pull request #41 from lede-lang/claude/project-thread-53qkzz ([8d2a953](https://github.com/lede-lang/lede/commit/8d2a953)), closes [#41](https://github.com/lede-lang/lede/issues/41)
* Merge pull request #40 from lede-lang/claude/project-thread-y5wn4d ([942e246](https://github.com/lede-lang/lede/commit/942e246)), closes [#40](https://github.com/lede-lang/lede/issues/40)
* feat(core,html): edge and message tones in the status colors ([3cbf088](https://github.com/lede-lang/lede/commit/3cbf088))
* fix(html): a late @status redraws what reads the status words ([4606376](https://github.com/lede-lang/lede/commit/4606376))
* fix(core): a pipe inside a code span is text in a pipe row ([d05b4a9](https://github.com/lede-lang/lede/commit/d05b4a9))
* fix(core): a table header with a semicolon stays CSV ([36e47f8](https://github.com/lede-lang/lede/commit/36e47f8))
* fix: close bold that ends in italic, accept `--`, and close a data-path probe ([0fe43de](https://github.com/lede-lang/lede/commit/0fe43de))
* fix(cli): cut every echoed line that holds a credential ([ef7b857](https://github.com/lede-lang/lede/commit/ef7b857))
* fix(core): do not reserve decision as a name ([6483625](https://github.com/lede-lang/lede/commit/6483625))
* fix(html): draw diagram group labels as written, in the sans ([4f1bd2c](https://github.com/lede-lang/lede/commit/4f1bd2c))
* fix(render-html): draw toned edge labels at the weight their chip is sized for ([9c40ad0](https://github.com/lede-lang/lede/commit/9c40ad0))
* fix(core): external redaction never leaves the page with more errors ([976cad5](https://github.com/lede-lang/lede/commit/976cad5))
* fix(core): find an upper-case host name under --external ([9e30a79](https://github.com/lede-lang/lede/commit/9e30a79))
* fix: handle a last line ending in a bare CR in --fix, and many-word cells ([3209118](https://github.com/lede-lang/lede/commit/3209118))
* fix(core): hold the status colours to AA on a --theme page and card ([5753ce6](https://github.com/lede-lang/lede/commit/5753ce6))
* fix(cli): inline an image whose path has a query or percent escapes ([9cd6aa1](https://github.com/lede-lang/lede/commit/9cd6aa1))
* fix(core): judge a scanned url's host as the browser reads it ([d8dd6b3](https://github.com/lede-lang/lede/commit/d8dd6b3))
* fix(cli): keep `watch` running when the file is replaced, deleted or unreadable ([7cceaa5](https://github.com/lede-lang/lede/commit/7cceaa5))
* fix(core): keep a pipe header with a semicolon when CSV would fail ([ffa24ab](https://github.com/lede-lang/lede/commit/ffa24ab))
* fix(cli): keep outside data paths opaque and load the renderer only when building ([37e2aa5](https://github.com/lede-lang/lede/commit/37e2aa5))
* fix(html): keep the total row apart from the data rows, and totals only on plain stacks ([5626196](https://github.com/lede-lang/lede/commit/5626196))
* fix(cli): leave a web-root image path as written ([c1a3d66](https://github.com/lede-lang/lede/commit/c1a3d66))
* fix(core): make --fix repair CRLF files and keep the space in a rejoined cell ([6d4f2bf](https://github.com/lede-lang/lede/commit/6d4f2bf))
* fix(cli): mask credentials in every diagnostic under --external ([d2c66e3](https://github.com/lede-lang/lede/commit/d2c66e3))
* fix(cli): never print a credential whole from check --external ([229cd0d](https://github.com/lede-lang/lede/commit/229cd0d))
* fix(core): one data update per name per streamed line ([503c545](https://github.com/lede-lang/lede/commit/503c545))
* fix(core): only the five tone words end an edge label as a tone ([835cdb8](https://github.com/lede-lang/lede/commit/835cdb8))
* fix(html): print from a dark page, links with parentheses, code spans and nested emphasis ([d69c3b1](https://github.com/lede-lang/lede/commit/d69c3b1))
* fix(html): read a run of backticks that nothing closes as text, once ([b7c1384](https://github.com/lede-lang/lede/commit/b7c1384))
* fix(cli): refuse -o over the source, reject unknown options, print one line on failure ([3f6e277](https://github.com/lede-lang/lede/commit/3f6e277))
* fix(core): report a column a redefinition removed, spilled options and open quotes ([d3b3a88](https://github.com/lede-lang/lede/commit/d3b3a88))
* fix: stop crashes and NaN on inherited data names, empty axis ranges and very large data ([c8ba2bf](https://github.com/lede-lang/lede/commit/c8ba2bf))
* perf(core): one data update per run of streamed row lines ([2c1ba1e](https://github.com/lede-lang/lede/commit/2c1ba1e))
* perf(cli): read the theme and scan for external text once, check images without encoding ([f53eede](https://github.com/lede-lang/lede/commit/f53eede))
* refactor(core): one hex reader, one ISO date pattern, one reserved-name check ([95813d5](https://github.com/lede-lang/lede/commit/95813d5))
* refactor(html): one ISO date pattern, drop css's unused wide option ([4cb2f8b](https://github.com/lede-lang/lede/commit/4cb2f8b))
* refactor(html): one layout value, one page walk, shared author and pill markup ([672d48a](https://github.com/lede-lang/lede/commit/672d48a))
* refactor(html): one sans label measure, scoped bar-cell styles, no label thinning when labels wrap ([d88598a](https://github.com/lede-lang/lede/commit/d88598a))
* refactor(core): one stream event helper, a decision line's usage as a constant ([692cfb2](https://github.com/lede-lang/lede/commit/692cfb2))
* refactor(core): one tone list, shared contrast helpers, linear edge split ([d9e2569](https://github.com/lede-lang/lede/commit/d9e2569))
* refactor: share the inline scanner, the stray-word test and the watch test helper ([4f5848d](https://github.com/lede-lang/lede/commit/4f5848d))
* docs: record D78, the loud command line and light-theme print ([5ebb3bb](https://github.com/lede-lang/lede/commit/5ebb3bb))
* docs: record D80, and the publishing flags in the skill setup ([07b51ae](https://github.com/lede-lang/lede/commit/07b51ae))
* docs(skill): reference files for the new page words ([fe2beeb](https://github.com/lede-lang/lede/commit/fe2beeb))
* feat(core): @status gives a page its own status chip words ([9a9f44a](https://github.com/lede-lang/lede/commit/9a9f44a))
* feat(cli): add --version and read a document from stdin with `-` ([811d867](https://github.com/lede-lang/lede/commit/811d867))
* feat(cli): add check --external for what a page gives away ([4a6361a](https://github.com/lede-lang/lede/commit/4a6361a))
* feat: add decision blocks ([1ed2a01](https://github.com/lede-lang/lede/commit/1ed2a01))
* feat(cli): brand tokens through --theme, with contrast built in ([000d294](https://github.com/lede-lang/lede/commit/000d294))
* feat(core): callout kinds, so a recommendation is not an outage ([3edf059](https://github.com/lede-lang/lede/commit/3edf059))
* feat(cli): inline local images as data: URIs in build, watch and check ([1eaf88b](https://github.com/lede-lang/lede/commit/1eaf88b))
* feat(html): lay dashboards out wide: column, grids and flow direction ([677f560](https://github.com/lede-lang/lede/commit/677f560))
* feat(core): page metadata: share tags, canonical link, facts row ([7711843](https://github.com/lede-lang/lede/commit/7711843))
* feat(core): pipe-separated rows for data sets and inline tables ([5b34930](https://github.com/lede-lang/lede/commit/5b34930)), closes [#34](https://github.com/lede-lang/lede/issues/34)
* feat(html): set figure text in the page's sans as written, and fix the labels judges marked ([ef7ee70](https://github.com/lede-lang/lede/commit/ef7ee70))
* test(conformance): record dirExplicit on the edge-tones case ([e7b3cf0](https://github.com/lede-lang/lede/commit/e7b3cf0))

## <small>0.2.3 (2026-11-09)</small>

* Merge pull request #38 from lede-lang/claude/project-thread-3w4dja ([7e27ce7](https://github.com/lede-lang/lede/commit/7e27ce7)), closes [#38](https://github.com/lede-lang/lede/issues/38)
* ci(release): install Chromium before the release build's tests ([ef511af](https://github.com/lede-lang/lede/commit/ef511af)), closes [#21](https://github.com/lede-lang/lede/issues/21)

## <small>0.2.2 (2026-11-09)</small>

* Merge pull request #37 from lede-lang/claude/project-thread-4kyzhx ([7cce9f9](https://github.com/lede-lang/lede/commit/7cce9f9)), closes [#37](https://github.com/lede-lang/lede/issues/37)
* ci: accessibility gate over every shipped page ([5f7b9a5](https://github.com/lede-lang/lede/commit/5f7b9a5))
* ci: list the shell runtime hash in the release notes when it changes ([c2ca2ab](https://github.com/lede-lang/lede/commit/c2ca2ab)), closes [#19](https://github.com/lede-lang/lede/issues/19)
* ci: run the older Chromium batteries on Linux through browserTest ([3512bef](https://github.com/lede-lang/lede/commit/3512bef)), closes [#21](https://github.com/lede-lang/lede/issues/21)
* fix(html): give a page with an empty heading a title ([6d2d89d](https://github.com/lede-lang/lede/commit/6d2d89d))
* fix: paint only an @accent that passes AA text contrast (D77) ([5686a8c](https://github.com/lede-lang/lede/commit/5686a8c))
* fix(bench): record the reference file that was scored in result.json ([e442a9a](https://github.com/lede-lang/lede/commit/e442a9a))
* fix(core): reject control characters in choose options and question names ([86bf0ce](https://github.com/lede-lang/lede/commit/86bf0ce)), closes [#22](https://github.com/lede-lang/lede/issues/22)
* refactor: share the budget and probe helpers instead of copying them ([c7544c1](https://github.com/lede-lang/lede/commit/c7544c1))
* docs: note the rejected data-block alternative under D76 ([1f4c544](https://github.com/lede-lang/lede/commit/1f4c544))
* docs: record that choose options refuse C0 controls (D76) ([81def9e](https://github.com/lede-lang/lede/commit/81def9e))
* test(bench): add the probe-round harness and the brief writer's prompt ([e19181a](https://github.com/lede-lang/lede/commit/e19181a))
* test(cli): check the skill's reference files, their budgets and the SKILL.md table ([3abd543](https://github.com/lede-lang/lede/commit/3abd543))
* test: find the Playwright Chromium on Linux ([dc81b55](https://github.com/lede-lang/lede/commit/dc81b55))
* test(render-html): pin that the stylesheet holds no unguarded motion ([3347eb1](https://github.com/lede-lang/lede/commit/3347eb1))
* test(bench): write and hash the twelve probe briefs for six reference files ([cb3b1af](https://github.com/lede-lang/lede/commit/cb3b1af))
* feat(skill): add the page-metadata reference file, not yet named in SKILL.md ([8d15c0c](https://github.com/lede-lang/lede/commit/8d15c0c))
* feat(bench): count the reference files on three writer models with --budgets ([d886a77](https://github.com/lede-lang/lede/commit/d886a77))
* feat(core): warn when a heading skips a level (heading-skip) ([771df38](https://github.com/lede-lang/lede/commit/771df38))

## <small>0.2.1 (2026-11-06)</small>

* Merge pull request #36 from lede-lang/claude/project-thread-oh4wq1 ([b3902dc](https://github.com/lede-lang/lede/commit/b3902dc)), closes [#36](https://github.com/lede-lang/lede/issues/36)
* fix: three streaming and parsing slips from the 0.2.0 review, plus cleanups ([d62eec9](https://github.com/lede-lang/lede/commit/d62eec9))
* test(bench): add the Sonnet refinement pilot on 12 tuning tasks, not the D67 verdict ([d92c10d](https://github.com/lede-lang/lede/commit/d92c10d))

## 0.2.0 (2026-11-06)

* Merge pull request #31 from lede-lang/claude/project-thread-9piydq ([69a1aeb](https://github.com/lede-lang/lede/commit/69a1aeb)), closes [#31](https://github.com/lede-lang/lede/issues/31)
* Merge origin/main into claude/project-thread-9piydq ([76e11ea](https://github.com/lede-lang/lede/commit/76e11ea))
* Merge branch 'impl/shell-editors-c' into claude/project-thread-9piydq ([da79eea](https://github.com/lede-lang/lede/commit/da79eea))
* Merge remote-tracking branch 'origin/main' into claude/project-thread-9piydq ([fdb69ae](https://github.com/lede-lang/lede/commit/fdb69ae))
* Merge remote-tracking branch 'origin/main' into claude/project-thread-9piydq ([0dc60df](https://github.com/lede-lang/lede/commit/0dc60df)), closes [#16](https://github.com/lede-lang/lede/issues/16) [#17](https://github.com/lede-lang/lede/issues/17)
* chore(minor): cut 0.2.0 for the shell editor words and the streaming renderer ([4817d02](https://github.com/lede-lang/lede/commit/4817d02))
* fix(core): a `name:` line that changes nothing is no update event ([a74c41f](https://github.com/lede-lang/lede/commit/a74c41f))
* fix(core): fail loudly on an editor line with any option before the bar ([2ae072e](https://github.com/lede-lang/lede/commit/2ae072e))
* fix(core): give bucket sets their own stream events and make onBucketItem optional ([81daf4d](https://github.com/lede-lang/lede/commit/81daf4d))
* fix(html): grouped units draw their kpis from the rows so far ([9b9d64f](https://github.com/lede-lang/lede/commit/9b9d64f))
* fix(html): hold a typed param to its range and grid in the export and the runtime ([e073076](https://github.com/lede-lang/lede/commit/e073076))
* fix(html): keep a bucket's lists in place on prose pages ([afd5a0d](https://github.com/lede-lang/lede/commit/afd5a0d))
* fix(cli): lede watch --shell says once that the flag had no effect ([6a3b760](https://github.com/lede-lang/lede/commit/6a3b760))
* fix(html): name the cause of a settled unit that only the whole-page render has ([f491e7b](https://github.com/lede-lang/lede/commit/f491e7b))
* fix(html): no placeholder for an empty flow diagram sealed while its unit is held ([8922135](https://github.com/lede-lang/lede/commit/8922135))
* fix(core): read a comma in a param number only as a thousands separator ([bf0b374](https://github.com/lede-lang/lede/commit/bf0b374))
* fix(core): refuse html as a bucket set name ([6abf9b3](https://github.com/lede-lang/lede/commit/6abf9b3))
* fix(core): require a param's MAX on its step grid ([9139f6d](https://github.com/lede-lang/lede/commit/9139f6d))
* fix(html): settle a late masthead decision as the masthead, not as the whole page ([4d5c0d3](https://github.com/lede-lang/lede/commit/4d5c0d3))
* fix(core): test data names by own property ([0dbce1e](https://github.com/lede-lang/lede/commit/0dbce1e))
* fix(core): the artifact-image warning says "a local path", not "a relative path" ([893f060](https://github.com/lede-lang/lede/commit/893f060))
* fix(core): the export-orphan warning names every word that makes a field ([00618e6](https://github.com/lede-lang/lede/commit/00618e6))
* fix(html): the prompt export lists a template as unchanged only when none of its slots changed ([78a8cea](https://github.com/lede-lang/lede/commit/78a8cea))
* test(core): a question word is a block event on its own line and never a tail ([a84f40b](https://github.com/lede-lang/lede/commit/a84f40b))
* test(html): add red acceptance checks for the editor words' render and export ([74bd4b8](https://github.com/lede-lang/lede/commit/74bd4b8))
* test(core): add red acceptance checks for the editor words ([589547e](https://github.com/lede-lang/lede/commit/589547e))
* test(html): add red checks for the editor words under the shell ([628dfd4](https://github.com/lede-lang/lede/commit/628dfd4))
* test(html): add red checks for the template rule in the prompt export's Unchanged line ([21e1004](https://github.com/lede-lang/lede/commit/21e1004))
* test(html): measure the incremental renderer over the 180 v0.4 pages ([429e3a0](https://github.com/lede-lang/lede/commit/429e3a0))
* test: pin render() bytes with a per-file hash fixture ([e065047](https://github.com/lede-lang/lede/commit/e065047))
* test(html): pin the render bytes of the editor pages and the new shell data block ([9b1370d](https://github.com/lede-lang/lede/commit/9b1370d))
* test(html): pin the shell-mode bytes of the pages that want the shell ([8447c73](https://github.com/lede-lang/lede/commit/8447c73))
* test: share the browser and markup helpers of the question and editor checks ([0df9dab](https://github.com/lede-lang/lede/commit/0df9dab))
* test(html): the layout-shift check runs through browserTest ([4eb3e9c](https://github.com/lede-lang/lede/commit/4eb3e9c))
* docs: bring the shell and invariants bullets of CLAUDE.md up to D65 ([29c9251](https://github.com/lede-lang/lede/commit/29c9251))
* docs: name the bucket stream events in the incremental renderer's decision ([028e452](https://github.com/lede-lang/lede/commit/028e452))
* docs: say which shell builds change in spec appendix G.2 ([245f448](https://github.com/lede-lang/lede/commit/245f448))
* perf(html): cache flow layouts only for the incremental renderer ([50fcff7](https://github.com/lede-lang/lede/commit/50fcff7))
* perf(html): marking and rewinding the drawing state copies no heading ids ([378d17e](https://github.com/lede-lang/lede/commit/378d17e))
* perf(html): the incremental renderer draws a grown bucket set once and walks each block once ([8e64b98](https://github.com/lede-lang/lede/commit/8e64b98))
* perf(html): the incremental renderer keeps only the drawings still in flight ([62f0f5c](https://github.com/lede-lang/lede/commit/62f0f5c))
* perf(core): the stream's tail copies the open block's items, not the whole accumulator ([0750c8b](https://github.com/lede-lang/lede/commit/0750c8b))
* feat(html): act on the editor words under --shell ([66c4d6d](https://github.com/lede-lang/lede/commit/66c4d6d))
* feat(bench): artifact render probe and token counter ([2e2580d](https://github.com/lede-lang/lede/commit/2e2580d))
* feat(html): createIncremental, an incremental renderer for streamed pages ([16fc5df](https://github.com/lede-lang/lede/commit/16fc5df))
* feat(html): draw the editor words and serialize them in three formats ([d400027](https://github.com/lede-lang/lede/commit/d400027))
* feat(bench): fresh held-out tasks 131-185, hashed ([c488b95](https://github.com/lede-lang/lede/commit/c488b95))
* feat(bench): harness and prompts for the refinement test and round 3 ([6daa270](https://github.com/lede-lang/lede/commit/6daa270))
* feat(core): parse the editor words and export prompt ([113fc51](https://github.com/lede-lang/lede/commit/113fc51))
* feat(core): stream a bucket set's item lines as updates and a template's open fence as the tail ([0d5d381](https://github.com/lede-lang/lede/commit/0d5d381))
* feat(core): stream events() and tail() for incremental viewers ([9addc67](https://github.com/lede-lang/lede/commit/9addc67))
* feat(html): the incremental renderer draws the editor words ([df69c04](https://github.com/lede-lang/lede/commit/df69c04))
* feat(html): the incremental renderer draws the question words ([ea05343](https://github.com/lede-lang/lede/commit/ea05343))
* feat(cli): warn about relative images under --artifact ([18eb285](https://github.com/lede-lang/lede/commit/18eb285))
* refactor: share block walks and page rules between render and the incremental renderer ([d4bb338](https://github.com/lede-lang/lede/commit/d4bb338))
* refactor(core): share the question and editor parsing ([5612e6b](https://github.com/lede-lang/lede/commit/5612e6b))
* refactor(bench): share the token count, the task vocabulary and the judge-sample loader ([7fcb76f](https://github.com/lede-lang/lede/commit/7fcb76f))
* refactor(html): simplify the editor serializer and markup ([8430286](https://github.com/lede-lang/lede/commit/8430286))

## <small>0.1.15 (2026-11-04)</small>

* Merge pull request #32 from lede-lang/claude/project-thread-5elyqc ([bd5663f](https://github.com/lede-lang/lede/commit/bd5663f)), closes [#32](https://github.com/lede-lang/lede/issues/32)
* docs: record D70 to D74 for page chrome, accessibility, reference files, layers and page identity ([288034f](https://github.com/lede-lang/lede/commit/288034f))
* docs: record the owner's answers on fonts, names and the contents bar in D70 and D74 ([b0232c7](https://github.com/lede-lang/lede/commit/b0232c7))

## <small>0.1.14 (2026-11-04)</small>

* Merge pull request #17 from lede-lang/feat/shell-runtime ([7366bc2](https://github.com/lede-lang/lede/commit/7366bc2)), closes [#17](https://github.com/lede-lang/lede/issues/17)
* Merge remote-tracking branch 'origin/main' into feat/shell-runtime ([9af2f02](https://github.com/lede-lang/lede/commit/9af2f02))
* Merge branch 'feat/question-words' into feat/shell-runtime ([378654a](https://github.com/lede-lang/lede/commit/378654a))
* Merge feat/question-words into feat/shell-runtime ([a17e6cb](https://github.com/lede-lang/lede/commit/a17e6cb))
* refactor: compute a page's fields once, share the helpers and trim the tests ([a0f645a](https://github.com/lede-lang/lede/commit/a0f645a))
* test: add the shell's acceptance checks, red until the runtime lands ([931353e](https://github.com/lede-lang/lede/commit/931353e))
* test: run the security corpus over shell pages ([66c4ab7](https://github.com/lede-lang/lede/commit/66c4ab7))
* feat(cli): add --shell to build and watch ([19c04bb](https://github.com/lede-lang/lede/commit/19c04bb))
* feat(html): add the shell runtime and page assembly ([51c33b8](https://github.com/lede-lang/lede/commit/51c33b8))

## <small>0.1.13 (2026-11-04)</small>

* Merge pull request #16 from lede-lang/feat/question-words ([dfa4a87](https://github.com/lede-lang/lede/commit/dfa4a87)), closes [#16](https://github.com/lede-lang/lede/issues/16)
* Merge remote-tracking branch 'origin/main' into feat/question-words ([1ffe458](https://github.com/lede-lang/lede/commit/1ffe458))
* fix: run CI on ubuntu-24.04, cite the internal spec as such, say all 803 pages ([6d26bf1](https://github.com/lede-lang/lede/commit/6d26bf1))
* docs: specify the question words (spec 4.18) and record D63 and D64 ([137da7b](https://github.com/lede-lang/lede/commit/137da7b))
* test: run the security corpus over the question words ([39c60ed](https://github.com/lede-lang/lede/commit/39c60ed))
* feat(html): draw the question words as plain controls ([3dee373](https://github.com/lede-lang/lede/commit/3dee373))
* feat(core): parse ask, choose, confirm and export ([60a2867](https://github.com/lede-lang/lede/commit/60a2867))

## <small>0.1.12 (2026-11-02)</small>

* Merge pull request #28 from lede-lang/claude/project-thread-pw3s53 ([ed1e896](https://github.com/lede-lang/lede/commit/ed1e896)), closes [#28](https://github.com/lede-lang/lede/issues/28) [#24](https://github.com/lede-lang/lede/issues/24) [#27](https://github.com/lede-lang/lede/issues/27)
* docs: record D65 to D68 for issues #24 to #27 ([06fbc4a](https://github.com/lede-lang/lede/commit/06fbc4a)), closes [#24](https://github.com/lede-lang/lede/issues/24) [#27](https://github.com/lede-lang/lede/issues/27)

## <small>0.1.11 (2026-11-02)</small>

* Merge pull request #23 from lede-lang/claude/project-thread-xrccjs ([14b9417](https://github.com/lede-lang/lede/commit/14b9417)), closes [#23](https://github.com/lede-lang/lede/issues/23)
* docs: mark decisions that later entries answered or superseded ([3513b4e](https://github.com/lede-lang/lede/commit/3513b4e))

## <small>0.1.10 (2026-10-28)</small>

* Merge pull request #15 from lede-lang/docs/credit-diagram-design ([6b25857](https://github.com/lede-lang/lede/commit/6b25857)), closes [#15](https://github.com/lede-lang/lede/issues/15)
* docs: credit diagram-design for the diagram styling ([21c4a8b](https://github.com/lede-lang/lede/commit/21c4a8b))

## <small>0.1.9 (2026-10-27)</small>

* Merge pull request #14 from lede-lang/docs/fix-install-accuracy ([d46d7e4](https://github.com/lede-lang/lede/commit/d46d7e4)), closes [#14](https://github.com/lede-lang/lede/issues/14)
* docs: correct the install steps for the plugin, the team setup, claude.ai and Codex ([5b233e8](https://github.com/lede-lang/lede/commit/5b233e8))

## <small>0.1.8 (2026-10-27)</small>

* Merge pull request #13 from lede-lang/docs/plugin-not-in-directory ([c845493](https://github.com/lede-lang/lede/commit/c845493)), closes [#13](https://github.com/lede-lang/lede/issues/13)
* revert: restore the Codex install line ([93da77c](https://github.com/lede-lang/lede/commit/93da77c))
* docs: drop the Codex install line ([5dd10de](https://github.com/lede-lang/lede/commit/5dd10de))
* docs: say the plugin is not in Claude Code's directory yet and show the manual install ([72cf7b2](https://github.com/lede-lang/lede/commit/72cf7b2))

## <small>0.1.7 (2026-10-27)</small>

* Merge pull request #1 from lede-lang/dependabot/npm_and_yarn/dev-tooling-dbc8674130 ([e363a40](https://github.com/lede-lang/lede/commit/e363a40)), closes [#1](https://github.com/lede-lang/lede/issues/1)
* Merge pull request #12 from lede-lang/docs/refresh-after-publish ([940b733](https://github.com/lede-lang/lede/commit/940b733)), closes [#12](https://github.com/lede-lang/lede/issues/12)
* Merge pull request #11 from lede-lang/feat/skill-setup-line ([d47dd58](https://github.com/lede-lang/lede/commit/d47dd58)), closes [#11](https://github.com/lede-lang/lede/issues/11)
* docs: ship a README with each npm package and refresh the repo docs after the first publish ([5d6628b](https://github.com/lede-lang/lede/commit/5d6628b))
* docs(skill): tell the agent how to get the compiler, and to ask the user first (D62) ([0958b62](https://github.com/lede-lang/lede/commit/0958b62))
* build(deps-dev): Bump oxfmt ([7952ec7](https://github.com/lede-lang/lede/commit/7952ec7))

## <small>0.1.6 (2026-10-27)</small>

* Merge pull request #10 from lede-lang/ci/stage-npm-publish ([535aaef](https://github.com/lede-lang/lede/commit/535aaef)), closes [#10](https://github.com/lede-lang/lede/issues/10)
* ci(release): stage the npm release with npm stage publish, approved on npm with 2FA (D61) ([960d117](https://github.com/lede-lang/lede/commit/960d117))

## <small>0.1.5 (2026-10-27)</small>

* Merge pull request #5 from lede-lang/feat/build-artifact ([e46644c](https://github.com/lede-lang/lede/commit/e46644c)), closes [#5](https://github.com/lede-lang/lede/issues/5)
* Merge remote-tracking branch 'origin/main' into feat/build-artifact ([22dd1cd](https://github.com/lede-lang/lede/commit/22dd1cd))
* Merge remote-tracking branch 'origin/ci/release-on-github-release' into feat/build-artifact ([f1a1314](https://github.com/lede-lang/lede/commit/f1a1314))
* Merge remote-tracking branch 'origin/main' into feat/build-artifact ([5c75f4c](https://github.com/lede-lang/lede/commit/5c75f4c))
* feat(cli): add build --artifact for the Claude Artifact tool (D59) ([a96ab90](https://github.com/lede-lang/lede/commit/a96ab90))

## <small>0.1.4 (2026-10-27)</small>

* Merge pull request #9 from lede-lang/feat/plugin-links ([8fa4b5f](https://github.com/lede-lang/lede/commit/8fa4b5f)), closes [#9](https://github.com/lede-lang/lede/issues/9)
* Merge pull request #8 from lede-lang/ci/commitlint-skip-dependabot ([da8d3e2](https://github.com/lede-lang/lede/commit/da8d3e2)), closes [#8](https://github.com/lede-lang/lede/issues/8)
* Merge pull request #7 from lede-lang/ci/release-on-github-release ([6fd855e](https://github.com/lede-lang/lede/commit/6fd855e)), closes [#7](https://github.com/lede-lang/lede/issues/7)
* build(plugin): link documentation, support, privacy and terms pages in the Claude manifest ([c100901](https://github.com/lede-lang/lede/commit/c100901))
* ci(commitlint): let Dependabot's "Bump" commits through the subject-case rule ([7f30631](https://github.com/lede-lang/lede/commit/7f30631))
* ci(release): start the staged release from the GitHub release, not the tag push (D60) ([f2a1ad2](https://github.com/lede-lang/lede/commit/f2a1ad2))

## <small>0.1.3 (2026-10-27)</small>

* Merge pull request #6 from lede-lang/docs/readme-author ([aaf33de](https://github.com/lede-lang/lede/commit/aaf33de)), closes [#6](https://github.com/lede-lang/lede/issues/6)
* docs(readme): name the author ([9156311](https://github.com/lede-lang/lede/commit/9156311))

## <small>0.1.2 (2026-10-27)</small>

* Merge pull request #4 from lede-lang/ci/stage-release-on-tag ([32ac51a](https://github.com/lede-lang/lede/commit/32ac51a)), closes [#4](https://github.com/lede-lang/lede/issues/4)
* Merge main into ci/stage-release-on-tag ([68b4f63](https://github.com/lede-lang/lede/commit/68b4f63))
* ci(release): stage the npm release when a tag is pushed, publish on approval (D58) ([a0b93ab](https://github.com/lede-lang/lede/commit/a0b93ab))

## <small>0.1.1 (2026-10-27)</small>

* Merge pull request #3 from lede-lang/feat/plugin-directory-manifest ([ce78a4b](https://github.com/lede-lang/lede/commit/ce78a4b)), closes [#3](https://github.com/lede-lang/lede/issues/3)
* Merge pull request #2 from lede-lang/fix/dogfood-findings ([8454de2](https://github.com/lede-lang/lede/commit/8454de2)), closes [#2](https://github.com/lede-lang/lede/issues/2)
* build(plugin): give the plugin folder its own Claude manifest and icon (D57) ([9cab966](https://github.com/lede-lang/lede/commit/9cab966))
* fix: four defects from a writer dogfood run, recorded as D56 ([d78f3c9](https://github.com/lede-lang/lede/commit/d78f3c9))
