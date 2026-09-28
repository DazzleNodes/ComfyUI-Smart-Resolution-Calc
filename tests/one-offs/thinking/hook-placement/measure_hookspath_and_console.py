"""Measurements for #14's design (git-repokit-common, next after v0.3.0).

M1 -- Option B, core.hooksPath pointed at the vendored hooks/ folder:
  a. a relative hooksPath (scripts/repokit-common/hooks) in the main checkout
  b. the same setting seen from a git worktree (config is shared)
  c. a branch whose tree has no scripts/repokit-common/ (does git run nothing, or fail?)
  d. what $0 is inside the hook (can it source a sibling lib.sh?)
M2 -- what a hook can learn about the console it prints to, when git is run
  from bash, PowerShell and cmd.exe: chcp, LANG/LC_ALL, TERM, WT_SESSION,
  MSYSTEM, and whether stdout/stderr are terminals. (Here the tool runs git with
  captured output, so "is a terminal" will read false; the values of chcp/env
  are what the hook would see in the same shells.)

Everything happens in a fresh temp folder; git runs with -C there, signing off.
Prints predictions next to results.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

G = ["git", "-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false",
     "-c", "core.safecrlf=false"]
root = Path(tempfile.mkdtemp(prefix="rk-m-"))
print("scratch:", root)
proj = root / "proj"
subprocess.run(G + ["init", "-q", "-b", "main", str(proj)], check=True)

probe = r'''#!/bin/sh
out="$(git rev-parse --show-toplevel)/../probe-$(basename "$0")-$(git rev-parse --abbrev-ref HEAD | tr / _).txt"
{
  echo "0=$0"
  echo "dirname0=$(dirname "$0")"
  echo "pwd=$(pwd)"
  echo "sibling_lib=$( [ -f "$(dirname "$0")/lib.sh" ] && echo yes || echo no)"
  echo "chcp=$(chcp.com 2>/dev/null | tr -d '\r')"
  echo "LANG=$LANG LC_ALL=$LC_ALL TERM=$TERM WT_SESSION=${WT_SESSION:+set} MSYSTEM=$MSYSTEM"
  echo "tty_stdout=$( [ -t 1 ] && echo yes || echo no) tty_stderr=$( [ -t 2 ] && echo yes || echo no)"
  echo "locale_charmap=$(locale charmap 2>/dev/null)"
} > "$out"
exit 0
'''
hooks = proj / "scripts" / "repokit-common" / "hooks"
hooks.mkdir(parents=True)
(hooks / "pre-commit").write_text(probe, encoding="utf-8", newline="\n")
(hooks / "lib.sh").write_text("# shared\n", encoding="utf-8", newline="\n")
(proj / "README.md").write_text("x\n")
subprocess.run(G + ["-C", str(proj), "add", "-A"], check=True)
subprocess.run(G + ["-C", str(proj), "commit", "-q", "--no-verify", "-m", "seed"], check=True)
subprocess.run(["git", "-C", str(proj), "config", "core.hooksPath", "scripts/repokit-common/hooks"], check=True)

def commit(where, name, shell=None):
    (where / name).write_text("x\n")
    subprocess.run(G + ["-C", str(where), "add", name], check=True)
    cmd = G + ["-C", str(where), "commit", "-q", "-m", name]
    if shell == "powershell":
        cmd = ["powershell", "-NoProfile", "-Command", "& " + " ".join(f"'{c}'" for c in cmd)]
    elif shell == "cmd":
        cmd = ["cmd", "/c"] + cmd
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()

print("\nM1a predict: hook runs from the main checkout, $0 under scripts/repokit-common/hooks, lib.sh visible")
print(" ", commit(proj, "a.txt"))
print("\nM1b predict: worktree runs its own copy of the hook (relative path resolved in the worktree)")
subprocess.run(G + ["-C", str(proj), "worktree", "add", "-q", "-b", "release", str(root / "wt")], check=True)
print(" ", commit(root / "wt", "b.txt"))
print("\nM1c predict: branch without the subtree -> git finds no hook and commits silently (no guard)")
subprocess.run(G + ["-C", str(proj), "checkout", "-q", "--orphan", "bare-branch"], check=True)
subprocess.run(G + ["-C", str(proj), "rm", "-rq", "--cached", "."], check=True)
for p in ("scripts", "README.md", "a.txt"):
    t = proj / p
    if t.is_dir():
        shutil.rmtree(t)  # scratch folder only
    elif t.exists():
        t.unlink()
rc, out = commit(proj, "c.txt")
print(" ", (rc, out), "hook ran:", any(n.startswith("probe-pre-commit-bare") for n in os.listdir(root)))
subprocess.run(G + ["-C", str(proj), "checkout", "-q", "-f", "main"], check=True)

print("\nM2: console as seen by the hook, git started from three shells")
for shell in (None, "powershell", "cmd"):
    rc, out = commit(proj, f"m2-{shell or 'bash'}.txt", shell)
    print(f"  via {shell or 'bash'}: rc={rc} {out[:120]}")
    f = root / "probe-pre-commit-main.txt"
    print("   ", f.read_text().replace("\n", " | ") if f.exists() else "(no probe)")

print("\nprobe files:")
for f in sorted(root.glob("probe-*")):
    print("--", f.name)
    print(f.read_text())
