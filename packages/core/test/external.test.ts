// `lede check --external` (D80): the scanner over the source text, its false-positive and true-positive corpora, the allow list, the
// redaction, and inputs that must not make it slow. Credentials are built from pieces so that no secret scanner reads this file as
// one: the values are made up and belong to nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXTERNAL_PLACEHOLDERS, externalDiagnostics, redactExternal, scanExternal, type ExternalKind } from '../src/index.ts';

const found = (src: string, allow: string[] = []) => scanExternal(src, { allow }).map((f) => [f.kind, f.text]);

/** The pieces joined, so that no secret scanner reads a credential in this file. */
const cat = (...parts: string[]): string => parts.join('');
const AWS_KEY = cat('AK', 'IA', 'ABCDEFGH', '12345678');
const AWS_TEMP = cat('AS', 'IA', 'ABCDEFGH', '12345678');
const GH_TOKEN = cat('gh', 'p_', 'Ab1'.repeat(12));
const GH_OAUTH = cat('gh', 'o_', 'Zz9'.repeat(12));
const GH_PAT = cat('github', '_pat_', 'Ab1Cd2Ef3Gh4'.repeat(3));
const SLACK = cat('xo', 'xb-', '123456789012-', '1234567890123-', 'AbCdEfGhIjKlMnOpQrStUvWx');
const STRIPE = cat('sk', '_live_', '0123456789abcdefABCD');
const ANTHROPIC = cat('sk', '-ant-', 'api03-', 'Ab1'.repeat(10));
const OPENAI = cat('sk', '-proj-', 'Zz9Yy8'.repeat(6));
const JWT = cat('ey', 'JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '.', 'ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'c2lnbmF0dXJlLXBsYWNlaG9sZGVy');
const PEM_BEGIN = cat('-----', 'BEGIN RSA PRIVATE', ' KEY-----');
const PEM_END = cat('-----', 'END RSA PRIVATE', ' KEY-----');
const HEX32 = '0123456789abcdef'.repeat(2);
const B64 = cat('wJalrXUtnFEMI/K7MDENG/', 'bPxRfiCYEXAMPLEKEY');

/** Source text that must give nothing away. */
const FALSE_POSITIVES: string[] = [
  // versions, dates, times, numbers
  'Version 1.2.3 shipped; v0.2.1 follows, then v10.20.30 and 1.0.0-beta.2, 2.0.0.rc1, 1.2.3+build.5 and 3.9.dev.',
  'numpy 1.26.4 on Python 3.12.1, released 2026-11-12, or 12/11/2026, or 12.11.2026, or Nov. 12.',
  'Standup at 10:30, then 9:05:07 and 12:30:45, a 3:1 ratio, Mon 10:00-11:30, 14:00:00.123.',
  'Latency fell 10.5 ms to 9.75 ms (-7.1%), 12.5% of $1,234.56, 3.14159, 0.001, 1e-9, 1.5e12, EUR 12,50 and 1.000.000.000.',
  'kpi Latency | 10.5 ms | -2.1%',
  'kpi Uptime | 99.95% | +0.02',
  'Build 202611121530 ran; call +441234567890; epoch 1700000000000; id 12345678901; decimal 0.123456789012.',
  'A 4-part version, 1.2.3.4.5, and a section number 2.3.4.5.6.',
  // file names, dotted words, abbreviations
  'chart.png, photo.jpg, notes.txt, data.csv, report.pdf, index.html, style.css, config.yaml, package.json, tsconfig.json, a.out',
  'README.md, main.py, lib.rs, build.sh, run.pl, archive.zip, clip.mov, Makefile, node.js, Node.js, Next.js, Vue.js, three.js',
  'Use e.g., i.e., etc., vs., approx., U.S., Ph.D., a.m. and p.m. freely.',
  '.gitignore, .env.local, ~/.config/app, ./scripts/build.sh, ../images/a.svg, src/lib/a.test.ts',
  'image chart.png "A chart"',
  'data x < file.csv',
  'chart line sales x=month y=revenue min=0 max=100',
  'a -> b : Mcp-Name',
  '@title Quarterly review',
  '@accent #0b5fff',
  '@author Ada Lovelace, Analyst',
  // code that looks like names
  'ASP.NET, VB.NET, System.Net.Http, System.Net, .NET 8',
  'logger.info("x"); self.dev(1); np.int; v.xyz; process.env.NODE_ENV; import os.path',
  'std::vector<int> v; Foo::bar(); Dec::Face; a::b; x == y',
  'lede@0.2.3, npm i pkg@1.2.3, @scope/pkg, @media print',
  // placeholders and documentation names
  'See https://example.com/a, https://api.example.org/v1 and www.example.net/x; mail a@example.net or b@mail.example.com.',
  'Addresses 192.0.2.1, 198.51.100.7/24, 203.0.113.9 and 2001:db8::1, 2001:db8::/32 are for documentation.',
  'Open https://<host>/path or http://$HOST/x or https://{tenant}.<domain>/.',
  // words that sit next to secrets, without one
  'The key point: use short names. Token budget: 4000 tokens. The secret sauce. Password policy: at least 12 characters.',
  'key: secret_rotation_lambda_function_v2_prod_east_region',
  'sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 and commit 3b18e512dba79e4c8300dd08aeb37f8e728b8dad',
  'Use sk-learn-pipeline-for-text-classification, or the 12 steps.',
  'key: 123e4567-e89b-12d3-a456-426614174000',
  'project 2024 and project 12 and project plan',
  'request id 0a1b2c3d-4e5f-6789-abcd-ef0123456789 is only a request',
];

/** Source text and the findings it must give, in order, as kind and text. */
const TRUE_POSITIVES: [string, [ExternalKind, string][]][] = [
  // urls
  ['Call https://api.acme.io/v1/items?x=1.', [['url', 'https://api.acme.io/v1/items?x=1']]],
  [
    '[docs](https://docs.acme.io/guide) and **https://acme.io/b**',
    [
      ['url', 'https://docs.acme.io/guide'],
      ['url', 'https://acme.io/b'],
    ],
  ],
  ['(see https://en.wikipedia.org/wiki/Foo_(bar)).', [['url', 'https://en.wikipedia.org/wiki/Foo_(bar)']]],
  [
    'ftp://files.acme.io/x.zip and s3://acme-reports/2026/q3.csv',
    [
      ['url', 'ftp://files.acme.io/x.zip'],
      ['url', 's3://acme-reports/2026/q3.csv'],
    ],
  ],
  [
    'www.acme.io/pricing, HTTP://ACME.IO and http://localhost:3000/',
    [
      ['url', 'www.acme.io/pricing'],
      ['url', 'HTTP://ACME.IO'],
      ['url', 'http://localhost:3000/'],
    ],
  ],
  [
    'https://user:pw@acme.io/ and https://[2001:4860:4860::8888]:443/',
    [
      ['url', 'https://user:pw@acme.io/'],
      ['url', 'https://[2001:4860:4860::8888]:443/'],
    ],
  ],
  ['image https://cdn.acme.io/a.png "Logo"', [['url', 'https://cdn.acme.io/a.png']]],
  ['@canonical https://acme.io/p', [['url', 'https://acme.io/p']]],
  ['row,https://acme.io/a,5', [['url', 'https://acme.io/a']]],
  ['git+https://github.com/acme/tool.git', [['url', 'https://github.com/acme/tool.git']]],
  // ip addresses
  [
    'hosts 10.0.0.1, 172.16.5.4 and 192.168.1.1/24.',
    [
      ['ip', '10.0.0.1'],
      ['ip', '172.16.5.4'],
      ['ip', '192.168.1.1/24'],
    ],
  ],
  [
    'dns 8.8.8.8 and 10.0.0.0/8',
    [
      ['ip', '8.8.8.8'],
      ['ip', '10.0.0.0/8'],
    ],
  ],
  [
    'v6 fe80::1, ::1, 2606:4700:4700::1111 and fd00::/8.',
    [
      ['ip', 'fe80::1'],
      ['ip', '::1'],
      ['ip', '2606:4700:4700::1111'],
      ['ip', 'fd00::/8'],
    ],
  ],
  ['full 2001:4860:4860:0:0:0:0:8888 now', [['ip', '2001:4860:4860:0:0:0:0:8888']]],
  ['fe80::1: the link-local address', [['ip', 'fe80::1']]],
  // host names
  [
    'db.prod.corp, jenkins.internal, printer.local, nas.lan and wiki.intra',
    [
      ['host', 'db.prod.corp'],
      ['host', 'jenkins.internal'],
      ['host', 'printer.local'],
      ['host', 'nas.lan'],
      ['host', 'wiki.intra'],
    ],
  ],
  [
    'ssh bastion.acme.dev and GitHub.com and mail.acme.co.uk',
    [
      ['host', 'bastion.acme.dev'],
      ['host', 'GitHub.com'],
      ['host', 'mail.acme.co.uk'],
    ],
  ],
  ['10.0.0.1.nip.io', [['host', '10.0.0.1.nip.io']]],
  ['wait...acme.io', [['host', 'acme.io']]],
  ['x-api.acme.app:8080/path', [['host', 'x-api.acme.app']]],
  // accounts
  [
    'account 123456789012 and 012345678901.',
    [
      ['account', '123456789012'],
      ['account', '012345678901'],
    ],
  ],
  [
    'arn:aws:iam::123456789012:role/Admin and arn:aws:s3:::acme-reports/q3).',
    [
      ['account', 'arn:aws:iam::123456789012:role/Admin'],
      ['account', 'arn:aws:s3:::acme-reports/q3'],
    ],
  ],
  ['Subscription ID: 0a1b2c3d-4e5f-6789-abcd-ef0123456789', [['account', '0a1b2c3d-4e5f-6789-abcd-ef0123456789']]],
  ['/subscriptions/0a1b2c3d-4e5f-6789-abcd-ef0123456789/resourceGroups/rg', [['account', '0a1b2c3d-4e5f-6789-abcd-ef0123456789']]],
  [
    'GCP project number: 1234567890 and projects/123456789012/locations/x',
    [
      ['account', '1234567890'],
      ['account', '123456789012'],
    ],
  ],
  // keys
  [
    `aws ${AWS_KEY} and ${AWS_TEMP}`,
    [
      ['key', AWS_KEY],
      ['key', AWS_TEMP],
    ],
  ],
  [
    `${GH_TOKEN} ${GH_OAUTH} ${GH_PAT}`,
    [
      ['key', GH_TOKEN],
      ['key', GH_OAUTH],
      ['key', GH_PAT],
    ],
  ],
  [
    `${SLACK} ${STRIPE}`,
    [
      ['key', SLACK],
      ['key', STRIPE],
    ],
  ],
  [
    `${ANTHROPIC} ${OPENAI}`,
    [
      ['key', ANTHROPIC],
      ['key', OPENAI],
    ],
  ],
  [`Bearer ${JWT}`, [['key', JWT]]],
  [`"token": "${JWT}"`, [['key', JWT]]],
  [PEM_BEGIN, [['key', PEM_BEGIN]]],
  [`api_key = ${HEX32}`, [['key', HEX32]]],
  [`aws_secret_access_key = ${B64}`, [['key', B64]]],
  [`SecretAccessKey: ${B64}`, [['key', B64]]],
  [`password="${HEX32}"`, [['key', HEX32]]],
  [`token ${B64}==`, [['key', `${B64}==`]]],
  // email
  [
    'ada@acme.io, first.last+tag@mail.acme.com and [mail](mailto:bob@acme.io).',
    [
      ['email', 'ada@acme.io'],
      ['email', 'first.last+tag@mail.acme.com'],
      ['email', 'bob@acme.io'],
    ],
  ],
  ['git@github.com:acme/tool.git', [['email', 'git@github.com']]],
];

test('false-positive corpus: versions, dates, times, numbers, file names and code give nothing away', () => {
  for (const line of FALSE_POSITIVES) assert.deepEqual(found(line), [], line);
  // And together, as one page.
  assert.deepEqual(found(`${FALSE_POSITIVES.join('\n')}\n`), []);
});

test('true-positive corpus: each kind is found, with the text as written', () => {
  for (const [src, want] of TRUE_POSITIVES) assert.deepEqual(found(src), want, src);
});

test('a finding has its line and column, and the span is the text', () => {
  const src = [
    '# Report',
    '',
    '@canonical https://acme.io/p',
    '```',
    'ssh ops@10.0.0.7',
    '```',
    `data t = a,b; ${AWS_KEY},2`,
    'diagram d',
    'web -> db.prod.corp',
  ].join('\n');
  const want = [
    ['url', 'https://acme.io/p', 3, 12],
    ['ip', '10.0.0.7', 5, 9],
    ['key', AWS_KEY, 7, 15],
    ['host', 'db.prod.corp', 9, 8],
  ];
  const got = scanExternal(src);
  assert.deepEqual(
    got.map((f) => [f.kind, f.text, f.line, f.col]),
    want,
  );
  assert.ok(got.every((f) => src.slice(f.start, f.end) === f.text));
  // CRLF files read the same, and the CR is never part of a finding.
  assert.deepEqual(
    scanExternal(src.replaceAll('\n', '\r\n')).map((f) => [f.kind, f.text, f.line, f.col]),
    want,
  );
});

test('where findings overlap the longer span is the one finding: a host or ip inside a url, an email around a host', () => {
  assert.deepEqual(found('https://api.corp.internal/v1 and http://10.0.0.1:8080/x'), [
    ['url', 'https://api.corp.internal/v1'],
    ['url', 'http://10.0.0.1:8080/x'],
  ]);
  assert.deepEqual(found('mail ada@mail.acme.io'), [['email', 'ada@mail.acme.io']]);
  assert.deepEqual(found('www.acme.io'), [['url', 'www.acme.io']]);
  assert.deepEqual(found(`https://acme.io/?key=${AWS_KEY}`), [['url', `https://acme.io/?key=${AWS_KEY}`]]);
  assert.deepEqual(found(JWT), [['key', JWT]]);
  // The generic rule and the shaped one agree on one span.
  assert.deepEqual(found(`token: ${GH_TOKEN}`), [['key', GH_TOKEN]]);
});

test('--allow leaves a host and the urls on it alone, whole names and ip literals, in any case', () => {
  const src = 'See https://docs.acme.io/guide, www.docs.acme.io, docs.acme.io, 10.0.0.5, and https://other.acme.io/x';
  assert.deepEqual(found(src, ['docs.acme.io']), [
    ['url', 'www.docs.acme.io'],
    ['ip', '10.0.0.5'],
    ['url', 'https://other.acme.io/x'],
  ]);
  assert.deepEqual(found(src, ['DOCS.acme.io', '10.0.0.5', 'www.docs.acme.io', 'other.acme.io']), []);
  // A subdomain is not the host, and credentials in the url are not exempted by its host.
  assert.deepEqual(found('https://a.docs.acme.io/x', ['docs.acme.io']), [['url', 'https://a.docs.acme.io/x']]);
  assert.deepEqual(found('https://bob:pw@docs.acme.io/x', ['docs.acme.io']), [['url', 'https://bob:pw@docs.acme.io/x']]);
  // A key inside an allowed url is still a key, and an email is not a host name.
  assert.deepEqual(found(`https://docs.acme.io/?t=${AWS_KEY}`, ['docs.acme.io']), [['key', AWS_KEY]]);
  assert.deepEqual(found('ada@docs.acme.io', ['docs.acme.io']), [['email', 'ada@docs.acme.io']]);
});

test('a url is judged by the host the browser loads: a backslash before an @ ends the host', () => {
  // The browser reads `\` as `/`, so `https://docs.acme.io\@evil.example.net/` loads docs.acme.io with no credentials.
  assert.deepEqual(found('https://docs.acme.io\\@evil.example.net/', ['docs.acme.io']), []);
  assert.deepEqual(found('https://a.com\\@b.com/'), [['url', 'https://a.com\\@b.com/']]);
  assert.deepEqual(found('https://a.com\\@b.com/', ['b.com']), [['url', 'https://a.com\\@b.com/']]);
  // The name in the path is still a host name the page shows.
  assert.deepEqual(found('https://a.com\\@b.com/', ['a.com']), [['host', 'b.com']]);
});

test('findings become warnings with code external and detail {kind, text}', () => {
  const [d, ...rest] = externalDiagnostics('x\nsee https://acme.io/a\n');
  assert.equal(rest.length, 0);
  assert.equal(d.severity, 'warning');
  assert.equal(d.code, 'external');
  assert.equal(d.line, 2);
  assert.equal(d.col, 5);
  assert.deepEqual(d.detail, { kind: 'url', text: 'https://acme.io/a' });
  assert.match(d.message, /URL.*<url>.*--allow/);
  // A long text is cut in the message and whole in the detail.
  const long = `https://acme.io/${'a'.repeat(200)}`;
  const [l] = externalDiagnostics(long);
  assert.ok(l.message.length < 200, l.message);
  assert.deepEqual(l.detail, { kind: 'url', text: long });
  assert.deepEqual(externalDiagnostics('Nothing to see here, 1.2.3.\n'), []);
});

test('redaction replaces each span with its placeholder, changes no line count and leaves nothing to find', () => {
  const src = [
    `Contact ada@acme.io about https://acme.io/p (10.0.0.7, db.prod.corp).`,
    `| aws ${AWS_KEY} | account 123456789012 |`,
    `row,https://acme.io/a,5`,
    'Fine: v1.2.3, chart.png, https://example.com/x.',
  ].join('\n');
  const r = redactExternal(src);
  assert.equal(
    r.src,
    [
      'Contact <email> about <url> (<ip>, <host>).',
      '| aws <key> | account <account> |',
      'row,<url>,5',
      'Fine: v1.2.3, chart.png, https://example.com/x.',
    ].join('\n'),
  );
  assert.deepEqual(
    r.applied.map((a) => [a.line, a.kind, a.placeholder]),
    [
      [1, 'email', '<email>'],
      [1, 'url', '<url>'],
      [1, 'ip', '<ip>'],
      [1, 'host', '<host>'],
      [2, 'key', '<key>'],
      [2, 'account', '<account>'],
      [3, 'url', '<url>'],
    ],
  );
  assert.deepEqual(scanExternal(r.src), []);
  assert.equal(redactExternal(r.src).src, r.src);
  // Placeholders are what the table says.
  assert.deepEqual(Object.values(EXTERNAL_PLACEHOLDERS), ['<url>', '<ip>', '<host>', '<account>', '<key>', '<email>']);
  // Allowed names stay, and CRLF stays.
  assert.equal(redactExternal('a docs.acme.io b\r\nc 10.0.0.9 d\r\n', { allow: ['docs.acme.io'] }).src, 'a docs.acme.io b\r\nc <ip> d\r\n');
});

test('a private key is replaced from its header to its END line, and the line breaks stay', () => {
  const src = ['Key:', '```', PEM_BEGIN, 'MIIEowIBAAKCAQEAxxxxxxxx', 'yyyyyyyyyyyyyyyyyyyyyyyy', PEM_END, '```', 'after'].join('\n');
  const found1 = scanExternal(src);
  assert.equal(found1.length, 1);
  assert.deepEqual([found1[0].kind, found1[0].text, found1[0].line, found1[0].col], ['key', PEM_BEGIN, 3, 1]);
  const r = redactExternal(src);
  assert.equal(r.src, ['Key:', '```', '<key>', '', '', '', '```', 'after'].join('\n'));
  assert.equal(r.src.split('\n').length, src.split('\n').length);
  // Without an END line only the header goes; an END for another kind of block is not its end.
  assert.equal(redactExternal(`${PEM_BEGIN}\nabc\n`).src, '<key>\nabc\n');
  assert.equal(redactExternal(`${PEM_BEGIN}\nabc\n-----END CERTIFICATE-----\n`).src, '<key>\nabc\n-----END CERTIFICATE-----\n');
  // Two keys, each to its own END.
  assert.equal(redactExternal(`${PEM_BEGIN}\na\n${PEM_END}\nmid\n${PEM_BEGIN}\nb\n${PEM_END}\n`).src, '<key>\n\n\nmid\n<key>\n\n\n');
  // Other findings inside the block do not split it.
  assert.equal(redactExternal(`${PEM_BEGIN}\nhost.acme.io\n${PEM_END}`).applied.length, 1);
});

test('the placeholders cannot be found again: a second pass over any corpus text finds nothing', () => {
  const all = [...TRUE_POSITIVES.map(([s]) => s), ...FALSE_POSITIVES].join('\n');
  const once = redactExternal(all).src;
  assert.deepEqual(scanExternal(once), []);
});

/** A line that must not take more than a moment, whatever its shape. */
const BIG = 200_000;
const SHAPES: Record<string, string> = {
  letters: 'a'.repeat(BIG),
  digits: '1'.repeat(BIG),
  spaces: ' '.repeat(BIG),
  dashes: '-'.repeat(BIG),
  underscores: '_'.repeat(BIG),
  dots: '.'.repeat(BIG),
  'a.': 'a.'.repeat(BIG / 2),
  '1.': '1.'.repeat(BIG / 2),
  'a.com ': 'a.com '.repeat(BIG / 6),
  'a.com.': 'a.com.'.repeat(BIG / 6),
  '1.2.3.4 ': '1.2.3.4 '.repeat(BIG / 8),
  '10.0.0.1.': '10.0.0.1.'.repeat(BIG / 9),
  'www.': 'www.'.repeat(BIG / 4),
  'www.a.': 'www.a.'.repeat(BIG / 6),
  'http://': 'http://'.repeat(BIG / 7),
  'https://a.com/': 'https://a.com/'.repeat(BIG / 14),
  'a@': 'a@'.repeat(BIG / 2),
  '@': '@'.repeat(BIG),
  'a@b.': 'a@b.'.repeat(BIG / 4),
  'a@b.io ': 'a@b.io '.repeat(BIG / 7),
  'a@b.b.b.': `a@${'b.'.repeat(BIG / 2)}`,
  'aaa...@b': `${'a'.repeat(BIG)}@b.io`,
  'a:': 'a:'.repeat(BIG / 2),
  ':': ':'.repeat(BIG),
  '::': '::'.repeat(BIG / 2),
  'f:': 'f:'.repeat(BIG / 2),
  ab: 'ab'.repeat(BIG / 2),
  ':1': ':1'.repeat(BIG / 2),
  '1::1/': '1::1/'.repeat(BIG / 5),
  eyJ: 'eyJ'.repeat(BIG / 3),
  'eyJ.': 'eyJaaaaaaaa.'.repeat(BIG / 12),
  AKIA: 'AKIA'.repeat(BIG / 4),
  ghp_: 'ghp_'.repeat(BIG / 4),
  github_pat_: 'github_pat_'.repeat(BIG / 11),
  'sk-': 'sk-'.repeat(BIG / 3),
  'sk-ant-': 'sk-ant-'.repeat(BIG / 7),
  'xoxb-': 'xoxb-'.repeat(BIG / 5),
  sk_live_: 'sk_live_'.repeat(BIG / 8),
  'key ': 'key '.repeat(BIG / 4),
  'key=': 'key='.repeat(BIG / 4),
  'key + spaces': `key${' '.repeat(BIG)}x`,
  'key + equals': `key${'='.repeat(BIG)}`,
  'key: + run': `key: ${'a'.repeat(BIG)}`,
  'key: + mixed run': `token: ${'aB3'.repeat(BIG / 3)}`,
  key_: 'secret_'.repeat(BIG / 7),
  'password:': 'password: aB3'.repeat(BIG / 13),
  'project ': 'project '.repeat(BIG / 8),
  'project + spaces': `project${' '.repeat(BIG)}x`,
  'project + digits': `project ${'1'.repeat(BIG)}`,
  'arn:aws:': 'arn:aws:'.repeat(BIG / 8),
  'arn:aws:s3:::': 'arn:aws:s3:::'.repeat(BIG / 13),
  guid: '0a1b2c3d-4e5f-6789-abcd-ef0123456789-'.repeat(BIG / 37),
  'subscription guid': 'subscription 0a1b2c3d-4e5f-6789-abcd-ef0123456789 '.repeat(BIG / 49),
  pem: PEM_BEGIN.repeat(BIG / 30),
  'pem words': `-----BEGIN ${'A '.repeat(BIG / 2)}`,
  prose: 'Release 1.2.3 of node.js, e.g. www.acme.io and 10.0.0.1 and 123456789012 - '.repeat(BIG / 74),
};

test('a line of 200,000 characters of any shape is scanned in about one pass', () => {
  for (const [name, line] of Object.entries(SHAPES)) {
    const t = performance.now();
    scanExternal(line);
    redactExternal(line);
    const ms = performance.now() - t;
    assert.ok(ms < 3000, `${name}: ${Math.round(ms)} ms`);
  }
});

test('many lines and many findings are scanned in about one pass, and a key search does not repeat itself', () => {
  const lines = 'row,1.5,x,10:30\n'.repeat(60_000);
  let t = performance.now();
  assert.deepEqual(scanExternal(lines), []);
  assert.ok(performance.now() - t < 3000, `${Math.round(performance.now() - t)} ms`);
  const many = 'acme.io 10.0.0.1 ada@acme.io https://acme.io/x\n'.repeat(4000);
  t = performance.now();
  assert.equal(scanExternal(many).length, 4000 * 4);
  assert.ok(performance.now() - t < 3000, `${Math.round(performance.now() - t)} ms`);
  // Thousands of private-key headers with no END line: each is looked for once.
  const headers = `${PEM_BEGIN}\n`.repeat(6000);
  t = performance.now();
  assert.equal(scanExternal(headers).length, 6000);
  assert.ok(performance.now() - t < 3000, `${Math.round(performance.now() - t)} ms`);
});
