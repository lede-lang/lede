"""Builds the blind spot-check page: pairwise comparisons with images embedded.

Pairs named by hand (one round):
  python3 -I bench/src/spotcheck.py round2 P121 P015 ... > bench/spotcheck/spot-check.html

Pairs picked from the keys (the refinement test and the held-out round; internal spec, lede-lang/meta):
  python3 -I bench/src/spotcheck.py refine1 --seed 20261102 --tasks 6 --tier sonnet,opus --arms refine1-base,refine1 > page.html
  python3 -I bench/src/spotcheck.py heldout3 --seed 20261103 --tasks 12 --tier haiku,sonnet,opus --arms heldout3 > page.html

With --arms the first argument only names the check. For each tier (a writer such as `sonnet`, or a model directory such as
`sonnet-r7`) it picks --tasks tasks that every named round has a pair for, spread over the categories from the keys: the
categories in a seeded order, one task from each in turn, and when --tasks is more than the categories, a second task from the
first of them, and so on (six tasks over six categories is one each; twelve over eleven is one each and one more). Then it takes
each named round's pair or pairs for those tasks. The pairs are shuffled and shown as Q01, Q02, ... so the page says neither the
round nor the pair; the choice is a hash of the seed, so the same arguments pick the same pairs on any Python. The chosen pair
ids are printed first, on stderr (the page goes to stdout), and --map FILE writes which pair each Q is. --dry stops after that
and builds nothing (it needs no Pillow).

The page records each choice in the artifact's db (collection `spotcheck`) when it runs as a published artifact, and in
localStorage otherwise. The answer key is NOT in the page."""
import argparse, base64, hashlib, io, json, os, sys
from pathlib import Path

sys.dont_write_bytecode = True  # the import below must not leave a bench/src/__pycache__ behind
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python3 -I leaves the script's directory off sys.path
from judge_samples import tier_of

ROOT = Path(__file__).resolve().parent.parent


def jpeg(path, width):
    from PIL import Image  # only a page being built needs Pillow

    im = Image.open(path).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=72, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def order(seed, *parts):
    """A fixed pseudo-random sort key: the same on every Python, unlike random.shuffle."""
    return hashlib.sha256(("|".join([str(seed), *map(str, parts)])).encode()).hexdigest()


def load_key(name):
    return json.loads((ROOT / "results" / "judge" / name / "key.json").read_text())


def pick_tasks(tier, arms, keys, tasks, seed, count):
    """`count` task ids for a tier that every arm has a pair for, one category after another."""
    ids = None
    for arm in arms:
        mine = {k["id"] for k in keys[arm] if tier == k["model"] or tier == tier_of(k["model"])}
        ids = mine if ids is None else ids & mine
    ids = sorted(ids or [], key=int)
    if not ids:
        sys.exit("no task has a pair in every one of %s for tier %s" % (", ".join(arms), tier))
    by_cat = {}
    for i in ids:
        by_cat.setdefault(tasks[i]["category"], []).append(i)
    cats = sorted(by_cat, key=lambda c: order(seed, tier, c))
    for c in cats:
        by_cat[c].sort(key=lambda i: order(seed, tier, c, i))
    chosen, depth = [], 0
    while len(chosen) < count and any(len(v) > depth for v in by_cat.values()):
        for c in cats:
            if len(chosen) < count and len(by_cat[c]) > depth:
                chosen.append(by_cat[c][depth])
        depth += 1
    if len(chosen) < count:
        sys.exit("tier %s has only %d tasks with a pair in every round" % (tier, len(chosen)))
    return chosen


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("round", help="the round the pairs are in (pairs named by hand), or the name of the check (with --arms)")
    ap.add_argument("pairs", nargs="*", help="pair ids of the round, such as P121 (not with --arms)")
    ap.add_argument("--seed", type=int, help="seed of the choice of tasks and of the order of the pairs")
    ap.add_argument("--tasks", type=int, help="tasks to pick per tier")
    ap.add_argument("--tier", action="append", help="writer(s) to pick for, comma separated or repeated (sonnet, opus, or a model directory)")
    ap.add_argument("--arms", help="comma-separated rounds under results/judge whose pairs for the picked tasks are shown")
    ap.add_argument("--map", help="write which pair each Q is to this JSON file")
    ap.add_argument("--dry", action="store_true", help="print the chosen pairs and stop")
    args = ap.parse_args()

    tasks = {p.stem.split("-")[0].zfill(2): json.loads(p.read_text()) for p in (ROOT / "tasks").glob("*.json")}
    picks = []  # (round, pair-key entry, category)
    if args.arms:
        if args.pairs:
            ap.error("pair ids and --arms are two ways to choose pairs; use one")
        if args.seed is None or not args.tasks or not args.tier:
            ap.error("--arms needs --seed, --tasks and --tier")
        arms = args.arms.split(",")
        keys = {a: load_key(a) for a in arms}
        tiers = [t for spec in args.tier for t in spec.split(",") if t]
        print("spot check %s: seed %d, %d tasks per tier, tiers %s, rounds %s" % (args.round, args.seed, args.tasks, ",".join(tiers), ",".join(arms)), file=sys.stderr)
        for tier in tiers:
            for tid in pick_tasks(tier, arms, keys, tasks, args.seed, args.tasks):
                row = []
                for arm in arms:
                    for k in keys[arm]:
                        if k["id"] == tid and (tier == k["model"] or tier == tier_of(k["model"])):
                            picks.append((arm, k, tasks[tid]["category"]))
                            row.append("%s %s" % (arm, k["pair"]))
                print("%-7s task %-4s %-16s %s" % (tier, tid, tasks[tid]["category"], ", ".join(row)), file=sys.stderr)
    else:
        if not args.pairs:
            ap.error("name the pairs, or choose them with --arms")
        keys = {args.round: load_key(args.round)}
        by_pair = {k["pair"]: k for k in keys[args.round]}
        picks = [(args.round, by_pair[p], tasks[by_pair[p]["id"]]["category"]) for p in args.pairs]
        print("spot check %s: %s" % (args.round, " ".join(args.pairs)), file=sys.stderr)

    if args.arms:  # shuffled and renamed, so the page shows neither the round nor the pair
        picks.sort(key=lambda p: order(args.seed, "page", p[0], p[1]["pair"]))
        names = ["Q%02d" % (i + 1) for i in range(len(picks))]
    else:
        names = [k["pair"] for _, k, _ in picks]
    print("%d pairs: %s" % (len(picks), " ".join("%s=%s:%s" % (n, r, k["pair"]) for n, (r, k, _) in zip(names, picks))), file=sys.stderr)
    if args.map:
        Path(args.map).write_text(json.dumps(
            [{"item": n, "round": r, "pair": k["pair"], "model": k["model"], "task": k["id"], "category": c} for n, (r, k, c) in zip(names, picks)],
            indent=1) + "\n")
    if args.dry:
        return

    items = []
    for name, (rnd, k, _) in zip(names, picks):
        t = tasks[k["id"]]
        items.append({
            "pair": name,
            "title": t["title"],
            "brief": t["brief"],
            "desktop": jpeg(ROOT / "out" / "pairs" / rnd / f"{k['pair']}-desktop.png", 1400),
            "phone": jpeg(ROOT / "out" / "pairs" / rnd / f"{k['pair']}-phone.png", 700),
        })
    page = (ROOT / "src" / "spotcheck.template.html").read_text()
    sys.stdout.write(page.replace("/*ITEMS*/[]", json.dumps(items)))


main()
