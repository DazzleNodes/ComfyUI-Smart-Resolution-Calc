"""Scratch fixtures for the v0.3.0 hook checklist (cross-shell: python only).

    python <checkout>/tests/checklists/v0.3.0__scratch.py init <scratch-dir>

builds, inside <scratch-dir> only:

    remote.git/   a bare repository (the push target)
    proj/         a fresh consumer project, repokit-common vendored at
                  scripts/repokit-common/ (this checkout's tracked and new files),
                  one commit, origin -> remote.git, and a hand-written
                  pre-commit hook already installed (to see the installer's backup)
    rk.py         a copy of this script

Then, from inside <scratch-dir>, every step is the same in cmd.exe, PowerShell
and bash:

    python rk.py install              run the vendored install-hooks.sh in proj/ (git's bash)
    python rk.py put [--wt] <fixture> write a fixture's files into proj/ (or proj-wt/) (see FIXTURES)
    python rk.py commit [--wt] <path>... git add -f <paths> and commit (prints the hook's output)
    python rk.py push [branch]        force-push the branch to remote.git (prints the hook's output)
    python rk.py branch <name>        create and switch to a branch in proj/
    python rk.py worktree             add proj-wt/, a worktree of proj on branch 'release'
    python rk.py nested               build super/ (has settings) with proj as a submodule and
                                      ask the vendored lookup, from inside it, what it finds
    python rk.py reset                back to the seed commit on main, fixtures removed

Every git call runs with -C inside <scratch-dir>, signing off, and
core.hooksPath pinned to proj's own hooks, so nothing can reach a real
repository and no signing prompt appears. Global git config is never changed.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHECKOUT = HERE.parents[1] if HERE.name == "checklists" else None
G = ["git", "-c", "user.email=t@example.invalid", "-c", "user.name=t",
     "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false",
     "-c", "core.safecrlf=false"]  # quiets the per-file LF/CRLF notices; line-ending handling itself is unchanged

# Hook output contains emoji. Show it in whatever the console can render and
# replace what it cannot, rather than crash (cmd.exe on cp437/cp1252).
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

PASS2 = "def test_one():\n    assert True\n\n\ndef test_two():\n    assert True\n"
FAIL = "def test_bad():\n    assert False, 'deliberate failure'\n"
FIXTURES = {
    # settings
    "cfg-private": {".repokit-common.toml":
                    '[tool.repokit-common]\nprivate-patterns = ["drafts/", "brouillons-é/", "CLAUDE.md"]\n'},
    "cfg-broken": {".repokit-common.toml": '[tool.repokit-common]\nprivate-patterns = ["drafts/"\n'},
    "cfg-test-command-fail": {".repokit-common.toml": '[tool.repokit-common]\ntest-command = "python check.py"\n',
                              "check.py": "import sys\nprint('script says no')\nsys.exit(1)\n"},
    "cfg-test-command-pass": {".repokit-common.toml": '[tool.repokit-common]\ntest-command = "python check.py && echo ✓ done"\n',
                              "check.py": "print('script ok')\n"},
    "cfg-print-off": {".repokit-common.toml": "[tool.repokit-common]\nprint-warning = false\n"},
    "cfg-versioned": {"pyproject.toml": '[project]\nname = "proj"\n\n[tool.repokit-common]\nversion-source = "pkg/_version.py"\n',
                      "pkg/__init__.py": "",
                      "pkg/_version.py": 'MAJOR = 0\nMINOR = 1\nPATCH = 0\nPHASE = ""\n__version__ = "0.1.0"\n'},
    # pre-commit subjects
    "private-prefix": {"drafts/idea.md": "x\n"},
    "private-mid-path": {"tools/x/drafts/a.md": "x\n"},
    "private-non-ascii": {"brouillons-é/idée.md": "x\n"},
    "private-claude-md": {"CLAUDE.md": "x\n"},
    "private-builtin": {"private/notes.md": "x\n"},
    "allowlist": {".repokit-allowlist": "drafts/keep.md\n", "drafts/keep.md": "x\n"},
    "ordinary": {"docs/page.md": "x\n"},
    # pre-push subjects
    "tests-pass": {"tests/test_a.py": PASS2},
    "tests-fail": {"tests/test_a.py": FAIL},
    "tests-empty": {"tests/test_empty.py": "X = 1\n"},
    "conftest-broken": {"tests/conftest.py": "raise RuntimeError('conftest is broken')\n", "tests/test_a.py": PASS2},
    "py-package": {"py/__init__.py": "", "tests/test_a.py": PASS2},
    "testpaths": {"pytest.ini": "[pytest]\ntestpaths = pkg\n", "pkg/__init__.py": "", "pkg/test_inline.py": FAIL},
    "one-offs": {"tests/test_a.py": PASS2, "tests/one-offs/test_scratch.py": FAIL, "tests/thinking/test_idea.py": FAIL},
    "root-syntax": {"pkg/__init__.py": "", "version.py": "VERSION = (\n"},
    "prints": {"pkg/__init__.py": "", "pkg/cli.py": "".join(f"print({i})\n" for i in range(25))},
}


def _root():
    root = Path.cwd().resolve()
    if not (root / "proj" / ".git").is_dir() or not (root / "rk.py").is_file():
        sys.exit("run this from the scratch directory made by 'init'")
    return root


def _git(root, where, *args, check=True, stdin=None):
    hooks = (root / "proj" / ".git" / "hooks").as_posix()
    cmd = G + ["-c", f"core.hooksPath={hooks}", "-C", str(where), *args]
    r = subprocess.run(cmd, capture_output=True, input=stdin)
    out = (r.stdout + r.stderr).decode("utf-8", errors="replace")
    if check and r.returncode:
        sys.exit(f"git {' '.join(args)} failed:\n{out}")
    return r.returncode, out


def _bash():
    if sys.platform != "win32":
        return shutil.which("bash") or "sh"
    git = Path(shutil.which("git")).resolve()
    for base in list(git.parents)[:3]:
        cand = base / "bin" / "bash.exe"
        if cand.is_file():
            return str(cand)
    sys.exit("Git for Windows' bash.exe not found")


def init(dest):
    if CHECKOUT is None:
        sys.exit("run 'init' from the checkout's tests/checklists/ copy")
    root = Path(dest).resolve()
    if root.exists() and any(root.iterdir()):
        sys.exit(f"{root} is not empty; pick a new scratch directory")
    root.mkdir(parents=True, exist_ok=True)
    subprocess.run(G + ["init", "-q", "--bare", "-b", "main", str(root / "remote.git")], check=True)
    proj = root / "proj"
    subprocess.run(G + ["init", "-q", "-b", "main", str(proj)], check=True)
    # this checkout's tracked and new (not ignored) files, as a subtree pull would bring
    files = subprocess.run(["git", "-C", str(CHECKOUT), "ls-files", "-co", "--exclude-standard", "-z"],
                           capture_output=True, check=True).stdout.decode("utf-8").split("\0")
    vend = proj / "scripts" / "repokit-common"
    for rel in filter(None, files):
        if rel.startswith((".vscode/", "docs/.vscode/")):
            continue
        src = CHECKOUT / rel
        if src.is_file():
            (vend / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, vend / rel)
    (proj / "README.md").write_text("scratch consumer\n", encoding="utf-8")
    subprocess.run(G + ["-C", str(proj), "add", "-A"], check=True)
    subprocess.run(G + ["-C", str(proj), "commit", "-q", "-m", "seed"], check=True)
    subprocess.run(G + ["-C", str(proj), "tag", "seed"], check=True)
    subprocess.run(G + ["-C", str(proj), "remote", "add", "origin", str(root / "remote.git")], check=True)
    own = proj / ".git" / "hooks" / "pre-commit"
    own.write_text("#!/bin/sh\n# the project's own pre-commit hook\nexit 0\n", encoding="utf-8")
    shutil.copy2(Path(__file__), root / "rk.py")
    print(f"scratch ready: {root}\nnext: cd into it, then  python rk.py install")


def main(argv):
    if not argv:
        sys.exit(__doc__)
    cmd, args = argv[0], argv[1:]
    if cmd == "init":
        return init(args[0])
    root = _root()
    proj = root / "proj"
    if cmd == "install":
        r = subprocess.run([_bash(), "scripts/repokit-common/install-hooks.sh"], cwd=proj,
                           input=b"y\n", capture_output=True)
        print((r.stdout + r.stderr).decode("utf-8", errors="replace"))
        print("installer exit", r.returncode)
    elif cmd == "put":
        where = root / "proj-wt" if args[0] == "--wt" else proj
        name = args[1] if args[0] == "--wt" else args[0]
        for rel, text in FIXTURES[name].items():
            p = where / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
            print("wrote", rel)
    elif cmd == "commit":
        where = root / "proj-wt" if args and args[0] == "--wt" else proj
        paths = args[1:] if args and args[0] == "--wt" else args
        _git(root, where, "add", "-f", "--", *paths)
        rc, out = _git(root, where, "commit", "-q", "-m", "checklist: " + " ".join(paths), check=False)
        print(out)
        print("commit exit", rc)
        if rc:
            _git(root, where, "reset", "-q")
    elif cmd == "push":
        branch = args[0] if args else _git(root, proj, "branch", "--show-current")[1].strip()
        # --force: after 'reset' the scratch remote is ahead; without it git drops
        # the ref before calling the hook, and the hook sees nothing to check.
        rc, out = _git(root, proj, "push", "--force", "origin", branch, check=False)
        print(out)
        print("push exit", rc)
    elif cmd == "branch":
        _git(root, proj, "checkout", "-q", "-b", args[0])
        print("on branch", args[0])
    elif cmd == "worktree":
        _git(root, proj, "worktree", "add", "-q", "-b", "release", str(root / "proj-wt"))
        print("worktree at", root / "proj-wt", "(.git is a file:", (root / "proj-wt" / ".git").is_file(), ")")
    elif cmd == "nested":
        sup = root / "super"
        if not sup.exists():
            subprocess.run(G + ["init", "-q", "-b", "main", str(sup)], check=True)
            (sup / "pyproject.toml").write_text('[tool.repokit-common]\ntest-command = "echo PARENT-SETTINGS"\n',
                                                encoding="utf-8")
            subprocess.run(G + ["-c", "protocol.file.allow=always", "-C", str(sup), "submodule", "add", "-q",
                                proj.as_posix(), "nodes/proj"], check=True)
        tool = sup / "nodes" / "proj" / "scripts" / "repokit-common" / "repokit_config.py"
        r = subprocess.run([sys.executable, str(tool), "--where"], capture_output=True, text=True)
        print("settings file found from inside the submodule:", r.stdout.strip() or "(none)")
    elif cmd == "reset":
        _git(root, proj, "checkout", "-q", "-f", "main")
        _git(root, proj, "reset", "-q", "--hard", "seed")
        _git(root, proj, "clean", "-q", "-fdx", "-e", ".git")
        for b in _git(root, proj, "branch", "--format=%(refname:short)")[1].split():
            if b not in ("main", "release"):
                _git(root, proj, "branch", "-q", "-D", b)
        print("proj reset to the seed commit on main")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
