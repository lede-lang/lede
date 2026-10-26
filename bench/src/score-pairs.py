"""Score blind judge samples for a round. usage: score-pairs.py <judge-dir> [<model-filter>...]
Reads <judge-dir>/key.json and <judge-dir>/s*/judge-*.jsonl (or judge-*.jsonl for sample 1), prints per-model,
per-sample Lede win/tie/loss and the mean win-or-tie across samples."""
import json, glob, sys, collections, os
d = sys.argv[1]
key = {k['pair']: k for k in json.load(open(os.path.join(d, 'key.json')))}
samples = {}
for sd in sorted(glob.glob(os.path.join(d, 's[0-9]*'))):
    m = {}
    for f in glob.glob(os.path.join(sd, 'judge-*.jsonl')):
        for l in open(f):
            if l.strip():
                r = json.loads(l); m[r['pair']] = r['winner']
    samples[os.path.basename(sd)] = m
def side(p, w):
    if w not in ('LEFT', 'RIGHT'): return 'tie'
    return 'lede' if key[p]['left' if w == 'LEFT' else 'right'] == 'C' else 'html'
models = sorted({k['model'] for k in key.values()})
out = {}
for mo in models:
    ps = [p for p in key if key[p]['model'] == mo]
    row = {}
    for sn, s in samples.items():
        c = collections.Counter(side(p, s[p]) for p in ps if p in s)
        row[sn] = dict(c, n=len(ps), wot=(c['lede'] + c['tie']) / len(ps))
    row['mean_wot'] = sum(v['wot'] for v in row.values() if isinstance(v, dict)) / max(1, len(samples))
    out[mo] = row
    print(mo, json.dumps(row))
cats = {}
json.dump(out, open(os.path.join(d, 'scored.json'), 'w'), indent=1)
