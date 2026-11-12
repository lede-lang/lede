// Decision blocks (spec §4.20, D80): `decision NAME "Question" [status=…] [by=…]` and the `NAME: option | question | role` lines that fill it.
// Parsing, the shape rule, every diagnostic with its `detail`, the shared name registry and streaming.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LedeStream, fix, parse, type Block, type DecisionBlock, type StreamEvent } from '../src/index.ts';

const lines = (...l: string[]) => l.join('\n');
const decisions = (src: string): DecisionBlock[] => parse(src).blocks.filter((b): b is DecisionBlock => b.type === 'decision');
const diags = (src: string) => parse(src).diagnostics.map((d) => `${d.severity}:${d.code}@${d.line}`);
const detail = (src: string, code: string) => parse(src).diagnostics.find((d) => d.code === code)?.detail;

const DESIGN = lines(
  'decision queue "Which queue carries order events?" status=settled by=2026-12-01',
  'queue: option sqs "SQS" | managed, 14-day retention | chosen',
  'queue: option kafka "Kafka" | replay, ops cost | rejected',
  'queue: question "Do we need replay beyond 14 days?" | answered: no',
  'queue: role decides "Ana Ruiz"',
  'queue: role consulted "Platform team"',
  'queue: role informed "Support"',
);

test('the design example parses to one decision with its options, questions and roles', () => {
  const doc = parse(DESIGN);
  assert.deepEqual(doc.diagnostics, []);
  assert.deepEqual(doc.blocks, [
    {
      type: 'decision',
      name: 'queue',
      text: 'Which queue carries order events?',
      status: 'settled',
      by: '2026-12-01',
      options: [
        { id: 'sqs', label: 'SQS', why: 'managed, 14-day retention', verdict: 'chosen', line: 2 },
        { id: 'kafka', label: 'Kafka', why: 'replay, ops cost', verdict: 'rejected', line: 3 },
      ],
      questions: [{ text: 'Do we need replay beyond 14 days?', answer: 'no', line: 4 }],
      roles: [
        { role: 'decides', who: 'Ana Ruiz', line: 5 },
        { role: 'consulted', who: 'Platform team', line: 6 },
        { role: 'informed', who: 'Support', line: 7 },
      ],
      line: 1,
    },
  ]);
});

test('a bare declaration is an open decision with no date, and the lines may be spaced or come after other blocks', () => {
  const [d] = decisions('decision q "Ship it?"');
  assert.deepEqual([d.status, d.by, d.options, d.questions, d.roles], ['open', null, [], [], []]);
  const [e] = decisions(lines('decision q "Ship it?"', '', 'A paragraph.', '', 'q: option y "Yes"'));
  assert.equal(e.options.length, 1);
  // Quotes in a question follow the one rule of the format: "" or \" is a quote.
  assert.equal(decisions('decision q "Is a ""queue"" a \\"queue\\"?"')[0].text, 'Is a "queue" a "queue"?');
});

test('the shape rule: the word is a keyword line only with a name and a quoted question, so prose that starts with it stays prose', () => {
  for (const prose of [
    'decision was made on Monday.',
    'decision queue is long',
    'decision queue',
    "decision queue 'Which?'",
    'decision 1x "A"',
    'decision "A" b',
    'decision',
  ]) {
    const doc = parse(prose);
    assert.deepEqual(
      doc.blocks.map((b) => b.type),
      ['paragraph'],
      prose,
    );
    assert.deepEqual(doc.diagnostics, [], prose);
  }
  // A leading backslash writes the line as text, as for every keyword.
  assert.deepEqual(
    parse('\\decision queue "Which?"').blocks.map((b) => b.type),
    ['paragraph'],
  );
  // The question left out fails loudly: the line has the shape of a declaration when `status=` or `by=` follows the name.
  assert.deepEqual(diags('decision queue status=open'), ['error:decision-syntax@1']);
  assert.deepEqual(diags('decision queue by=2026-12-01 "Which?"'), ['error:decision-syntax@1']);
  // `decision` is a keyword now, so it cannot name a diagram.
  assert.deepEqual(diags('diagram decision'), ['error:diagram-name@1']);
});

test('status: open, settled or deferred in any case; another word is W decision-status and reads as open', () => {
  assert.deepEqual(
    ['open', 'SETTLED', 'Deferred'].map((s) => decisions(`decision q "Q?" status=${s}`)[0].status),
    ['open', 'settled', 'deferred'],
  );
  assert.deepEqual(
    decisions('decision q "Q?" status="settled"').map((d) => d.status),
    ['settled'],
  );
  assert.deepEqual(diags('decision q "Q?" status=done'), ['warning:decision-status@1']);
  assert.deepEqual(detail('decision q "Q?" status=done', 'decision-status'), { kind: 'status', value: 'done' });
  assert.equal(decisions('decision q "Q?" status=done')[0].status, 'open');
});

test('by: any text, kept as written; an empty value is no date', () => {
  assert.equal(decisions('decision q "Q?" by=2026-12-01')[0].by, '2026-12-01');
  assert.equal(decisions('decision q "Q?" by=Q1')[0].by, 'Q1');
  assert.equal(decisions('decision q "Q?" by="end of sprint"')[0].by, 'end of sprint');
  assert.equal(decisions('decision q "Q?" by=')[0].by, null);
  // An option the line does not take is W decision-option, once for each, and the rest of the line still reads.
  const doc = parse('decision q "Q?" owner=ana urgent "loud" by=Friday');
  assert.deepEqual(
    doc.diagnostics.map((d) => d.code),
    ['decision-option', 'decision-option', 'decision-option'],
  );
  assert.equal((doc.blocks[0] as DecisionBlock).by, 'Friday');
  assert.deepEqual(diags('decision q "Q?" by="never closed'), ['warning:decision-option@1']);
});

test('verdicts: chosen, picked and selected choose, rejected rejects, in any case; none is none', () => {
  const src = lines(
    'decision q "Q?"',
    'q: option a "A" | why | chosen',
    'q: option b "B" | why | Picked',
    'q: option c "C" | why | SELECTED',
    'q: option d "D" | why | rejected',
    'q: option e "E" | why',
    'q: option f "F"',
    'q: option g "G" | why |',
  );
  const d = decisions(src)[0];
  assert.deepEqual(
    d.options.map((o) => o.verdict),
    ['chosen', 'chosen', 'chosen', 'rejected', null, null, null],
  );
  assert.deepEqual(diags(src), []);
  // Any other word is W decision-status; the option stays, with no verdict.
  const odd = 'decision q "Q?"\nq: option a "A" | why | winner';
  assert.deepEqual(diags(odd), ['warning:decision-status@2']);
  assert.deepEqual(detail(odd, 'decision-status'), { kind: 'verdict', value: 'winner' });
  assert.equal(decisions(odd)[0].options[0].verdict, null);
  // A lone cell that is a verdict word is the verdict, not the reason.
  const lone = decisions('decision q "Q?"\nq: option a "A" | chosen\nq: option b "B" | because of cost')[0];
  assert.deepEqual(
    lone.options.map((o) => [o.why, o.verdict]),
    [
      ['', 'chosen'],
      ['because of cost', null],
    ],
  );
});

test('a reason in double quotes may hold a |; an option has at most a label, a reason and a verdict', () => {
  const d = decisions('decision q "Q?"\nq: option a "A | B" | "fast | cheap" | chosen')[0];
  assert.deepEqual([d.options[0].label, d.options[0].why, d.options[0].verdict], ['A | B', 'fast | cheap', 'chosen']);
  assert.deepEqual(diags('decision q "Q?"\nq: option a "A" | why | chosen | more'), ['error:decision-syntax@2']);
  assert.deepEqual(diags('decision q "Q?"\nq: option a "A" | "never closed | chosen'), ['error:decision-syntax@2']);
  assert.deepEqual(diags('decision q "Q?"\nq: option a "A" | "quoted" x | chosen'), ['error:decision-syntax@2']);
});

test('questions: with no answer a question is open; `answered:` or `answer:` leads the answer and is dropped', () => {
  const d = decisions(
    lines(
      'decision q "Q?"',
      'q: question "Open one?"',
      'q: question "Empty answer?" |',
      'q: question "Plain?" | no',
      'q: question "Lead?" | answered: yes, later',
      'q: question "Lead two?" | Answer: maybe',
      'q: question "Quoted?" | "a | b"',
    ),
  )[0];
  assert.deepEqual(
    d.questions.map((x) => x.answer),
    [null, null, 'no', 'yes, later', 'maybe', 'a | b'],
  );
});

test('roles: one or two words, then the name in quotes', () => {
  const d = decisions('decision q "Q?"\nq: role decides "Ana Ruiz"\nq: role signs off "Bo"')[0];
  assert.deepEqual(
    d.roles.map((r) => [r.role, r.who]),
    [
      ['decides', 'Ana Ruiz'],
      ['signs off', 'Bo'],
    ],
  );
});

test('decision-syntax carries the word whose line failed', () => {
  const head = 'decision q "Q?"\n';
  const word = (line: string) => (detail(head + line, 'decision-syntax') as { word: string } | undefined)?.word;
  assert.equal(word('q: choice a "A"'), 'line');
  assert.equal(word('q:'), 'line');
  assert.equal(word('q: option "A"'), 'option');
  assert.equal(word('q: option a A'), 'option');
  assert.equal(word('q: option a ""'), 'option');
  assert.equal(word('q: option a "A" why'), 'option');
  assert.equal(word('q: question Q'), 'question');
  assert.equal(word('q: question "Q" answer'), 'question');
  assert.equal(word('q: role "Ana"'), 'role');
  assert.equal(word('q: role decides'), 'role');
  assert.equal(word('q: role a b c "Ana"'), 'role');
  assert.equal(word('q: role decides "Ana" "Bo"'), 'role');
  assert.equal(word('q: role decides ""'), 'role');
  for (const bad of ['decision a status=open', 'decision html "Q?"', 'decision data "Q?"', 'decision b "open', 'decision c ""']) {
    assert.deepEqual(diags(bad), ['error:decision-syntax@1'], bad);
    assert.deepEqual(detail(bad, 'decision-syntax'), { word: 'decision' }, bad);
    assert.deepEqual(decisions(bad), [], 'a declaration with an error is no block');
  }
  // A rejected line adds nothing.
  assert.deepEqual(decisions(head + 'q: option a "A" why\nq: role decides')[0].options, []);
});

test('decision-ref: a repeated option id, a repeated decision name, and a decision line with no decision above it', () => {
  const dup = 'decision q "Q?"\nq: option a "A"\nq: option a "A again"';
  assert.deepEqual(diags(dup), ['error:decision-ref@3']);
  assert.deepEqual(detail(dup, 'decision-ref'), { name: 'q', id: 'a', first: 2 });
  assert.equal(decisions(dup)[0].options.length, 1, 'the first is kept');
  const twice = 'decision q "Q?"\ndecision q "Q again?"';
  assert.deepEqual(diags(twice), ['error:decision-ref@2']);
  assert.deepEqual(detail(twice, 'decision-ref'), { name: 'q', first: 1 });
  assert.equal(decisions(twice).length, 1);
  for (const ghost of ['ghost: option a "A"', 'ghost: question "Where?"', 'ghost: role decides "Nobody"']) {
    assert.deepEqual(diags(ghost), ['error:decision-ref@1'], ghost);
    assert.deepEqual(detail(ghost, 'decision-ref'), { name: 'ghost' }, ghost);
  }
  // Prose with a colon, even one that starts with the words, is not a decision line without the shape; a backslash writes it as text.
  assert.deepEqual(diags('Note: option of the week is red'), []);
  assert.deepEqual(diags('Note: question time starts at 10'), []);
  assert.deepEqual(diags('ghost: \\option a "A"'), []);
  assert.deepEqual(diags('\\ghost: option a "A"'), []);
});

test("decision lines and the pipe rows of a data set (D80) share the NAME: form without taking each other's lines", () => {
  const src = lines(
    'data t = a, b',
    'decision d "Which?"',
    't: x | 1',
    'd: option o "O" | because | chosen',
    't: y | 2',
    'd: question "Q?" | yes',
    't: option "z" | 3',
    'd: role decides "Ana"',
  );
  const doc = parse(src);
  assert.deepEqual(doc.diagnostics, []);
  assert.deepEqual(doc.data.t.rows, [
    ['x', '1'],
    ['y', '2'],
    ['option "z"', '3'],
  ]);
  const [d] = decisions(src);
  assert.deepEqual(
    [d.options.length, d.questions.length, d.roles.length, d.options[0].verdict, d.questions[0].answer],
    [1, 1, 1, 'chosen', 'yes'],
  );
  // The same lines, one at a time: a data row is a data update and a decision line a decision update, each in its own place.
  const events = new LedeStream();
  const kinds: string[] = [];
  for (const l of src.split('\n'))
    for (const e of events.events(`${l}\n`)) kinds.push(e.kind === 'update' && 'data' in e ? `data:${e.data}` : e.kind);
  assert.deepEqual(
    kinds.filter((k) => k.startsWith('data:') || k === 'decision-update'),
    ['data:t', 'decision-update', 'data:t', 'decision-update', 'data:t', 'decision-update'],
  );
  // A decision line whose name is no decision and no data set is still E decision-ref, and a data set's pipe row of that shape is not.
  assert.deepEqual(diags(lines('data t = a, b', 't: option z "Z" | 3', 'u: option z "Z" | 3')), ['error:decision-ref@3']);
});

test('a decision shares one name registry with data, diagrams and bucket sets: E name-clash {decision}, and the decision is refused', () => {
  const taken = [
    ['data q = a,b; 1,2\ndecision q "Q?"', 2],
    ['diagram q\nq: a -> b\ndecision q "Q?"', 3],
    ['bucket q | A, B\nq: x | A\nexport json\ndecision q "Q?"', 4],
  ] as const;
  for (const [src, line] of taken) {
    assert.ok(diags(src).includes(`error:name-clash@${line}`), src);
    assert.deepEqual(detail(src, 'name-clash'), { decision: 'q' }, src);
    assert.deepEqual(decisions(src), [], 'the second declaration is refused');
  }
  // And the other way round: a decision declared first makes the later data, diagram or bucket set the one in error.
  for (const later of ['data q = a,b; 1,2', 'diagram q', 'bucket q | A, B']) {
    const src = `decision q "Q?"\n${later}`;
    assert.ok(diags(src).includes('error:name-clash@2'), src);
    assert.deepEqual(detail(src, 'name-clash'), { decision: 'q' }, src);
  }
  // `lede check --fix` leaves it: it renames a diagram that clashes with data, and only that.
  const clash = 'decision q "Q?"\ndiagram q\nq: a -> b';
  assert.equal(fix(clash).src, clash);
  // A decision and a question word may share a name: the word has no `NAME:` lines.
  assert.deepEqual(diags('decision q "Q?"\nask q | Name?\nexport json'), []);
});

test('a decision inside a grid or a cards run takes its lines like any other', () => {
  const d = decisions(lines('cards', '### One', 'decision q "Q?"', 'q: option a "A" | why | chosen', '### Two', 'Text.'));
  assert.equal(d.length, 0, 'a decision in a card is not a top-level block');
  const doc = parse(lines('cards', '### One', 'decision q "Q?"', 'q: option a "A" | why | chosen', '### Two', 'Text.'));
  const card = doc.blocks[0];
  assert.ok(card.type === 'cards');
  const inside = card.items[0].blocks[0] as DecisionBlock;
  assert.deepEqual([inside.type, inside.options.length], ['decision', 1]);
});

// ---------------------------------------------------------------- streaming

const kind = (e: StreamEvent) =>
  e.kind === 'block' ? `block:${e.block.type}` : 'data' in e ? `update:data ${e.data}` : `${e.kind}:${e.block.type}`;
const names = (events: StreamEvent[]) => events.map(kind);

test('a decision streams as a diagram does: given on its declaration, an update per line, a seal at the first other non-blank line', () => {
  const s = new LedeStream();
  assert.deepEqual(names(s.events('decision q "Q?" status=open\n')), ['block:decision']);
  // A blank line between lines does not seal.
  assert.deepEqual(names(s.events('q: option a "A"\n\nq: question "Why?"\nq: role decides "Ana"\n')), [
    'decision-update:decision',
    'decision-update:decision',
    'decision-update:decision',
  ]);
  // A rejected line is no update, and still a line of the decision.
  assert.deepEqual(names(s.events('q: option a "A"\nq: nonsense\nq:\n')), []);
  assert.deepEqual(
    s.doc.diagnostics.map((d) => d.code),
    ['decision-ref', 'decision-syntax', 'decision-syntax'],
  );
  assert.deepEqual(names(s.events('Done.\n')), ['decision-seal:decision']);
  assert.deepEqual(names(s.events('More.\n')), []);
  // A line after the seal is an update again and the next sealing line a second seal.
  assert.deepEqual(names(s.events('q: option b "B" | | chosen\n')), ['block:paragraph', 'decision-update:decision']);
  assert.deepEqual(names(s.events('# Heading\n')), ['block:heading', 'decision-seal:decision']);
  const d = s.doc.blocks.find((b): b is DecisionBlock => b.type === 'decision')!;
  assert.deepEqual([d.options.length, d.questions.length, d.roles.length], [2, 1, 1]);
  // The update names the object the declaration returned.
  const t = new LedeStream();
  const [declared] = t.events('decision q "Q?"\n');
  const [update] = t.events('q: option a "A"\n');
  assert.ok(declared.kind === 'block' && update.kind === 'decision-update');
  assert.equal(update.block, declared.block);
  // end() reads the unterminated last line and seals what is still open.
  const u = new LedeStream();
  u.events('decision q "Q?"\ndiagram d\nd: p -> q\nq: role decides "Ana"');
  const atEnd: string[] = [];
  u.end((e) => atEnd.push(kind(e)));
  assert.deepEqual(atEnd, ['decision-update:decision', 'seal:diagram', 'decision-seal:decision']);
});

test('a decision in a cards run that has not been returned yet has no update events, and the run holds it in full when it ends', () => {
  const s = new LedeStream();
  const ev = s.events(lines('cards', '### One', 'decision q "Q?"', 'q: option a "A"', 'q: option b "B"', '## Next', ''));
  assert.deepEqual(names(ev), ['block:cards', 'block:heading']);
  const cards = ev[0].kind === 'block' ? ev[0].block : null;
  assert.ok(cards?.type === 'cards');
  assert.equal((cards.items[0].blocks[0] as DecisionBlock).options.length, 2);
});

test('whatever the chunking, the events are the same and the stream ends at the whole parse', () => {
  const src = lines(DESIGN, '', 'Between.', '', 'decision region "Where?" by=Q1', 'region: option eu "EU" | near | picked', '');
  const whole = parse(src);
  const reference = (() => {
    const s = new LedeStream();
    const all = [...s.events(src)];
    s.end((e) => all.push(e));
    return all.map(kind);
  })();
  for (const n of [1, 3, 11, 64]) {
    const s = new LedeStream();
    const all: StreamEvent[] = [];
    for (let i = 0; i < src.length; i += n) all.push(...s.events(src.slice(i, i + n)));
    const doc = s.end((e) => all.push(e));
    assert.deepEqual(all.map(kind), reference, `chunks of ${n}`);
    assert.deepEqual(doc, whole, `chunks of ${n}`);
  }
  // A snapshot after every line is a valid document whose decision is the lines so far.
  const text = src.split('\n');
  for (let n = 1; n <= text.length; n++) {
    const s = new LedeStream();
    s.write(`${text.slice(0, n).join('\n')}\n`);
    const snap = s.snapshot();
    assert.ok(
      snap.blocks.some((b: Block) => b.type === 'decision'),
      `line ${n}`,
    );
    assert.deepEqual(snap.diagnostics, [], `line ${n}`);
  }
});
