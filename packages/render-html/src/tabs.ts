// A page of tabs (spec §4.21, D85): the manifest's masthead and lead, a bar of links, and one panel per part. Switching is `:target`
// and `:has()` in CSS (theme.ts `tabsCss`), so the page carries no script and every tab has a URL.
import type { LedeDocument, TabBlock, TabPart } from '@lede-lang/core';
import { Ctx, LAYOUT_CLASS, masthead, pageHtml, pageParts, renderMain, styleOf, type RenderOptions } from './index.ts';
import { usesEditors } from './question.ts';
import { tabsCss } from './theme.ts';
import { esc, inline, plain, slug } from './util.ts';

/**
 * `html` with every `id` given `prefix`: a sanitized `html` fence inside a tab's panel. Sanitized markup writes a quote inside a value as
 * `&quot;`, so ` id="` only ever opens an attribute.
 */
export const prefixIds = (html: string, prefix: string): string => html.replace(/(\sid=")/g, `$1${prefix}`);

/**
 * A panel's markup with each in-page link to one of its own ids given the panel's `prefix`, as the ids were, so a link the part's writer
 * made to one of its headings still lands on it. A link to an id the panel does not hold is left as written, so `#costs` in one part
 * opens the Costs tab. Every attribute value is escaped (`&quot;` inside it), so ` id="` and ` href="#` only ever open an attribute.
 */
function prefixLinks(html: string, prefix: string): string {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  return html.replace(/(\shref="#)([^"]+)"/g, (all, open: string, to: string) => (ids.has(prefix + to) ? `${open}${prefix}${to}"` : all));
}

/** A tab line drawn where no part was read for it (the streaming form, or a caller that did not resolve the tabs). */
export const tabPlaceholder = (b: TabBlock): string =>
  `<p class="tabref">Tab${b.label ? ` <strong>${inline(b.label)}</strong>` : ''}: <code>${esc(b.path)}</code></p>`;

/** The page of tabs for the manifest `doc` and its resolved `parts`. */
export async function renderTabs(doc: LedeDocument, parts: readonly TabPart[], opts: RenderOptions): Promise<string> {
  const own = { ...opts, shell: false };
  const ctx = new Ctx(doc, own);
  const mh = masthead(doc, ctx);
  const { body } = await renderMain(doc, ctx, { ...mh, rest: mh.rest.filter((b) => b.type !== 'tab') });
  // A panel's id is its label's slug, made unique against the lead's ids and the panels before it.
  const taken = new Set([...body.join('').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const features = [pageParts(doc.blocks)];
  let dash = false;
  const links: string[] = [];
  const panels: string[] = [];
  for (const [i, p] of parts.entries()) {
    const stem = slug(p.label).replace(/-{2,}/g, '-');
    let id = stem;
    for (let k = 2; taken.has(id); k++) id = `${stem}-${k}`;
    taken.add(id);
    const pc = new Ctx(p.doc, own);
    pc.idPrefix = `${id}--`;
    pc.base = 1;
    pc.shift = 1;
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose: one panel at a time keeps the flow layouts' memory flat
    const { body: kids, layout } = await renderMain(p.doc, pc, masthead(p.doc, pc));
    dash ||= layout === 'dashboard';
    features.push(pageParts(p.doc.blocks));
    const n = i + 1;
    const sha = p.sha ? ` data-sha="${p.sha}"` : '';
    links.push(`<a class="tl tl${n}" href="#${id}">${esc(plain(p.label))}</a>`);
    panels.push(
      `<section class="doc part p${n}${LAYOUT_CLASS[layout]}" id="${id}" aria-label="${esc(plain(p.label))}" data-part="${esc(p.tab.path)}"${sha}>\n${prefixLinks(kids.filter(Boolean).join('\n'), pc.idPrefix)}\n</section>`,
    );
  }
  const nav = parts.length ? `<nav class="tabbar" aria-label="Tabs" tabindex="0">${links.join('')}</nav>` : '';
  const main = `<main class="doc tabs">\n${[...body, nav, ...panels].filter(Boolean).join('\n')}\n</main>`;
  const fields = features.flatMap((f) => f.fields);
  const sheet = styleOf(doc.meta, {
    controls: fields.length > 0 || features.some((f) => f.exports.length > 0),
    editors: usesEditors(
      fields,
      features.flatMap((f) => f.presets),
    ),
    dash,
    decisions: features.some((f) => f.decisions),
    code: features.some((f) => f.code),
    theme: opts.theme,
  });
  return pageHtml(doc, mh.title, `<style>${sheet}${tabsCss(parts.length)}</style>`, main, '', own, false);
}
