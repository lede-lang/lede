// Markup for a decision block (spec §4.20, D80): one static card, no script, no control. The question, a status chip and the date, the
// options with their verdicts, the questions with their answers, and the roles. Every state is said in words as well as drawn in
// colour: the status and each verdict are text, and a rejected option's label is also struck through.
import type { DecisionBlock, DecisionStatus } from '@lede-lang/core';
import { ISO_DATE, esc, inline } from './util.ts';

/** The status chip: the existing status pills, `settled` good, `open` warn and `deferred` the neutral grey (the `neutral` tone, D80). */
const STATUS: Record<DecisionStatus, { text: string; tone: string }> = {
  settled: { text: 'Settled', tone: 'good' },
  open: { text: 'Open', tone: 'warn' },
  deferred: { text: 'Deferred', tone: 'neutral' },
};

/** `id` names the question, which labels the card for a screen reader; the renderer takes it from its counter, as a chart does. */
export function decisionHtml(b: DecisionBlock, id: string): string {
  const { text, tone } = STATUS[b.status];
  const by =
    b.by === null
      ? ''
      : ISO_DATE.test(b.by)
        ? `<time class="chip" datetime="${b.by}">by ${esc(b.by)}</time>`
        : `<span class="chip">by ${esc(b.by)}</span>`;
  const head =
    `<div class="dc-h"><p class="dc-q" id="${id}">${inline(b.text)}</p>` +
    `<p class="dc-s"><span class="sr">Status: </span><span class="pill ${tone}">${text}</span>${by}</p></div>`;
  const options = b.options.map((o) => {
    const mark =
      o.verdict === 'chosen'
        ? '<span class="pill good">Chosen</span>'
        : o.verdict === 'rejected'
          ? '<span class="pill bad">Rejected</span>'
          : '';
    const why = o.why ? `<span class="dc-w">${inline(o.why)}</span>` : '';
    return `<li${o.verdict ? ` class="${o.verdict}"` : ''}><span class="dc-ol">${inline(o.label)}</span>${mark}${why}</li>`;
  });
  const questions = b.questions.map((q) =>
    q.answer === null
      ? `<li class="open"><span class="dc-qt">${inline(q.text)}</span><span class="pill warn">Open</span></li>`
      : `<li><span class="dc-qt">${inline(q.text)}</span><span class="dc-a"><b class="dc-al">Answer</b> ${inline(q.answer)}</span></li>`,
  );
  const roles = b.roles.map((r) => `<div><dt>${esc(r.role)}</dt><dd>${inline(r.who)}</dd></div>`);
  return (
    `<section class="decision" aria-labelledby="${id}">${head}` +
    (options.length ? `<p class="dc-l">Options</p><ul class="dc-opts">${options.join('')}</ul>` : '') +
    (questions.length ? `<p class="dc-l">Questions</p><ul class="dc-qa">${questions.join('')}</ul>` : '') +
    (roles.length ? `<dl class="dc-roles">${roles.join('')}</dl>` : '') +
    `</section>`
  );
}
