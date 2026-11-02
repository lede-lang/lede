"""Score a held-out round: the scorer of record for tasks 131 to 185 (internal spec, lede-lang/meta).

usage: score-heldout.py <judge-dir> <min-id> <max-id> [--tasks <dir>]

Reads <judge-dir>/key.json and the judge's samples (s<N>/judge-*.jsonl; judge-*.jsonl at the root counts as sample 1 when
there is no s1/; a line without `pair`, the header record of a batch file, is skipped). Categories come from the task files
(bench/tasks by default). For the pairs whose task id is in min-id..max-id, per tier (the key's `model`):

  - per sample: Lede wins, ties and pairs; the mean win-or-tie of the samples; the mean number of ties
  - self-agreement (same side, or both tie) between the samples
  - the D22 reading: overall win-or-tie at or above 60% is a pass; a category under 40% is named as below the floor
  - per category (five pairs each in a held-out round): the samples, the mean win-or-tie, and the exact-binomial (Clopper-Pearson)
    95% range for the mean count out of the category's pairs. The mean count is half a pair when the samples split on one pair;
    the range is then the same Beta-quantile formula taken at that count, which is the usual interval at whole counts.

A pair the judge did not give a verdict in every sample is left out of the tier's figures and counted in a warning."""
import glob, json, math, os, re, sys
from fractions import Fraction

PASS_AT, FLOOR = Fraction(3, 5), Fraction(2, 5)  # D22's 60% overall; the 40% floor D37 read for a category
ALPHA = 0.05


def beta_cdf(x, a, b):
    """Regularized incomplete beta I_x(a, b), by Lentz's continued fraction."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    front = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x))

    def cf(x, a, b):
        tiny = 1e-300
        c, d = 1.0, 1.0 - (a + b) * x / (a + 1)
        d = 1.0 / (d if abs(d) > tiny else tiny)
        h = d
        for m in range(1, 400):
            m2 = 2 * m
            aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2))
            d = 1.0 + aa * d
            d = 1.0 / (d if abs(d) > tiny else tiny)
            c = 1.0 + aa / c
            c = c if abs(c) > tiny else tiny
            h *= d * c
            aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1))
            d = 1.0 + aa * d
            d = 1.0 / (d if abs(d) > tiny else tiny)
            c = 1.0 + aa / c
            c = c if abs(c) > tiny else tiny
            delta = d * c
            h *= delta
            if abs(delta - 1.0) < 1e-15:
                break
        return h

    if x < (a + 1) / (a + b + 2):
        return front * cf(x, a, b) / a
    return 1.0 - front * cf(1 - x, b, a) / b


def beta_ppf(p, a, b):
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if beta_cdf(mid, a, b) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def exact_range(k, n, alpha=ALPHA):
    """Clopper-Pearson (1 - alpha) interval for k successes in n trials; k may be a half count (the mean of two samples)."""
    k = float(k)
    low = 0.0 if k <= 0 else beta_ppf(alpha / 2, k, n - k + 1)
    high = 1.0 if k >= n else beta_ppf(1 - alpha / 2, k + 1, n - k)
    return low, high


def read_samples(d):
    dirs = {os.path.basename(p): p for p in glob.glob(os.path.join(d, 's[0-9]*')) if os.path.isdir(p)}
    sources = {}
    root = sorted(glob.glob(os.path.join(d, 'judge-*.jsonl')))
    if root:
        sources['root' if 's1' in dirs else 's1'] = root
    for name in sorted(dirs, key=lambda n: int(n[1:])):
        sources[name] = sorted(glob.glob(os.path.join(dirs[name], 'judge-*.jsonl')))
    if not sources:
        sys.exit('%s: no judge-*.jsonl at the root or in s<N>/' % d)
    samples = {}
    for name, files in sources.items():
        picks = {}
        for f in files:
            for line in open(f):
                if not line.strip():
                    continue
                r = json.loads(line)
                if 'pair' in r:
                    picks[r['pair']] = r['winner']
        samples[name] = picks
    return samples


def main():
    args = sys.argv[1:]
    tasks_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tasks')
    if '--tasks' in args:
        i = args.index('--tasks')
        tasks_dir = args[i + 1]
        del args[i:i + 2]
    if len(args) != 3:
        sys.exit('usage: score-heldout.py <judge-dir> <min-id> <max-id> [--tasks <dir>]')
    d, lo, hi = args[0], int(args[1]), int(args[2])
    key = {k['pair']: k for k in json.load(open(os.path.join(d, 'key.json')))}
    cat = {}
    for f in glob.glob(os.path.join(tasks_dir, '*.json')):
        cat[int(re.match(r'(\d+)', os.path.basename(f)).group(1))] = json.load(open(f))['category']
    samples = read_samples(d)
    names = list(samples)

    def side(p, w):
        if str(w).upper() not in ('LEFT', 'RIGHT'):
            return 'tie'
        return 'lede' if key[p]['left' if str(w).upper() == 'LEFT' else 'right'] == 'C' else 'html'

    in_range = [p for p in key if lo <= int(key[p]['id']) <= hi]
    print('%s  tasks %d-%d  %d pairs  samples: %s' % (os.path.basename(os.path.normpath(d)), lo, hi, len(in_range), ', '.join(names)))
    for nm, s in samples.items():
        print(nm, sum(1 for p in in_range if p in s), 'pairs judged')
    both = [p for p in in_range if all(p in s for s in samples.values())]
    pairs_agree = 0
    pairs_total = 0
    for p in both:
        sides = [side(p, s[p]) for s in samples.values()]
        pairs_total += 1
        pairs_agree += all(x == sides[0] for x in sides)
    if len(samples) > 1:
        print('judge self-agreement', pairs_agree, '/', pairs_total, '(%.1f%%)' % (100 * pairs_agree / max(1, pairs_total)))

    for model in sorted({key[p]['model'] for p in in_range}):
        every = [p for p in in_range if key[p]['model'] == model]
        ps = [p for p in every if all(p in s for s in samples.values())]
        if len(ps) != len(every):
            print('WARNING: %s: %d pairs without a verdict in every sample are left out' % (model, len(every) - len(ps)))
        k = len(samples)
        wins = {nm: sum(1 for p in ps if side(p, samples[nm][p]) == 'lede') for nm in names}
        ties = {nm: sum(1 for p in ps if side(p, samples[nm][p]) == 'tie') for nm in names}
        wot = Fraction(sum(wins.values()) + sum(ties.values()), k * len(ps)) if ps else Fraction(0)
        agree = sum(1 for p in ps if len({side(p, samples[nm][p]) for nm in names}) == 1)
        print()
        print('%s  tasks %d-%d  %d pairs' % (model, lo, hi, len(ps)))
        for nm in names:
            print('  %-4s %d wins + %d ties of %d = %.1f%% win-or-tie' % (nm, wins[nm], ties[nm], len(ps), 100 * (wins[nm] + ties[nm]) / max(1, len(ps))))
        print('  mean win-or-tie %.1f%%   mean ties %.1f (%.1f%%)   self-agreement %d / %d' % (
            100 * float(wot), sum(ties.values()) / k, 100 * sum(ties.values()) / max(1, k * len(ps)), agree, len(ps)))

        bycat = {}
        for p in ps:
            bycat.setdefault(cat.get(int(key[p]['id']), '?'), []).append(p)
        below = [c for c, cps in sorted(bycat.items())
                 if Fraction(sum(1 for p in cps for nm in names if side(p, samples[nm][p]) in ('lede', 'tie')), k * len(cps)) < FLOOR]
        reading = 'PASS' if wot >= PASS_AT else 'FAIL'
        print('  D22 reading: %s overall (60%% bar)%s' % (reading, '; below the 40%% floor in %s' % ', '.join(below) if below else ''))
        print('  per category (mean of samples; range = exact binomial 95% for the mean count of n pairs)')
        for c, cps in sorted(bycat.items()):
            cw = {nm: sum(1 for p in cps if side(p, samples[nm][p]) == 'lede') for nm in names}
            ct = {nm: sum(1 for p in cps if side(p, samples[nm][p]) == 'tie') for nm in names}
            mean_count = Fraction(sum(cw.values()) + sum(ct.values()), k)
            low, high = exact_range(mean_count, len(cps))
            share = mean_count / len(cps)
            print('    %-16s %s  mean %3.0f%%  range [%.1f%%, %.1f%%]  ties %.1f%s' % (
                c, '  '.join('%s %d+%d/%d' % (nm, cw[nm], ct[nm], len(cps)) for nm in names), 100 * float(share), 100 * low, 100 * high,
                sum(ct.values()) / k, '  BELOW 40% FLOOR' if share < FLOOR else ''))


main()
