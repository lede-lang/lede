"""What the scorers and the spot check share about a judged round (internal spec, lede-lang/meta): a model directory's tier, the
judge's samples of a round, and which side a pick names. score-heldout.py, score-refine.py and spotcheck.py import this.

Those scripts run under `python3 -I`, which leaves the script's own directory off sys.path, so each puts it there before the
import. score-pairs.py and score-v04.py are the frozen scorers of published rounds and do not use this module."""
import glob, json, os, re, sys


def tier_of(model):
    """sonnet-r7h -> sonnet-r7 -> sonnet (the same two steps as bench/src/rounds.ts)."""
    return re.sub(r'-r\d+$', '', re.sub(r'-r(\d+)[a-z]$', r'-r\1', model))


def read_lines(path):
    with open(path) as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def load_samples(d):
    """samples (name -> {pair: winner}) and the judge/prompt pairs named in the batch headers, for the judge directory `d`.

    <d>/s<N>/judge-*.jsonl is sample N; judge-*.jsonl at the root counts as sample 1 when there is no s1/ (rounds 1 and 2 keep
    their one sample there). A line without `pair`, the header record of a batch file, is skipped."""
    dirs = {os.path.basename(p): p for p in glob.glob(os.path.join(d, 's[0-9]*')) if os.path.isdir(p)}
    sources = {}
    root = sorted(glob.glob(os.path.join(d, 'judge-*.jsonl')))
    if root:
        sources['root' if 's1' in dirs else 's1'] = root
    for name in sorted(dirs, key=lambda n: int(n[1:])):
        sources[name] = sorted(glob.glob(os.path.join(dirs[name], 'judge-*.jsonl')))
    if not sources:
        sys.exit('%s: no judge-*.jsonl at the root or in s<N>/' % d)
    samples, headers = {}, set()
    for name, files in sources.items():
        picks = {}
        for f in files:
            for r in read_lines(f):
                if 'pair' not in r:
                    if 'judge' in r or 'prompt' in r:
                        headers.add((r.get('judge', '?'), r.get('prompt', '?')))
                    continue
                picks[r['pair']] = r['winner']
        samples[name] = picks
    return samples, headers


def side(key, pair, winner):
    """'lede', 'html' or 'tie': who the judge's `winner` (LEFT, RIGHT or anything else) names, by the key's `left` and `right`."""
    if str(winner).upper() not in ('LEFT', 'RIGHT'):
        return 'tie'
    return 'lede' if key[pair]['left' if str(winner).upper() == 'LEFT' else 'right'] == 'C' else 'html'
