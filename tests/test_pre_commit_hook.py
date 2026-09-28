"""Tests for hooks/pre-commit's private-content and large-file checks.

Each test builds a throwaway repository under ``tmp_path``, installs the hook
from this checkout, and commits there. In a git worktree ``.git`` is a file,
not a directory, so any path the hook builds under ``$REPO_ROOT/.git/`` cannot
be written; the checks must still see every staged file.

Safety: every git command runs with ``cwd`` inside ``tmp_path``, signing off,
and ``core.hooksPath`` pinned to the temp repository's own hooks directory, so
a global hooks path or a mutated hook can never reach a real repository. The
hook's version step finds no sync script in the temp repository and skips.

Ordered by consequence score, highest first.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parents[1] / "hooks" / "pre-commit"

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")


def _git(cwd, *args, hooks_dir=None, check=True):
    cmd = [
        "git",
        "-c", "user.email=hooktest@example.invalid",
        "-c", "user.name=hooktest",
        "-c", "commit.gpgsign=false",
        "-c", "tag.gpgsign=false",
    ]
    if hooks_dir is not None:
        cmd += ["-c", f"core.hooksPath={hooks_dir}"]
    cmd += list(args)
    # The hook prints UTF-8 (emoji); decode it as such on every platform.
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", check=check)


@pytest.fixture
def repo(tmp_path):
    """A clone-style repository (real .git directory) with the hook installed."""
    root = tmp_path / "repo"
    root.mkdir()
    _git(root, "init", "-q", "-b", "main")
    hooks = root / ".git" / "hooks"
    hooks.mkdir(exist_ok=True)
    shutil.copy(HOOK, hooks / "pre-commit")
    shutil.copy(HOOK.parent / "lib.sh", hooks / "lib.sh")  # the hook sources it from beside itself
    (hooks / "pre-commit").chmod(0o755)
    (root / "README.md").write_text("seed\n")
    _git(root, "add", "README.md")
    _git(root, "commit", "-q", "-m", "seed", hooks_dir=hooks)
    return root, hooks


@pytest.fixture
def worktree(repo, tmp_path):
    """A git worktree of ``repo`` on a public branch; its .git is a file."""
    root, hooks = repo
    wt = tmp_path / "wt"
    _git(root, "worktree", "add", "-q", "-b", "release", str(wt))
    assert (wt / ".git").is_file()
    return wt, hooks


def _commit(where, hooks, name, content="x\n"):
    path = where / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content)
    _git(where, "add", "-f", name)
    return _git(where, "commit", "-q", "-m", f"add {name}", hooks_dir=hooks, check=False)


def _in_head(where, name):
    return _git(where, "ls-tree", "-r", "--name-only", "HEAD").stdout.split().count(name) == 1


def test_private_file_is_blocked_in_a_worktree(worktree):
    """CONSEQUENCE: 9 (safety) -- a private file cannot be committed to a public branch from a git worktree."""
    wt, hooks = worktree
    result = _commit(wt, hooks, "private/notes.md")
    assert result.returncode != 0, result.stdout + result.stderr
    assert "COMMIT BLOCKED" in result.stdout + result.stderr
    assert "private/notes.md" in result.stdout + result.stderr
    assert not _in_head(wt, "private/notes.md")


def test_private_file_is_blocked_in_a_clone(repo):
    """CONSEQUENCE: 9 (safety) -- a private file cannot be committed to a public branch from a normal clone."""
    root, hooks = repo
    result = _commit(root, hooks, "private/notes.md")
    assert result.returncode != 0, result.stdout + result.stderr
    assert "COMMIT BLOCKED" in result.stdout + result.stderr
    assert not _in_head(root, "private/notes.md")


def test_hook_blocks_when_it_cannot_list_staged_files(repo, tmp_path):
    """CONSEQUENCE: 9 (safety) -- a guard that cannot run must never read as a guard that passed: no staged list, no commit."""
    root, hooks = repo
    sh = shutil.which("sh")
    if sh is None:
        pytest.skip("no sh on PATH")
    (root / "docs").mkdir()
    (root / "docs" / "page.md").write_text("x\n")
    _git(root, "add", "docs/page.md")
    # A stand-in `git`, first on PATH for the hook only: it reports a git
    # directory that does not exist, so the staged list cannot be written.
    # Every other call goes to the real git. Nothing leaves tmp_path.
    shim = tmp_path / "shim"
    shim.mkdir()
    real_git = shutil.which("git").replace("\\", "/")
    missing = (tmp_path / "no-such-dir" / "gitdir").as_posix()
    (shim / "git").write_text(
        "#!/bin/sh\n"
        'if [ "$1" = "rev-parse" ] && [ "$2" = "--absolute-git-dir" ]; then\n'
        f'    echo "{missing}"; exit 0\n'
        "fi\n"
        f'exec "{real_git}" "$@"\n'
    )
    (shim / "git").chmod(0o755)
    env = dict(os.environ, PATH=str(shim) + os.pathsep + os.environ.get("PATH", ""))
    result = subprocess.run([sh, str(hooks / "pre-commit")], cwd=root, env=env,
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = result.stdout + result.stderr
    assert result.returncode != 0, out
    assert "could not list the staged files" in out


def test_large_file_is_blocked_in_a_worktree(worktree):
    """CONSEQUENCE: 6 (behaviour) -- the >10 MB check also sees staged files in a git worktree."""
    wt, hooks = worktree
    result = _commit(wt, hooks, "assets/big.bin", b"\0" * (11 * 1024 * 1024))
    assert result.returncode != 0, result.stdout + result.stderr
    assert "too large" in result.stdout + result.stderr
    assert not _in_head(wt, "assets/big.bin")


def test_version_step_failure_shows_the_reason(repo):
    """CONSEQUENCE: 5 (behaviour) -- when the version stamp fails, the commit proceeds and the tool's error is shown, not hidden."""
    root, hooks = repo
    fake = root / "scripts" / "sync-versions.py"   # found by the hook's first candidate path
    fake.parent.mkdir(parents=True)
    fake.write_text("import sys\nprint('sed: unknown option to s -- stamp failed')\nsys.exit(1)\n")
    _git(root, "add", "scripts/sync-versions.py")
    result = _commit(root, hooks, "docs/page.md")
    out = result.stdout + result.stderr
    assert result.returncode == 0, out
    assert "Version update failed" in out
    assert "stamp failed" in out


CONFIG_TOOL = Path(__file__).resolve().parents[1] / "repokit_config.py"


def _configure(where, patterns=None, raw=None):
    """Vendor repokit_config.py at scripts/repokit-common/ and write the project's
    .repokit-common.toml. Both stay untracked; the hook reads them from disk."""
    tool = where / "scripts" / "repokit-common" / "repokit_config.py"
    tool.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(CONFIG_TOOL, tool)
    if raw is None:
        items = ", ".join(f'"{p}"' for p in patterns)
        raw = f"[tool.repokit-common]\nprivate-patterns = [{items}]\n"
    (where / ".repokit-common.toml").write_text(raw, encoding="utf-8")


def test_a_configured_prefix_blocks_in_a_worktree(worktree):
    """CONSEQUENCE: 9 (safety) -- a project's own private-patterns entry blocks a commit to a public branch, from a worktree too (#13)."""
    wt, hooks = worktree
    _configure(wt, ["drafts/"])
    result = _commit(wt, hooks, "drafts/idea.md")
    out = result.stdout + result.stderr
    assert result.returncode != 0, out
    assert "COMMIT BLOCKED" in out and "drafts/idea.md" in out
    assert not _in_head(wt, "drafts/idea.md")


def test_a_configured_prefix_blocks_in_a_clone(repo):
    """CONSEQUENCE: 9 (safety) -- the same in a normal clone, with the setting in pyproject.toml."""
    root, hooks = repo
    _configure(root, raw="")
    (root / ".repokit-common.toml").unlink()
    (root / "pyproject.toml").write_text(
        '[project]\nname = "p"\n\n[tool.repokit-common]\nprivate-patterns = ["drafts/"]\n', encoding="utf-8")
    result = _commit(root, hooks, "drafts/idea.md")
    assert result.returncode != 0, result.stdout + result.stderr
    assert not _in_head(root, "drafts/idea.md")


def test_built_in_patterns_still_block_when_the_project_adds_its_own(repo):
    """CONSEQUENCE: 9 (safety) -- project patterns add to the built-in list, never replace it."""
    root, hooks = repo
    _configure(root, ["drafts/"])
    result = _commit(root, hooks, "private/notes.md")
    assert result.returncode != 0, result.stdout + result.stderr
    assert not _in_head(root, "private/notes.md")


def test_an_unreadable_config_blocks_the_commit(repo):
    """CONSEQUENCE: 8 (safety) -- a malformed settings table stops the commit instead of silently dropping the project's patterns."""
    root, hooks = repo
    _configure(root, raw='[tool.repokit-common]\nprivate-patterns = ["drafts/"\n')
    result = _commit(root, hooks, "docs/page.md")
    out = result.stdout + result.stderr
    assert result.returncode != 0, out
    assert "settings could not be read" in out and "private-patterns" in out
    assert "cannot read" in out


@pytest.mark.parametrize("pattern,path,blocked", [
    ("drafts/", "tools/x/drafts/a.md", False),   # a prefix, not a substring: mid-path does not match
    ("drafts/", "drafts2/a.md", False),          # the slash is part of the prefix
    ("notes", "notes-public.md", True),          # a prefix of a file name matches
    ("./drafts/", "drafts/a.md", True),          # a leading ./ is ignored
    ("/drafts/", "drafts/a.md", True),           # a leading / is ignored
    ("d.t*", "dxtt.md", False),                  # literal text, never a regular expression or glob
    ("d.t+", "d.t+.md", True),
])
def test_entries_are_literal_prefixes_from_the_root(repo, pattern, path, blocked):
    """CONSEQUENCE: 7 (behaviour) -- entries match as literal prefixes of the repository-relative path, as documented."""
    root, hooks = repo
    _configure(root, [pattern])
    result = _commit(root, hooks, path)
    out = result.stdout + result.stderr
    assert (result.returncode != 0) == blocked, out
    assert _in_head(root, path) != blocked


def test_a_non_ascii_prefix_blocks_its_path(repo):
    """CONSEQUENCE: 7 (safety) -- a pattern with non-ASCII text matches the path git stages (UTF-8), whatever the console code page."""
    root, hooks = repo
    _configure(root, ["brouillons-é/"])
    result = _commit(root, hooks, "brouillons-é/idee.md")
    assert result.returncode != 0, result.stdout + result.stderr
    assert not _in_head(root, "brouillons-é/idee.md")


@pytest.mark.parametrize("entry", ["", "./", "/"])
def test_an_empty_entry_blocks_nothing(repo, entry):
    """CONSEQUENCE: 7 (behaviour) -- an entry that is empty after normalisation is ignored, rather than being a prefix of every path."""
    root, hooks = repo
    _configure(root, [entry, "drafts/"])
    result = _commit(root, hooks, "docs/page.md")
    assert result.returncode == 0, result.stdout + result.stderr
    assert _in_head(root, "docs/page.md")


def test_a_config_tool_mounted_anywhere_is_found_through_git(repo):
    """CONSEQUENCE: 7 (safety) -- a vendored copy outside the usual layouts (tracked at any depth) still supplies the project's patterns."""
    root, hooks = repo
    tool = root / "Software" / "tools" / "Repokit-Scripts" / "repokit_config.py"
    tool.parent.mkdir(parents=True)
    shutil.copy(CONFIG_TOOL, tool)
    _git(root, "add", "Software/tools/Repokit-Scripts/repokit_config.py")
    (root / ".repokit-common.toml").write_text('[tool.repokit-common]\nprivate-patterns = ["drafts/"]\n', encoding="utf-8")
    result = _commit(root, hooks, "drafts/idea.md")
    assert result.returncode != 0, result.stdout + result.stderr
    assert not _in_head(root, "drafts/idea.md")


def test_the_allowlist_still_exempts_a_configured_prefix(repo):
    """CONSEQUENCE: 6 (behaviour) -- .repokit-allowlist exempts a path the project's patterns would block."""
    root, hooks = repo
    _configure(root, ["drafts/"])
    (root / ".repokit-allowlist").write_text("drafts/keep.md\n", encoding="utf-8")
    result = _commit(root, hooks, "drafts/keep.md")
    assert result.returncode == 0, result.stdout + result.stderr
    assert _in_head(root, "drafts/keep.md")


def test_a_private_branch_ignores_the_project_patterns(repo):
    """CONSEQUENCE: 5 (behaviour) -- on a private branch the project's patterns do not block, like the built-ins."""
    root, hooks = repo
    _git(root, "checkout", "-q", "-b", "private")
    _configure(root, ["drafts/"])
    result = _commit(root, hooks, "drafts/idea.md")
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("branch", ["local", "private", "feature/x", "feat/x", "prototype/x", "experiment/x", "spike/x"])
def test_every_private_branch_name_allows_private_content(repo, branch):
    """CONSEQUENCE: 6 (behaviour) -- each documented private branch (or prefix) accepts private files; every other branch is public."""
    root, hooks = repo
    _git(root, "checkout", "-q", "-b", branch)
    result = _commit(root, hooks, "private/notes.md")
    assert result.returncode == 0, result.stdout + result.stderr


def test_the_first_commit_on_a_new_private_branch_is_treated_as_private(repo):
    """CONSEQUENCE: 5 (behaviour) -- on a branch with no commits yet git's short name lookup answers "HEAD"; the hook still sees the real branch name."""
    root, hooks = repo
    _git(root, "checkout", "-q", "--orphan", "private")
    result = _commit(root, hooks, "private/notes.md")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Checking for private content on branch: private" in result.stdout + result.stderr


def test_ordinary_file_commits_in_a_worktree(worktree):
    """CONSEQUENCE: 6 (behaviour) -- the checks do not block ordinary work in a git worktree."""
    wt, hooks = worktree
    result = _commit(wt, hooks, "src/module.py", "print('ok')\n")
    assert result.returncode == 0, result.stdout + result.stderr
    assert _in_head(wt, "src/module.py")
