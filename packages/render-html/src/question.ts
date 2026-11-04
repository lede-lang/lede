// Markup for the question words (spec §4.18) and the editor words (spec §4.19). Plain controls with a fixed attribute set; no
// script, no form, no id. The shell adds its buttons and copy bar on top of exactly this markup (spec §7).
import {
  fieldsOf,
  presetsOf,
  type AskBlock,
  type Block,
  type BucketBlock,
  type ChooseBlock,
  type ConfirmBlock,
  type ExportBlock,
  type ParamBlock,
  type PresetBlock,
  type QuestionBlock,
  type TemplateBlock,
  type ToggleBlock,
} from '@lede-lang/core';
import { esc, inline, plain } from './util.ts';

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

const EDITOR_KINDS: ReadonlySet<string> = new Set(['param', 'toggle', 'bucket', 'template']);

/** Whether the page draws an editor word, which is when it carries the CSS for them (spec §4.19). */
export const usesEditors = (blocks: Block[]): boolean =>
  fieldsOf(blocks).some((f) => EDITOR_KINDS.has(f.type)) || presetsOf(blocks).length > 0;

const num = (n: number) => esc(String(n));

/** A slider and a number box that share a name, bounds and value; the number box is the one the export reads. */
export function paramHtml(b: ParamBlock): string {
  const at = `name="${esc(b.name)}" min="${num(b.min)}" max="${num(b.max)}" step="${num(b.step)}" value="${num(b.value)}" autocomplete="off"`;
  const unit = b.unit ? `<span class="q-u">${esc(b.unit)}</span>` : '';
  return (
    `<label class="q q-param"><span class="q-t">${inline(b.text)}</span><span class="q-pr"><input type="range" ${at}>` +
    `<input type="number" ${at} aria-label="${esc(plain(b.text))}, value">${unit}</span></label>`
  );
}

/** The warning and the status sit outside the label, so the checkbox's name is the label alone. */
export function toggleHtml(b: ToggleBlock): string {
  const needs = b.needs?.length ? `<span class="q-nd">Needs ${b.needs.map(esc).join(', ')}</span>` : '';
  return (
    `<div class="q q-toggle"><label><input type="checkbox" name="${esc(b.name)}" value="on" autocomplete="off"${b.on ? ' checked' : ''}>` +
    `<span class="q-t">${inline(b.text)}</span></label>${needs}<span class="q-st" role="status"></span></div>`
  );
}

/** A count tile per bucket and a row per item with one radio per bucket, the written one checked. Items never move. */
export function bucketHtml(b: BucketBlock): string {
  const legend = b.text === null ? esc(b.name) : inline(b.text);
  const tiles = b.buckets.map((x) => `<li><span class="q-n">${b.items.filter((i) => i.bucket === x).length}</span> ${esc(x)}</li>`);
  const rows = b.items.map((it, i) => {
    const seg = b.buckets.map(
      (x) =>
        `<label><input type="radio" name="${esc(b.name)}:${i}" value="${esc(x)}" autocomplete="off"${x === it.bucket ? ' checked' : ''}><span>${esc(x)}</span></label>`,
    );
    return `<li class="q-item"><span class="q-il">${esc(it.text)}</span><span class="q-seg">${seg.join('')}</span></li>`;
  });
  return (
    `<fieldset class="q q-bucket"><legend class="q-t">${legend}</legend><ul class="q-bk">${tiles.join('')}</ul>` +
    `${rows.length ? `<ol class="q-items">${rows.join('')}</ol>` : ''}</fieldset>`
  );
}

/** `filled` is the body with its slots filled from the page's written values. The count is of characters (code points). */
export function templateHtml(b: TemplateBlock, filled: string): string {
  return (
    `<figure class="q q-tpl"><figcaption class="q-t">${inline(b.text)}</figcaption>` +
    `<pre class="code" tabindex="0" role="region" aria-label="${esc(plain(b.text))}"><code>${esc(filled)}</code></pre>` +
    `<p class="q-cnt"><span class="q-n">${Array.from(filled).length}</span> characters</p></figure>`
  );
}

/** Its values as text. The button exists only with the shell, hidden until the runtime reveals it, as `q-clear` is. */
export function presetHtml(b: PresetBlock, shell: boolean, fields: QuestionBlock[]): string {
  const shown = b.values.map((v) => {
    const f = fields.find((x) => x.name === v.name);
    return `${v.name} ${f?.type === 'param' && f.unit ? `${v.value} ${f.unit}` : v.value}`;
  });
  const button = shell ? `<button type="button" class="q-pre" hidden>${esc(plain(b.text))}</button>` : '';
  return `<div class="q q-preset">${button}<span class="q-pv">${inline(b.text)}: ${esc(shown.join(', '))}</span></div>`;
}

const NAMES = { json: 'JSON', markdown: 'Markdown', prompt: 'Prompt' } as const;

/** `template` is the export of the page as written. In shell mode the copy bar follows it. */
export function exportHtml(b: ExportBlock, template: string, shell: boolean): string {
  const name = NAMES[b.format];
  const note =
    b.format === 'prompt'
      ? 'This lists no changes yet. Edit it to say what you changed, and paste it back.'
      : 'Copy this, fill in the values after the colons, and paste it back.';
  const bar = shell
    ? `<div class="q-bar" hidden><button type="button" class="q-copy">Copy ${name}</button><span class="q-st" role="status"></span><span class="q-xn2">Answers stay in this tab until you copy them.</span></div>`
    : '';
  return (
    `<figure class="q-x" data-x="${b.format}"><figcaption class="q-xt">Answers (${name})</figcaption>` +
    `<pre class="code" tabindex="0" role="region" aria-label="${name} answers template"><code>${esc(template)}</code></pre>` +
    `<p class="q-xn">${note}</p>${bar}</figure>`
  );
}
