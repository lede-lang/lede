"""Score the v0.4 round: per tier, regression (tasks 71-100) and gate (101-130), per sample, mean, and per category.
usage: score-v04.py <judge-dir>   (reads key.json, s*/judge-*.jsonl; categories from bench/tasks)"""
import json, glob, sys, os, re, collections
d = sys.argv[1]
key = {k['pair']: k for k in json.load(open(os.path.join(d, 'key.json')))}
cat = {}
for f in glob.glob(os.path.join(os.path.dirname(__file__), '..', 'tasks', '*.json')):
    t = json.load(open(f)); cat[int(re.match(r'(\d+)', os.path.basename(f)).group(1))] = t['category']
samples = {}
for sd in sorted(glob.glob(os.path.join(d, 's[0-9]*'))):
    m = {}
    for f in glob.glob(os.path.join(sd, 'judge-*.jsonl')):
        for l in open(f):
            if l.strip(): r = json.loads(l); m[r['pair']] = r['winner']
    samples[os.path.basename(sd)] = m
def side(p, w):
    if w not in ('LEFT', 'RIGHT'): return 'tie'
    return 'lede' if key[p]['left' if w == 'LEFT' else 'right'] == 'C' else 'html'
def rng(i): return 'regress' if 71 <= i <= 100 else 'gate'
out = {}
for sn, s in samples.items():
    print(sn, len(s), 'pairs judged')
agree = [side(p, a) == side(p, b) for p in key for a, b in [(list(samples.values())[0].get(p, 'X'), list(samples.values())[-1].get(p, 'X'))] if len(samples) > 1 and p in list(samples.values())[0] and p in list(samples.values())[-1]]
if agree: print('judge self-agreement', sum(agree), '/', len(agree))
for model in sorted({k['model'] for k in key.values()}):
    for r in ('regress', 'gate'):
        ps = [p for p in key if key[p]['model'] == model and rng(int(key[p]['id'])) == r]
        row = {}
        for sn, s in samples.items():
            c = collections.Counter(side(p, s[p]) for p in ps if p in s)
            row[sn] = (c['lede'], c['tie'], len(ps))
        wots = [(v[0] + v[1]) / v[2] for v in row.values() if v[2]]
        print(model, r, row, 'mean win-or-tie %.1f%%' % (100 * sum(wots) / max(1, len(wots))))
        if r == 'gate':
            bycat = collections.defaultdict(list)
            for p in ps:
                for sn, s in samples.items():
                    if p in s: bycat[cat[int(key[p]['id'])]].append(side(p, s[p]) in ('lede', 'tie'))
            print('   per category (mean of samples):', {c: '%d%%' % (100 * sum(v) / len(v)) for c, v in sorted(bycat.items())})
