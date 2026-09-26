#!/usr/bin/env python3
"""Compare the encoding fix against the pre-fix reader over real vaults.

The fix can only ever ADD edges: a note that decoded correctly before still
decodes correctly, and a note that did not now contributes links it previously
dropped. So the pass condition is `new >= old` on every vault, and any vault
where `new > old` names documents that were silently invisible to the graph.

Run from the repo root:
    PYTHONIOENCODING=utf-8 python tests/one-offs/encoding_fix_vault_regression.py
"""

import importlib.util
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TOOL = REPO / "generate-backlinks.py"


def load():
    spec = importlib.util.spec_from_file_location("generate_backlinks", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def count_edges(backlinks):
    return sum(len(v) for v in backlinks.values())


def main():
    gb = load()

    # The pre-fix reader, restored verbatim for comparison.
    def old_reader(fpath):
        return fpath.read_text(encoding="utf-8", errors="ignore")

    vaults = sorted(Path("C:/code").glob("*/private/claude"))
    if not vaults:
        sys.exit("no vaults found under C:/code/*/private/claude")

    print(f"{len(vaults)} vaults\n")
    print(f"{'vault':<46} {'files':>6} {'old':>7} {'new':>7} {'delta':>6}  note")
    print("-" * 96)

    regressions = []
    recovered = []

    for v in vaults:
        gb._non_utf8.clear()
        gb._undecodable.clear()

        try:
            _, new_bl, files = gb.build_indices(v)
        except Exception as exc:                        # noqa: BLE001
            print(f"{str(v)[:46]:<46} {'':>6} {'':>7} {'':>7} {'':>6}  ERROR {type(exc).__name__}: {exc}")
            regressions.append((v, f"crash: {exc}"))
            continue

        new_edges = count_edges(new_bl)
        flagged = list(gb._non_utf8)
        undecodable = list(gb._undecodable)

        real = gb.read_note_text
        gb.read_note_text = old_reader
        try:
            _, old_bl, _ = gb.build_indices(v)
            old_edges = count_edges(old_bl)
        finally:
            gb.read_note_text = real

        delta = new_edges - old_edges
        note = ""
        if flagged:
            note = f"{len(flagged)} non-utf8: " + ", ".join(p.name for p, _ in flagged[:3])
        if undecodable:
            note += f" | {len(undecodable)} undecodable"
        if delta < 0:
            note = "REGRESSION " + note
            regressions.append((v, f"{old_edges} -> {new_edges}"))
        elif delta > 0:
            recovered.append((v, delta, flagged))

        print(f"{str(v)[:46]:<46} {len(files):>6} {old_edges:>7} {new_edges:>7} {delta:>+6}  {note}")

    print()
    if regressions:
        print(f"FAIL: {len(regressions)} vault(s) lost edges or crashed")
        for v, why in regressions:
            print(f"  {v}: {why}")
        return 1

    print(f"PASS: no vault lost an edge. {len(recovered)} vault(s) recovered links:")
    for v, delta, flagged in recovered:
        names = ", ".join(p.name for p, _ in flagged) or "(no flag -- investigate)"
        print(f"  +{delta:<4} {v}  [{names}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
