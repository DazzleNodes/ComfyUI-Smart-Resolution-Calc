"""POC (2026-09-27): which config-discovery rule finds the RIGHT project config?

Question for v0.3.0 (designed as v0.2.14 in DWP 2026-09-27__12-29-10, Addendum 2): repokit-common's
Python tools find config by walking up from their own file (5-level cap, first
pyproject.toml found); the hooks find the repository with git. Proposed rule for
the shared helper: walk up from the tool's own file to the nearest pyproject.toml
that CONTAINS [tool.repokit-common], or a .repokit-common.toml, with no cap.

Three rules are run against seven layouts built in a temp dir:
  proposed  -- walk from the tool file, nearest file holding the table, no cap
  current   -- walk from the tool file, 5 levels, first pyproject.toml (table or not)
  gitroot   -- git rev-parse --show-toplevel from the current directory

Each layout marks the consumer's config with a unique `marker` value, so a rule
"passes" only when it returns THAT file. Controls: `current` is predicted to fail
the deep mount and the table-less intermediate pyproject; `gitroot` to fail
outside a repo and from inside a nested repo. If a control passes where predicted
to fail, the harness is broken and no result counts.

Run: python poc_config_discovery.py [scratch_dir]
"""

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

try:
    import tomllib
except ImportError:  # pragma: no cover - POC only runs on 3.11+
    import tomli as tomllib

TABLE = "tool", "repokit-common"
GIT = ["git", "-c", "user.email=poc@example.invalid", "-c", "user.name=poc",
       "-c", "commit.gpgsign=false"]


def has_table(path):
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return False
    if path.name == ".repokit-common.toml":
        return TABLE[1] in data.get(TABLE[0], {}) or bool(data)
    return TABLE[1] in data.get(TABLE[0], {})


def rule_proposed(tool_file, cwd):
    d = Path(tool_file).resolve().parent
    while True:
        for name in ("pyproject.toml", ".repokit-common.toml"):
            c = d / name
            if c.is_file() and has_table(c):
                return c
        if d.parent == d:
            return None
        d = d.parent


def rule_bounded(tool_file, cwd):
    """Proposed walk, but never above the OUTERMOST git repository on the path
    (inner repos/submodules are walked through). No git anywhere: no bound."""
    start = Path(tool_file).resolve().parent
    chain = [start] + list(start.parents)
    git_dirs = [d for d in chain if (d / ".git").exists()]
    top = git_dirs[-1] if git_dirs else chain[-1]
    for d in chain:
        for name in ("pyproject.toml", ".repokit-common.toml"):
            c = d / name
            if c.is_file() and has_table(c):
                return c
        if d == top:
            return None
    return None


def rule_gitbound(tool_file, cwd):
    """Proposed walk, bounded by git's answer asked from the TOOL's directory:
    the superproject's root when the tool sits in a submodule, else the tool's
    own repository root. Outside git: no bound."""
    start = Path(tool_file).resolve().parent
    def q(*a):
        r = subprocess.run(["git", "-C", str(start), "rev-parse", *a], capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 else ""
    bound = q("--show-superproject-working-tree") or q("--show-toplevel")
    bound = Path(bound).resolve() if bound else None
    for d in [start] + list(start.parents):
        for name in ("pyproject.toml", ".repokit-common.toml"):
            c = d / name
            if c.is_file() and has_table(c):
                return c
        if bound is not None and d == bound:
            return None
    return None


def rule_current(tool_file, cwd):
    d = Path(tool_file).resolve().parent
    for _ in range(5):
        c = d / "pyproject.toml"
        if c.exists():
            return c
        d = d.parent
    return None


def rule_gitroot(tool_file, cwd):
    r = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=cwd,
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None
    c = Path(r.stdout.strip()) / "pyproject.toml"
    return c if c.is_file() else None


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def consumer_toml(marker):
    return f'[project]\nname = "c"\n\n[tool.repokit-common]\nmarker = "{marker}"\n'


def build(root):
    """Return {layout: (tool_file, cwd, expected_config_path)}."""
    L = {}

    # 1. flat scripts/
    p = root / "flat"
    exp = write(p / "pyproject.toml", consumer_toml("flat"))
    tool = write(p / "scripts" / "tool.py", "")
    subprocess.run(GIT + ["init", "-q", str(p)], check=True)
    L["1 flat scripts/"] = (tool, p, exp)

    # 2. nested subtree scripts/repokit-common/
    p = root / "nested"
    exp = write(p / "pyproject.toml", consumer_toml("nested"))
    tool = write(p / "scripts" / "repokit-common" / "tool.py", "")
    subprocess.run(GIT + ["init", "-q", str(p)], check=True)
    L["2 nested subtree"] = (tool, p, exp)

    # 3. deep mount, 6 levels below the config
    p = root / "deep"
    exp = write(p / "pyproject.toml", consumer_toml("deep"))
    tool = write(p / "Software" / "area" / "tools" / "vendor" / "Repokit-Scripts" / "lib" / "tool.py", "")
    subprocess.run(GIT + ["init", "-q", str(p)], check=True)
    L["3 deep mount (6 levels)"] = (tool, p, exp)

    # 4. REAL git submodule: repokit-common (with a TABLE-LESS pyproject.toml
    #    of its own) added as a submodule; tool run from inside the submodule
    src = root / "rk-src"
    write(src / "pyproject.toml", '[project]\nname = "repokit-common"\n')
    write(src / "tool.py", "")
    subprocess.run(GIT + ["init", "-q", "-b", "main", str(src)], check=True)
    subprocess.run(GIT + ["-C", str(src), "add", "-A"], check=True)
    subprocess.run(GIT + ["-C", str(src), "commit", "-q", "-m", "rk"], check=True)
    p = root / "submod"
    exp = write(p / "pyproject.toml", consumer_toml("submod"))
    subprocess.run(GIT + ["init", "-q", "-b", "main", str(p)], check=True)
    subprocess.run(GIT + ["-c", "protocol.file.allow=always", "-C", str(p), "submodule", "add", "-q",
                          src.as_posix(), "scripts/repokit-common"], check=True)
    sub = p / "scripts" / "repokit-common"
    assert (sub / ".git").is_file(), "submodule .git should be a file"
    L["4 real submodule, cwd inside it"] = (sub / "tool.py", sub, exp)

    # 5. worktree of a consumer: tool invoked from the worktree's own copy
    p = root / "wtmain"
    write(p / "pyproject.toml", consumer_toml("wt"))
    write(p / "scripts" / "repokit-common" / "tool.py", "")
    subprocess.run(GIT + ["init", "-q", "-b", "main", str(p)], check=True)
    subprocess.run(GIT + ["-C", str(p), "add", "-A"], check=True)
    subprocess.run(GIT + ["-C", str(p), "commit", "-q", "-m", "seed"], check=True)
    wt = root / "wt"
    subprocess.run(GIT + ["-C", str(p), "worktree", "add", "-q", "-b", "side", str(wt)], check=True)
    L["5 worktree copy"] = (wt / "scripts" / "repokit-common" / "tool.py", wt, wt / "pyproject.toml")

    # 6. outside any git repo, fallback file only (non-Python project)
    p = root / "nogit"
    exp = write(p / ".repokit-common.toml", '[tool.repokit-common]\nmarker = "nogit"\n')
    tool = write(p / "scripts" / "repokit-common" / "tool.py", "")
    L["6 no git, .repokit-common.toml"] = (tool, p, exp)

    # 7. table-less pyproject.toml between tool and project (nested package)
    p = root / "tableless"
    exp = write(p / "pyproject.toml", consumer_toml("tableless"))
    write(p / "tools" / "pyproject.toml", '[project]\nname = "inner"\n')
    tool = write(p / "tools" / "scripts" / "tool.py", "")
    subprocess.run(GIT + ["init", "-q", str(p)], check=True)
    L["7 table-less pyproject between"] = (tool, p, exp)

    # 8. project WITHOUT config inside a folder whose parent holds an unrelated
    #    configured pyproject.toml (not a repo). Right answer: no config (None).
    p = root / "outer"
    write(p / "pyproject.toml", consumer_toml("UNRELATED"))
    proj = p / "proj"
    tool = write(proj / "scripts" / "repokit-common" / "tool.py", "")
    subprocess.run(GIT + ["init", "-q", str(proj)], check=True)
    L["8 no config, unrelated one above"] = (tool, proj, None)
    return L


# Predicted verdicts, written before running. True = returns the expected file.
PREDICT = {
    "proposed": {**{k: True for k in range(1, 8)}, 8: False},
    "bounded": {**{k: True for k in range(1, 8)}, 8: False},
    "gitbound": {k: True for k in range(1, 9)},
    "current": {1: True, 2: True, 3: False, 4: False, 5: True, 6: False, 7: False, 8: False},
    "gitroot": {1: True, 2: True, 3: True, 4: False, 5: True, 6: False, 7: True, 8: True},
}


def main():
    base = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="poc-cfg-"))
    base.mkdir(parents=True, exist_ok=True)
    layouts = build(base)
    rules = {"proposed": rule_proposed, "bounded": rule_bounded, "gitbound": rule_gitbound, "current": rule_current, "gitroot": rule_gitroot}
    method_ok = True
    print(f"scratch: {base}")
    for name, rule in rules.items():
        print(f"\n== {name}")
        for layout, (tool, cwd, exp) in layouts.items():
            got = rule(tool, cwd)
            ok = (got is None) if exp is None else (got is not None and Path(got).resolve() == Path(exp).resolve())
            n = int(layout.split()[0])
            pred = PREDICT[name][n]
            flag = "" if ok == pred else "   <-- NOT AS PREDICTED"
            if ok != pred:
                method_ok = False
            rel = os.path.relpath(got, base) if got else None
            print(f"  {'PASS' if ok else 'FAIL'}  {layout:34s} got={rel}{flag}")

    # Helper start-up cost: python process that imports tomllib and runs the walk
    tool, cwd, _ = layouts["2 nested subtree"]
    snippet = (f"import sys; sys.path.insert(0, {str(Path(__file__).parent)!r}); "
               f"import poc_config_discovery as p; print(p.rule_proposed({str(tool)!r}, None))")
    times = []
    for _ in range(7):
        t = time.perf_counter()
        subprocess.run([sys.executable, "-c", snippet], capture_output=True, check=True)
        times.append((time.perf_counter() - t) * 1000)
    times.sort()
    print(f"\nhelper call (new python process): median {times[3]:.0f} ms, min {times[0]:.0f}, max {times[-1]:.0f}")
    print("\nMETHOD", "OK (every control failure was predicted)" if method_ok else "BROKEN: a control passed where it should fail")


if __name__ == "__main__":
    main()
