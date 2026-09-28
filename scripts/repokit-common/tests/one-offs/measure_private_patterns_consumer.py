"""Measure what a consumer's `private-patterns` would newly block (v0.3.0, #13).

Read-only. Lists the consumer's tracked files with `git ls-files`, reads its
private-patterns through this checkout's repokit_config.py, and applies the
hook's two rules: the built-in regular expression and the project's entries as
literal prefixes from the repository root (a leading "./" or "/" ignored).
Prints the files the project's entries would block that the built-ins do not.

    python tests/one-offs/measure_private_patterns_consumer.py <path to a consumer's checkout>

Measured on dazzlecmd (main) for v0.3.0: 9 entries, 657 tracked files, 0 newly blocked.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import repokit_config  # noqa: E402

# Copied from hooks/pre-commit's built-in list.
BUILT_IN = re.compile(
    r"^.*/__private__.*|^.*/private_.*|^.*~$|\.backup$|\.bak$|\.log$|\.tmp$|^\.env.*|^\.env\.local$|"
    r"^\.env\.private$|^convos/|^credentials/|^logs/|^nul$|^private/|^revisions/|^secrets/|^test-runs/|^test_runs/")


def norm(entry):
    entry = entry.rstrip("\r")
    if entry.startswith("./"):
        entry = entry[2:]
    return entry.lstrip("/")


def main(repo):
    repo = Path(repo)
    cfg = repokit_config.find_config(repo)
    table = repokit_config.read_table(cfg) if cfg else {}
    entries = [norm(e) for e in table.get("private-patterns", []) if norm(e)]
    files = subprocess.run(["git", "-C", str(repo), "ls-files"], capture_output=True, text=True,
                           encoding="utf-8", check=True).stdout.splitlines()
    newly = [f for f in files if not BUILT_IN.search(f) and any(f.startswith(e) for e in entries)]
    print(f"config: {cfg}")
    print(f"entries: {len(entries)} {entries}")
    print(f"tracked files: {len(files)}")
    print(f"blocked by built-ins: {sum(1 for f in files if BUILT_IN.search(f))}")
    print(f"newly blocked by the project's entries: {len(newly)}")
    for f in newly:
        print(f"  {f}")


if __name__ == "__main__":
    main(sys.argv[1])
