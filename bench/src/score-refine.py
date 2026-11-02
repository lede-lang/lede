"""Score the refinement test (D67): per tier, the baseline, the primary arm (Lede revised against HTML revised) and the hint arm
(Lede hinted against HTML revised), and the verdict by the bars in the design (internal spec, lede-lang/meta).

usage: score-refine.py <base-dir> <primary-dir> <hint-dir> <recount-refine1.json> <recount-v04.json> <hints-refine1.json>

  <base-dir>, <primary-dir>, <hint-dir>  judge directories (bench/results/judge/refine1-base, refine1, refine1h), each with
                                          key.json and s<N>/judge-*.jsonl; a line without `pair` (the header record) is skipped
  recount-refine1.json                   recount.ts --rows raw-refine1: the revised pages' tokens
  recount-v04.json                       the original pages' tokens (D50 counted the r6 C and B pages for tasks 71 to 130)
  hints-refine1.json                     hints.ts per r6 page: {"<tier>/<id>": {"line": "...", "hinted": true|false}}

Win-or-tie is the share of pairs the judge gave to Lede or called a tie, as the mean of the judge's samples. "Rises" means a
positive delta against the baseline. Per tier it prints the three arms with ties shown, the deltas in points and in pairs,
self-agreement (same side, or both tie), the median and p90 of the extra output tokens of the revised Lede pages (r7 or r7h
minus r6, the same tier and task), the revised HTML-to-Lede token ratio, the hint arm's page count and the verdict, and writes
<primary-dir>/verdict.json. The owner's spot check (the `unresolved` verdict per tier) is applied afterwards; it is not an input here.

The hint arm covers only the pages a hint fired for, so its delta is taken against the baseline on those same tasks (the
baseline over all of the tier's tasks is printed beside it). Everything that is compared with a bar is exact (fractions)."""
import json, os, sys
from fractions import Fraction

sys.dont_write_bytecode = True  # the import below must not leave a bench/src/__pycache__ behind
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python3 -I leaves the script's directory off sys.path
from judge_samples import load_samples, side, tier_of

TIER_ORDER = ['sonnet', 'opus']
MIN_AGREEMENT = Fraction(4, 5)  # a round under 80% self-agreement is re-judged before its verdict is recorded (Req 3.3)
BAR_WRITER, BAR_HINT, BAR_PRIMARY_UNDER, BAR_RENDERER = 10, 10, 5, 5  # points
MEDIAN_EXTRA_AT_MOST, RATIO_AT_LEAST = 150, 4  # qualifiers of the writer-reading verdict


def load_round(d):
    """key (pair -> entry), samples (name -> {pair: winner}) and the judge/prompt pairs named in the batch headers."""
    key = {k['pair']: k for k in json.load(open(os.path.join(d, 'key.json')))}
    samples, headers = load_samples(d)
    return key, samples, headers


class Arm:
    """One judged round for one tier: its pairs, judged in every sample, as win/tie counts per sample."""

    def __init__(self, key, samples, tier, ids=None):
        every = [p for p in key if tier_of(key[p]['model']) == tier and (ids is None or key[p]['id'] in ids)]
        self.pairs = [p for p in every if all(p in s for s in samples.values())]
        self.unjudged = len(every) - len(self.pairs)
        self.sides = {name: {p: side(key, p, s[p]) for p in self.pairs} for name, s in samples.items()}
        self.n = len(self.pairs)
        self.ids = {key[p]['id'] for p in self.pairs}
        self.wins = {name: sum(1 for v in sd.values() if v == 'lede') for name, sd in self.sides.items()}
        self.ties = {name: sum(1 for v in sd.values() if v == 'tie') for name, sd in self.sides.items()}

    def wot(self):
        """Mean win-or-tie as an exact fraction of the pairs."""
        k = len(self.sides)
        return Fraction(sum(self.wins.values()) + sum(self.ties.values()), k * self.n) if self.n else None

    def tie_rate(self):
        k = len(self.sides)
        return Fraction(sum(self.ties.values()), k * self.n) if self.n else None

    def describe(self):
        return '  '.join('%s %d+%d/%d' % (nm, self.wins[nm], self.ties[nm], self.n) for nm in self.sides)

    def as_json(self):
        return {
            'pairs': self.n,
            'unjudged': self.unjudged,
            'samples': {nm: {'wins': self.wins[nm], 'ties': self.ties[nm], 'pairs': self.n} for nm in self.sides},
            'winOrTie': pct(self.wot()),
            'tieRate': pct(self.tie_rate()),
        }


def pct(f):
    return None if f is None else float(100 * f)


def fmt(f):
    return '-' if f is None else '%.1f%%' % pct(f)


def delta(arm, base):
    """(points, pairs) of an arm against a baseline; the points are exact, the pairs are in the arm's pairs."""
    if arm.n == 0 or base.n == 0:
        return None
    pts = 100 * (arm.wot() - base.wot())
    return pts, pts * arm.n / 100


def signed(d):
    return 'n/a' if d is None else '%+.1f points (%+.1f pairs)' % (float(d[0]), float(d[1]))


def agreement(key, samples, tier):
    """Same side, or both tie, between every two samples, over the tier's pairs both samples judged."""
    names, agree, total = list(samples), 0, 0
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            for p in key:
                if tier is not None and tier_of(key[p]['model']) != tier:
                    continue
                a, b = samples[names[i]].get(p), samples[names[j]].get(p)
                if a is None or b is None:
                    continue
                total += 1
                agree += side(key, p, a) == side(key, p, b)
    return agree, total


def percentile(xs, q):
    """Linear interpolation between order statistics (numpy's default), exact for a fraction q."""
    xs = sorted(xs)
    if not xs:
        return None
    at = (len(xs) - 1) * q
    lo = int(at)
    hi = min(lo + 1, len(xs) - 1)
    return float(xs[lo] + (xs[hi] - xs[lo]) * (at - lo))


def token_map(path):
    return {r['key']: r['tokens'] for r in json.load(open(path))['rows']}


def extra_tokens(new, old, tier, model, arm):
    """New-minus-old tokens for every page of <tier>-<model> that has an original; ids missing an original are counted."""
    prefix = '%s-%s/%s/' % (tier, model, arm)
    diffs, missing = [], 0
    for k, tokens in new.items():
        if not k.startswith(prefix):
            continue
        orig = old.get('%s-r6/%s/%s' % (tier, arm, k[len(prefix):])) if arm == 'C' else old.get('%s/%s/%s' % (tier, arm, k[len(prefix):]))
        if orig is None:
            missing += 1
        else:
            diffs.append(tokens - orig)
    return diffs, missing


def summarize(xs):
    if not xs:
        return {'pages': 0, 'median': None, 'p90': None, 'mean': None}
    return {'pages': len(xs), 'median': percentile(xs, Fraction(1, 2)), 'p90': percentile(xs, Fraction(9, 10)), 'mean': sum(xs) / len(xs)}


def main():
    if len(sys.argv) != 7:
        sys.exit('usage: score-refine.py <base-dir> <primary-dir> <hint-dir> <recount-refine1.json> <recount-v04.json> <hints-refine1.json>')
    base_dir, primary_dir, hint_dir, recount_new, recount_old, hints_file = sys.argv[1:7]
    rounds = {nm: load_round(d) for nm, d in (('base', base_dir), ('primary', primary_dir), ('hint', hint_dir))}
    new_tokens, old_tokens = token_map(recount_new), token_map(recount_old)
    hints = json.load(open(hints_file))

    tiers = sorted({tier_of(k['model']) for k in rounds['primary'][0].values()}, key=lambda t: (TIER_ORDER.index(t) if t in TIER_ORDER else 99, t))
    heads = set().union(*(r[2] for r in rounds.values()))
    print('refinement test (D67)  base=%s  primary=%s  hint=%s' % tuple(os.path.basename(os.path.normpath(d)) for d in (base_dir, primary_dir, hint_dir)))
    print('judge:', '; '.join('%s %s' % h for h in sorted(heads)) if heads else 'no batch header records found')
    if len(heads) > 1:
        print('WARNING: the batch files name more than one judge or prompt version')

    out = {'tiers': {}, 'selfAgreement': {}, 'reJudge': [], 'judge': [{'judge': j, 'prompt': p} for j, p in sorted(heads)], 'warnings': []}
    if len(heads) > 1:
        out['warnings'].append('more than one judge or prompt version in the batch headers')
    d_primary, d_hint, costly = {}, {}, False
    for tier in tiers:
        base = Arm(*rounds['base'][:2], tier)
        prim = Arm(*rounds['primary'][:2], tier)
        hint = Arm(*rounds['hint'][:2], tier)
        base_same = Arm(*rounds['base'][:2], tier, ids=hint.ids)
        for nm, arm in (('baseline', base), ('primary', prim), ('hint', hint)):
            if arm.unjudged:
                out['warnings'].append('%s %s: %d pairs not judged in every sample are left out' % (tier, nm, arm.unjudged))
        p_delta = delta(prim, base)
        h_delta = delta(hint, base_same)
        h_delta_all = delta(hint, base)
        d_primary[tier], d_hint[tier] = p_delta, h_delta

        revised_lede, miss_c = extra_tokens(new_tokens, old_tokens, tier, 'r7', 'C')
        hinted_lede, miss_h = extra_tokens(new_tokens, old_tokens, tier, 'r7h', 'C')
        revised_html, miss_b = extra_tokens(new_tokens, old_tokens, tier, 'r7', 'B')
        ex_primary, ex_hint, ex_html = summarize(revised_lede), summarize(hinted_lede), summarize(revised_html)
        lede_tok = [t for k, t in new_tokens.items() if k.startswith('%s-r7/C/' % tier)]
        html_tok = [t for k, t in new_tokens.items() if k.startswith('%s-r7/B/' % tier)]
        ratio = (sum(html_tok) / len(html_tok)) / (sum(lede_tok) / len(lede_tok)) if lede_tok and html_tok else None
        n_hinted = sum(1 for k, v in hints.items() if k.startswith(tier + '/') and v.get('hinted'))
        q_median = ex_primary['median'] is not None and ex_primary['median'] <= MEDIAN_EXTRA_AT_MOST
        q_ratio = ratio is not None and ratio >= RATIO_AT_LEAST
        costly = costly or not (q_median and q_ratio)

        print('\n%s  (%d tasks)' % (tier, prim.n))
        print('  baseline  %-32s mean win-or-tie %-6s ties %s' % (base.describe(), fmt(base.wot()), fmt(base.tie_rate())))
        print('  primary   %-32s mean win-or-tie %-6s ties %s' % (prim.describe(), fmt(prim.wot()), fmt(prim.tie_rate())))
        print('  hint      %-32s mean win-or-tie %-6s ties %s' % (hint.describe(), fmt(hint.wot()), fmt(hint.tie_rate())))
        print('  baseline on the hint arm\'s %d tasks  %-14s mean win-or-tie %-6s ties %s' % (base_same.n, base_same.describe(), fmt(base_same.wot()), fmt(base_same.tie_rate())))
        print('  delta primary   %s' % signed(p_delta))
        print('  delta hint      %s  against the baseline on the same tasks; %s against all %d' % (signed(h_delta), signed(h_delta_all), base.n))
        print('  hint-arm pages  %d in the key, %d hinted in %s' % (hint.n, n_hinted, os.path.basename(hints_file)))
        if hint.n != n_hinted:
            out['warnings'].append('%s: %d hint-arm pairs but %d pages hinted' % (tier, hint.n, n_hinted))
            print('  WARNING: the hint arm\'s pairs and the hinted pages differ')
        for nm, ex, miss in (('primary', ex_primary, miss_c), ('hint', ex_hint, miss_h), ('revised HTML', ex_html, miss_b)):
            print('  extra tokens, %-12s %s%s' % (nm + ':', 'no pages' if not ex['pages'] else 'n=%d  median %.0f  p90 %.0f  mean %.1f' % (ex['pages'], ex['median'], ex['p90'], ex['mean']), '  (%d without an original)' % miss if miss else ''))
        print('  revised HTML-to-Lede token ratio  %s' % ('n/a' if ratio is None else '%.1f' % ratio))
        print('  qualifiers  median extra <= %d: %s   ratio >= %d: %s' % (MEDIAN_EXTRA_AT_MOST, 'yes' if q_median else 'NO', RATIO_AT_LEAST, 'yes' if q_ratio else 'NO'))

        out['tiers'][tier] = {
            'tasks': prim.n,
            'baseline': base.as_json(),
            'primary': prim.as_json(),
            'hint': dict(hint.as_json(), hintedPages=n_hinted, baselineSameTasks=base_same.as_json()),
            'delta': {
                'primary': None if p_delta is None else {'points': float(p_delta[0]), 'pairs': float(p_delta[1])},
                'hint': None if h_delta is None else {'points': float(h_delta[0]), 'pairs': float(h_delta[1]), 'against': 'baseline on the hint arm\'s tasks'},
                'hintVsAllBaseline': None if h_delta_all is None else {'points': float(h_delta_all[0]), 'pairs': float(h_delta_all[1])},
            },
            'extraTokens': {'primary': ex_primary, 'hint': ex_hint, 'revisedHtml': ex_html},
            'revisedHtmlToLedeRatio': ratio,
            'qualifiers': {'medianExtraAtMost150': q_median, 'ratioAtLeast4': q_ratio},
        }

    # Self-agreement per round and per tier (Req 3.3): under 80% means the round is judged again before the verdict is recorded.
    print('\nself-agreement (same side, or both tie)')
    for nm, (key, samples, _) in rounds.items():
        a, t = agreement(key, samples, None)
        out['selfAgreement'][nm] = {'agree': a, 'pairs': t, 'rate': (a / t) if t else None, 'perTier': {}}
        per = []
        for tier in tiers:
            ta, tt = agreement(key, samples, tier)
            out['selfAgreement'][nm]['perTier'][tier] = {'agree': ta, 'pairs': tt}
            per.append('%s %d/%d' % (tier, ta, tt))
        low = t and Fraction(a, t) < MIN_AGREEMENT
        if low or len(samples) < 2:
            out['reJudge'].append(nm)
        print('  %-8s %d/%d = %s   (%s)%s' % (nm, a, t, '-' if not t else '%.1f%%' % (100 * a / t), ', '.join(per), '   UNDER 80%: re-judge before recording' if low else '') + ('   ONE SAMPLE ONLY' if len(samples) < 2 else ''))

    # The verdict, from exact fractions. A tier without a delta (no hinted page) cannot rise in that arm.
    def rises_by(d, points, strict=False):
        return d is not None and (d[0] > points if strict else d[0] >= points)

    ts = list(tiers)
    if all(rises_by(d_primary[t], BAR_WRITER) for t in ts):
        verdict = 'writer reading'
    elif all(rises_by(d_hint[t], BAR_HINT) and d_primary[t] is not None and d_primary[t][0] < BAR_PRIMARY_UNDER for t in ts):
        verdict = 'hint mechanism'
    elif not any(rises_by(d, BAR_RENDERER, strict=True) for t in ts for d in (d_primary[t], d_hint[t])):
        verdict = 'renderer reading'
    else:
        verdict = 'both'
    label = verdict + (', costly' if verdict == 'writer reading' and costly else '')
    out['verdict'] = verdict
    out['costly'] = bool(verdict == 'writer reading' and costly)
    out['label'] = label
    out['bars'] = {'writerReadingPoints': BAR_WRITER, 'hintPoints': BAR_HINT, 'primaryUnderPoints': BAR_PRIMARY_UNDER, 'rendererMaxPoints': BAR_RENDERER}
    out['unresolved'] = 'per tier, from the owner\'s spot check (task 5); not computed here'
    if out['reJudge']:
        out['warnings'].append('re-judge before the verdict is recorded: %s' % ', '.join(out['reJudge']))
    print('\nverdict: %s%s' % (label, '   (provisional: re-judge %s first)' % ', '.join(out['reJudge']) if out['reJudge'] else ''))
    print('the owner\'s spot check can still make a tier unresolved (agreement under 7 of 12, or a delta of the opposite sign or three pairs apart)')
    for w in out['warnings']:
        print('WARNING:', w)
    with open(os.path.join(primary_dir, 'verdict.json'), 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')


main()
