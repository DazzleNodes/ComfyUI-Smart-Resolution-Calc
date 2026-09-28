"""Census: which repositories on this machine consume repokit-common hooks, and how.

Question: if install-hooks.sh starts writing small stub hooks (that run the
vendored copy's real hooks), will re-running it be enough for every existing
consumer -- or is compatibility code needed for some installed state?

Read-only. Finds every checkout (a directory holding .git, as a folder or as a
worktree's file) under the roots, to depth 4, skipping bulky folders; groups
them by their common git directory (worktrees share hooks); and for each group
reports: what repokit-common files git tracks, which hooks are installed and
whether they are repokit copies (and roughly which version), and core.hooksPath.
Only `git rev-parse`, `git config --get` and `git ls-files` are run.

Known answers checked first: C:\\code\\smart-resolution-calc-repo\\local
(repokit pre-commit + post-commit v0.2.13, a project pre-push) and
C:\\code\\git-repokit-common (vendors at the root, no hooks installed).
"""
import os
import subprocess
import sys
from pathlib import Path

ROOTS = [Path(r"C:\code"), Path(r"Z:\code")]
MAX_DEPTH = 4
SKIP = {"node_modules", ".venv", "venv", "__pycache__", ".git", "site-packages", "models", "output", "dist", "build"}
HOOKS = ("pre-commit", "post-commit", "pre-push")


def git(repo, *args, timeout=20):
    try:
        r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, "TIMEOUT"
    return r.returncode, r.stdout.strip()


def find_checkouts(root):
    found, unreachable = [], []
    if not root.exists():
        return found, [str(root)]
    stack = [(root, 0)]
    while stack:
        d, depth = stack.pop()
        try:
            entries = list(os.scandir(d))
        except OSError as e:
            unreachable.append(f"{d}: {e.__class__.__name__}")
            continue
        if any(e.name == ".git" for e in entries):
            found.append(Path(d))
        if depth >= MAX_DEPTH:
            continue
        for e in entries:
            try:
                if e.is_dir(follow_symlinks=False) and e.name not in SKIP and not e.name.startswith("."):
                    stack.append((Path(e.path), depth + 1))
            except OSError:
                continue
    return found, unreachable


def classify_hook(path):
    if not path.is_file():
        return "-"
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return f"unreadable({e.__class__.__name__})"
    # Hooks written by the older Git-RepoKit generator share wording with
    # repokit-common's (the first run of this probe misread them); they name
    # themselves, so check that first. Version markers exist only where a
    # release changed that hook: repokit_config (0.3.0, both hooks) and
    # absolute-git-dir (0.2.13, pre-commit only).
    if "Git-RepoKit" in text:
        return "git-repokit-gen"
    if "repokit-common" not in text and "sync-versions" not in text:
        return "other"
    if "repokit_config" in text:
        return "repokit>=0.3.0"
    if "absolute-git-dir" in text:
        return "repokit>=0.2.13"
    return "repokit-common"


def survey(checkout):
    rc, common = git(checkout, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if rc != 0 or not common or common == "TIMEOUT":
        return None
    common = Path(common).resolve()
    # A vendored repokit-common copy is where sync-versions.py or repokit_config.py
    # is tracked; a project's own scripts/hooks/ is not one.
    rc, tracked = git(checkout, "ls-files", "--", ":(glob)**/sync-versions.py", ":(glob)**/repokit_config.py")
    vend = sorted({str(Path(p).parent).replace("\\", "/") for p in tracked.splitlines() if p}) if rc == 0 else ["?"]
    _, hooks_path = git(checkout, "config", "--local", "--get", "core.hooksPath")
    hooks_dir = common / "hooks"
    return {
        "common": common,
        "checkout": checkout,
        "vendored": vend,
        "hooks": {h: classify_hook(hooks_dir / h) for h in HOOKS},
        "hooksPath": hooks_path or "",
    }


def main():
    checkouts, unreachable = [], []
    for root in ROOTS:
        f, u = find_checkouts(root)
        checkouts += f
        unreachable += u
    groups, not_repos = {}, []
    for c in checkouts:
        s = survey(c)
        if s is None:
            not_repos.append(str(c))
            continue
        g = groups.setdefault(s["common"], {**s, "checkouts": []})
        g["checkouts"].append(str(c))

    # known-answer checks
    by_checkout = {Path(c).resolve(): g for g in groups.values() for c in g["checkouts"]}
    src = by_checkout.get(Path(r"C:\code\smart-resolution-calc-repo\local").resolve())
    rk = by_checkout.get(Path(r"C:\code\git-repokit-common").resolve())
    print("KNOWN 1 SmartResCalc local:", src and src["hooks"])
    print("KNOWN 2 git-repokit-common:", rk and (rk["vendored"], rk["hooks"]))
    ok1 = (bool(src) and src["hooks"]["pre-commit"] == "repokit>=0.2.13"
           and src["hooks"]["post-commit"] == "repokit-common" and src["hooks"]["pre-push"] == "git-repokit-gen")
    ok2 = bool(rk) and rk["vendored"] == ["."] and set(rk["hooks"].values()) == {"-"}
    print("known answers:", "PASS" if ok1 and ok2 else "FAIL -- do not trust the rest")

    consumers = [g for g in groups.values()
                 if any(v.startswith("repokit") for v in g["hooks"].values()) or g["vendored"] or g["hooksPath"]]
    print(f"\ncheckouts found: {len(checkouts)}  repositories (by common git dir): {len(groups)}  "
          f"not a repo: {len(not_repos)}  unreachable dirs: {len(unreachable)}")
    print(f"repositories with repokit hooks installed, a vendored copy, or core.hooksPath: {len(consumers)}\n")
    print(f"{'repository (first checkout)':60s} {'vendored at':30s} pre-commit        post-commit       pre-push          hooksPath")
    for g in sorted(consumers, key=lambda g: g["checkouts"][0].lower()):
        h = g["hooks"]
        print(f"{g['checkouts'][0][:60]:60s} {','.join(g['vendored'])[:30]:30s} {h['pre-commit']:17s} {h['post-commit']:17s} "
              f"{h['pre-push']:17s} {g['hooksPath']}  (+{len(g['checkouts']) - 1} worktrees)")

    # reconciliation
    installed = sum(1 for g in groups.values() if any(v.startswith("repokit") for v in g["hooks"].values()))
    vend_only = sum(1 for g in groups.values() if g["vendored"] and not any(v.startswith("repokit") for v in g["hooks"].values()))
    hp = sum(1 for g in groups.values() if g["hooksPath"])
    neither = len(groups) - sum(1 for g in groups.values()
                                if any(v.startswith("repokit") for v in g["hooks"].values()) or g["vendored"])
    print(f"\nreconcile: {installed} with repokit hooks installed + {vend_only} vendored without them + "
          f"{neither} with neither = {installed + vend_only + neither} = {len(groups)} repositories; "
          f"core.hooksPath set in {hp}")
    if unreachable:
        print("unreachable (not counted as absent):", *unreachable[:10], sep="\n  ")


if __name__ == "__main__":
    main()
