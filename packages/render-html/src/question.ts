// Markup for the question words (spec §4.18). Plain controls with a fixed attribute set; no script, no form, no id. The
// shell adds its buttons and copy bar on top of exactly this markup (spec §7).
import {
  fieldsOf,
  type AskBlock,
  type Block,
  type ChooseBlock,
  type ConfirmBlock,
  type ExportBlock,
  type QuestionBlock,
} from '@lede-lang/core';
import { esc, inline } from './util.ts';

export function askHtml(b: AskBlock): string {
  const control =
    b.lines > 1
      ? `<textarea name="${esc(b.name)}" rows="${b.lines}" autocomplete="off"></textarea>`
      : `<input type="text" name="${esc(b.name)}" autocomplete="off">`;
  return `<label class="q q-ask"><span class="q-t">${inline(b.text)}</span>${control}</label>`;
}

const radio = (name: string, value: string, label: string, cls = '') =>
  `<label class="q-o${cls}"><input type="radio" name="${esc(name)}" value="${esc(value)}" autocomplete="off"><span>${esc(label)}</span></label>`;

const clear = (shell: boolean) => (shell ? '<button type="button" class="q-clear" hidden>Clear</button>' : '');

export function chooseHtml(b: ChooseBlock, shell: boolean): string {
  const legend = b.text === null ? esc(b.name) : inline(b.text);
  return `<fieldset class="q q-choose"><legend class="q-t">${legend}</legend>${b.options.map((o) => radio(b.name, o, o)).join('')}${clear(shell)}</fieldset>`;
}

export function confirmHtml(b: ConfirmBlock, shell: boolean): string {
  return `<fieldset class="q q-confirm"><legend class="q-t">${inline(b.text)}</legend>${radio(b.name, 'approved', 'Approve', ' q-yes')}${radio(b.name, 'rejected', 'Reject', ' q-no')}${clear(shell)}</fieldset>`;
}

/**
 * The fields this renderer draws and exports so far. The editor words (spec §4.19) parse, and the render change that follows the
 * parser draws them; until then they are left out of the page and of its export, which stay as they were.
 */
export const drawnFields = (blocks: Block[]): QuestionBlock[] =>
  fieldsOf(blocks).filter((f) => f.type === 'ask' || f.type === 'choose' || f.type === 'confirm');

const NAMES = { json: 'JSON', markdown: 'Markdown', prompt: 'Prompt' } as const;

/** `template` is the export of the blank page. In shell mode the copy bar follows it. */
export function exportHtml(b: ExportBlock, template: string, shell: boolean): string {
  const name = NAMES[b.format];
  const bar = shell
    ? `<div class="q-bar" hidden><button type="button" class="q-copy">Copy ${name}</button><span class="q-st" role="status"></span><span class="q-xn2">Answers stay in this tab until you copy them.</span></div>`
    : '';
  return (
    `<figure class="q-x" data-x="${b.format}"><figcaption class="q-xt">Answers (${name})</figcaption>` +
    `<pre class="code" tabindex="0" role="region" aria-label="${name} answers template"><code>${esc(template)}</code></pre>` +
    `<p class="q-xn">Copy this, fill in the values after the colons, and paste it back.</p>${bar}</figure>`
  );
}
