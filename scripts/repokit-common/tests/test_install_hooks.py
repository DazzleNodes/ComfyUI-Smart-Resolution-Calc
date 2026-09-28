"""Tests for install-hooks.sh: existing hooks are backed up before replacement.

Safety: the installer writes into whatever repository git resolves from its
working directory, so every run happens with ``cwd`` inside a ``tmp_path``
repository, GIT_DIR and GIT_WORK_TREE removed from the environment, and a
check beforehand that git resolves the hooks directory inside ``tmp_path``.
The installer is run from this checkout, which it only reads.

Ordered by consequence score, highest first.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "install-hooks.sh"
HOOKS = ("pre-commit", "post-commit", "pre-push")

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")


def _bash():
    """Git's own bash on Windows (never WSL's System32 bash); bash on PATH elsewhere."""
    if sys.platform == "win32":
        git = Path(shutil.which("git")).resolve()
        # git.exe lives in <Git>/cmd, <Git>/bin or <Git>/mingw64/bin; bash in <Git>/bin.
        for base in list(git.parents)[:3]:
            for cand in (base / "bin" / "bash.exe", base / "usr" / "bin" / "bash.exe"):
                if cand.is_file():
                    return str(cand)
        return None
    return shutil.which("bash")


def _env():
    env = dict(os.environ)
    env.pop("GIT_DIR", None)
    env.pop("GIT_WORK_TREE", None)
    return env


def _git(cwd, *args):
    return subprocess.run(["git", "-c", "user.email=t@example.invalid", "-c", "user.name=t",
                           "-c", "commit.gpgsign=false", *args], cwd=cwd, env=_env(),
                          capture_output=True, text=True, check=True)


@pytest.fixture
def repo(tmp_path):
    bash = _bash()
    if bash is None:
        pytest.skip("git's bash not found")
    root = tmp_path / "repo"
    _git(tmp_path, "init", "-q", "-b", "main", str(root))
    (root / "README.md").write_text("seed\n")
    _git(root, "add", "README.md")
    _git(root, "commit", "-q", "-m", "seed")
    return root, bash


def _hooks_dir(where, tmp_path):
    common = Path(_git(where, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.strip())
    hooks = common / "hooks"
    assert tmp_path.resolve() in hooks.resolve().parents, f"refusing to install outside tmp_path: {hooks}"
    hooks.mkdir(exist_ok=True)
    return hooks


def _install(where, bash):
    # Bytes, not text: text-mode stdin on Windows sends "y\r\n", and the
    # installer's prompt then reads "y\r" and cancels.
    r = subprocess.run([bash, str(INSTALLER)], cwd=where, env=_env(), input=b"y\n",
                       capture_output=True)
    out = (r.stdout + r.stderr).decode("utf-8", errors="replace")
    assert r.returncode == 0, out
    return out


def _backups(hooks, name):
    return sorted(hooks.glob(f"{name}.backup-*"))


def _is_stub(path, name):
    """An installed hook is a stub that runs the vendored copy, not a copy of the hook."""
    text = path.read_text(encoding="utf-8")
    return "repokit-common hook stub" in text and f"REPOKIT_HOOK='{name}'" in text


def test_an_existing_hook_is_saved_before_it_is_replaced(repo, tmp_path):
    """CONSEQUENCE: 8 (safety) -- a project's own hook is kept as <hook>.backup-<timestamp>, content intact, and the new hook is installed."""
    root, bash = repo
    hooks = _hooks_dir(root, tmp_path)
    for name in HOOKS:
        (hooks / name).write_text(f"#!/bin/sh\n# the project's own {name}\n", encoding="utf-8")
    out = _install(root, bash)
    for name in HOOKS:
        saved = _backups(hooks, name)
        assert len(saved) == 1, (name, out)
        assert saved[0].read_text(encoding="utf-8") == f"#!/bin/sh\n# the project's own {name}\n"
        assert _is_stub(hooks / name, name)
    assert "saved as pre-commit.backup-" in out


def test_a_worktree_install_backs_up_the_shared_hooks(repo, tmp_path):
    """CONSEQUENCE: 7 (safety) -- from a git worktree the shared hooks directory is the one backed up and replaced."""
    root, bash = repo
    wt = tmp_path / "wt"
    _git(root, "worktree", "add", "-q", "-b", "release", str(wt))
    hooks = _hooks_dir(wt, tmp_path)
    assert hooks == _hooks_dir(root, tmp_path)
    (hooks / "pre-push").write_text("#!/bin/sh\n# old\n", encoding="utf-8")
    _install(wt, bash)
    assert [p.read_text(encoding="utf-8") for p in _backups(hooks, "pre-push")] == ["#!/bin/sh\n# old\n"]


def test_a_fresh_install_makes_no_backups(repo, tmp_path):
    """CONSEQUENCE: 4 (behaviour) -- nothing to replace, nothing to back up."""
    root, bash = repo
    hooks = _hooks_dir(root, tmp_path)
    for name in HOOKS:
        (hooks / name).unlink(missing_ok=True)
    _install(root, bash)
    assert not list(hooks.glob("*.backup-*"))
    for name in HOOKS:
        assert _is_stub(hooks / name, name)


def test_reinstalling_identical_hooks_makes_no_backups(repo, tmp_path):
    """CONSEQUENCE: 4 (behaviour) -- running the installer twice does not pile up copies of the same hook."""
    root, bash = repo
    hooks = _hooks_dir(root, tmp_path)
    _install(root, bash)
    out = _install(root, bash)
    assert not list(hooks.glob("*.backup-*")), out
    assert "already up to date" in out


# ---------------------------------------------------------------------------
# A fresh consumer: repokit-common vendored at scripts/repokit-common/, the
# vendored installer run from there, commits and pushes through the stubs.
# Every git call pins core.hooksPath to the consumer's own .git/hooks (a global
# hooks path must not win) and turns signing off. Nothing leaves tmp_path.
# ---------------------------------------------------------------------------

VENDORED_FILES = ("repokit_config.py", "sync-versions.py", "install-hooks.sh",
                  "hooks/pre-commit", "hooks/post-commit", "hooks/pre-push", "hooks/lib.sh")
PASSING = "def test_ok():\n    assert True\n"
FAILING = "def test_bad():\n    assert False, 'deliberate failure'\n"


def _cgit(root, *args, env=None, check=True):
    # The shared hooks folder: a worktree's .git is a file, so ask git.
    common = subprocess.run(["git", "-C", str(root), "rev-parse", "--path-format=absolute", "--git-common-dir"],
                            capture_output=True, text=True, env=_env()).stdout.strip()
    hooks = Path(common, "hooks").as_posix()
    r = subprocess.run(["git", "-c", "user.email=t@example.invalid", "-c", "user.name=t",
                        "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false",
                        "-c", f"core.hooksPath={hooks}", *args],
                       cwd=root, env=env or _env(), capture_output=True)
    out = (r.stdout + r.stderr).decode("utf-8", errors="replace")
    if check and r.returncode:
        raise AssertionError(f"git {' '.join(args)} failed:\n{out}")
    return r.returncode, out


@pytest.fixture
def consumer(tmp_path):
    """A fresh project with repokit-common vendored and the vendored installer run."""
    bash = _bash()
    if bash is None:
        pytest.skip("git's bash not found")
    root = tmp_path / "consumer"
    _git(tmp_path, "init", "-q", "-b", "main", str(root))
    vend = root / "scripts" / "repokit-common"
    for rel in VENDORED_FILES:
        (vend / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / rel, vend / rel)
    (root / "README.md").write_text("consumer\n", encoding="utf-8")
    _cgit(root, "add", "-A")
    _cgit(root, "commit", "-q", "--no-verify", "-m", "seed")
    remote = tmp_path / "remote.git"
    _git(tmp_path, "init", "-q", "--bare", "-b", "main", str(remote))
    _cgit(root, "remote", "add", "origin", str(remote))
    hooks = _hooks_dir(root, tmp_path)
    r = subprocess.run([bash, "scripts/repokit-common/install-hooks.sh"], cwd=root, env=_env(),
                       input=b"y\n", capture_output=True)
    out = (r.stdout + r.stderr).decode("utf-8", errors="replace")
    assert r.returncode == 0, out
    return root, hooks, bash, out


def _commit(root, rel, text="x\n", env=None):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    _cgit(root, "add", "-f", "--", rel, env=env)
    rc, out = _cgit(root, "commit", "-q", "-m", f"add {rel}", env=env, check=False)
    if rc:
        _cgit(root, "reset", "-q", env=env, check=False)  # a blocked file must not ride along into the next commit
    return rc, out


def test_the_vendored_installer_writes_stubs_that_run_the_real_hooks(consumer):
    """CONSEQUENCE: 9 (safety) -- in a fresh consumer the installed stubs run the vendored pre-commit, and it still blocks a private file."""
    root, hooks, _, out = consumer
    for name in HOOKS:
        assert _is_stub(hooks / name, name), name
    rc, text = _commit(root, "private/notes.md")
    assert rc != 0 and "COMMIT BLOCKED" in text, text
    rc, text = _commit(root, "docs/page.md")
    assert rc == 0, text
    assert "version hash not updated" in text or "Version updated with commit hash" in text  # post-commit ran too
    assert "Gated branches for this checkout: main master staging live" in out


def test_the_stub_finds_an_untracked_copy_where_it_was_installed_from(tmp_path):
    """CONSEQUENCE: 7 (safety) -- a copy at a custom path that git does not track is found through the path the installer recorded; the standard paths and git's index would miss it."""
    bash = _bash()
    if bash is None:
        pytest.skip("git's bash not found")
    root = tmp_path / "consumer"
    _git(tmp_path, "init", "-q", "-b", "main", str(root))
    (root / "README.md").write_text("x\n", encoding="utf-8")
    _cgit(root, "add", "-A")
    _cgit(root, "commit", "-q", "--no-verify", "-m", "seed")
    vend = root / "vendor" / "rk"  # never added to git
    for rel in VENDORED_FILES:
        (vend / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / rel, vend / rel)
    hooks = _hooks_dir(root, tmp_path)
    r = subprocess.run([bash, "vendor/rk/install-hooks.sh"], cwd=root, env=_env(), input=b"y\n", capture_output=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "REPOKIT_INSTALLED_DIR='vendor/rk'" in (hooks / "pre-commit").read_text(encoding="utf-8")
    rc, text = _commit(root, "private/notes.md")
    assert rc != 0 and "COMMIT BLOCKED" in text, text


def test_a_flat_scripts_mount_works_too(tmp_path):
    """CONSEQUENCE: 6 (behaviour) -- repokit-common vendored flat at scripts/ (the older layout) is found by the stubs as well."""
    bash = _bash()
    if bash is None:
        pytest.skip("git's bash not found")
    root = tmp_path / "consumer"
    _git(tmp_path, "init", "-q", "-b", "main", str(root))
    for rel in VENDORED_FILES:
        (root / "scripts" / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / rel, root / "scripts" / rel)
    _cgit(root, "add", "-A")
    _cgit(root, "commit", "-q", "--no-verify", "-m", "seed")
    _hooks_dir(root, tmp_path)
    r = subprocess.run([bash, "scripts/install-hooks.sh"], cwd=root, env=_env(), input=b"y\n", capture_output=True)
    assert r.returncode == 0, r.stdout + r.stderr
    rc, text = _commit(root, "private/notes.md")
    assert rc != 0 and "COMMIT BLOCKED" in text, text


def test_a_push_through_the_stub_reaches_pre_push_with_its_refs(consumer):
    """CONSEQUENCE: 8 (safety) -- pre-push run through the stub still receives git's ref list on stdin and gates the push."""
    root, _, _, _ = consumer
    _commit(root, "tests/test_a.py", FAILING)
    rc, text = _cgit(root, "push", "-q", "origin", "main", check=False)
    assert rc != 0, text
    assert "BLOCKED: Cannot push to main with failing tests" in text
    assert "Tag-only" not in text and "nothing to push" not in text


def test_the_stubs_follow_the_vendored_copy_without_reinstalling(consumer):
    """CONSEQUENCE: 8 (behaviour) -- a change to the vendored hook (a subtree pull) takes effect with no re-install."""
    root, _, _, _ = consumer
    hook = root / "scripts" / "repokit-common" / "hooks" / "pre-commit"
    hook.write_text(hook.read_text(encoding="utf-8").replace(
        "rk_locate\n", "rk_locate\necho 'VENDORED COPY WAS UPDATED'\n", 1), encoding="utf-8", newline="\n")
    rc, text = _commit(root, "docs/page.md")
    assert rc == 0 and "VENDORED COPY WAS UPDATED" in text, text


def test_the_stubs_run_from_a_worktree(consumer, tmp_path):
    """CONSEQUENCE: 8 (safety) -- a worktree uses the shared stubs, which find the worktree's own copy."""
    root, _, _, _ = consumer
    wt = tmp_path / "wt"
    _cgit(root, "worktree", "add", "-q", "-b", "release", str(wt))
    rc, text = _commit(wt, "private/notes.md")
    assert rc != 0 and "COMMIT BLOCKED" in text, text


def _orphan_without_copy(root, branch):
    _cgit(root, "checkout", "-q", "--orphan", branch)
    _cgit(root, "rm", "-rq", "--cached", ".")
    shutil.rmtree(root / "scripts")  # this consumer's working tree, under tmp_path


def test_no_copy_on_a_gated_branch_blocks(consumer):
    """CONSEQUENCE: 9 (safety) -- a checkout without the vendored copy cannot run the checks; on a gated branch that stops the commit."""
    root, _, _, _ = consumer
    _orphan_without_copy(root, "live")
    rc, text = _commit(root, "private/notes.md")
    assert rc != 0, text
    assert "BLOCKED" in text and "no repokit-common copy" in text and "'live' is a gated branch" in text


def test_no_copy_elsewhere_warns_and_continues(consumer):
    """CONSEQUENCE: 7 (behaviour) -- off the gated branches a missing copy is a visible warning, never silence and never a block."""
    root, _, _, _ = consumer
    _orphan_without_copy(root, "feature/docs")
    rc, text = _commit(root, "docs/page.md")
    assert rc == 0, text
    assert "checks skipped" in text and "no repokit-common copy" in text


def test_an_empty_override_loosens_the_gate_for_one_run(consumer):
    """CONSEQUENCE: 6 (behaviour) -- REPOKIT_STRICT_BRANCHES= lets a person commit to a gated branch without the copy, for that run only."""
    root, _, _, _ = consumer
    _orphan_without_copy(root, "staging")
    env = dict(_env(), REPOKIT_STRICT_BRANCHES="")
    rc, text = _commit(root, "docs/page.md", env=env)
    assert rc == 0, text
    assert "checks skipped" in text


def test_the_installer_stamps_the_projects_strict_branches(tmp_path):
    """CONSEQUENCE: 6 (behaviour) -- the stub's fallback list is the project's strict-branches when set, so a missing copy blocks there."""
    bash = _bash()
    if bash is None:
        pytest.skip("git's bash not found")
    root = tmp_path / "consumer"
    _git(tmp_path, "init", "-q", "-b", "main", str(root))
    vend = root / "scripts" / "repokit-common"
    for rel in VENDORED_FILES:
        (vend / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / rel, vend / rel)
    (root / ".repokit-common.toml").write_text('[tool.repokit-common]\nstrict-branches = ["release/*", "main"]\n',
                                               encoding="utf-8")
    _hooks_dir(root, tmp_path)
    r = subprocess.run([bash, "scripts/repokit-common/install-hooks.sh"], cwd=root, env=_env(),
                       input=b"y\n", capture_output=True)
    out = (r.stdout + r.stderr).decode("utf-8", errors="replace")
    assert r.returncode == 0, out
    assert "REPOKIT_INSTALLED_STRICT='release/* main'" in (root / ".git" / "hooks" / "pre-commit").read_text(encoding="utf-8")
    assert "Gated branches for this checkout: release/* main" in out


def test_the_stub_passes_git_s_arguments_to_the_vendored_hook(consumer):
    """CONSEQUENCE: 6 (behaviour) -- git's hook arguments (pre-push: remote name and URL) reach the vendored hook unchanged."""
    root, _, _, _ = consumer
    hook = root / "scripts" / "repokit-common" / "hooks" / "pre-push"
    hook.write_text('#!/bin/bash\necho "ARGS[$1][$2]"\ncat >/dev/null\nexit 0\n', encoding="utf-8", newline="\n")
    _commit(root, "docs/page.md")
    rc, text = _cgit(root, "push", "-q", "origin", "main", check=False)
    assert rc == 0, text
    assert "ARGS[origin][" in text


def test_a_gated_pattern_is_matched_not_expanded_against_files(tmp_path):
    """CONSEQUENCE: 8 (safety) -- a folder named like a pattern (release/) must not turn the pattern release/* into file names and open the gate."""
    bash = _bash()
    if bash is None:
        pytest.skip("git's bash not found")
    root = tmp_path / "consumer"
    _git(tmp_path, "init", "-q", "-b", "main", str(root))
    vend = root / "scripts" / "repokit-common"
    for rel in VENDORED_FILES:
        (vend / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / rel, vend / rel)
    (root / ".repokit-common.toml").write_text('[tool.repokit-common]\nstrict-branches = ["release/*"]\n', encoding="utf-8")
    _cgit(root, "add", "-A")
    _cgit(root, "commit", "-q", "--no-verify", "-m", "seed")
    _hooks_dir(root, tmp_path)
    r = subprocess.run([bash, "scripts/repokit-common/install-hooks.sh"], cwd=root, env=_env(),
                       input=b"y\n", capture_output=True)
    assert r.returncode == 0, r.stdout + r.stderr
    _orphan_without_copy(root, "release/1.0")
    (root / "release").mkdir()
    (root / "release" / "notes.txt").write_text("x\n", encoding="utf-8")  # something for release/* to expand to
    rc, text = _commit(root, "docs/page.md")
    assert rc != 0, text
    assert "'release/1.0' is a gated branch" in text


def test_the_version_tool_beside_the_vendored_copy_is_the_one_used(tmp_path):
    """CONSEQUENCE: 7 (behaviour) -- with the copy mounted deep, a stray scripts/sync-versions.py elsewhere is never run in its place."""
    bash = _bash()
    if bash is None:
        pytest.skip("git's bash not found")
    root = tmp_path / "consumer"
    _git(tmp_path, "init", "-q", "-b", "main", str(root))
    vend = root / "tools" / "vendor" / "repokit-common"
    for rel in VENDORED_FILES:
        (vend / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / rel, vend / rel)
    stray = root / "scripts" / "sync-versions.py"
    stray.parent.mkdir(parents=True)
    # It fails on purpose: pre-commit shows the version tool's output only on failure.
    stray.write_text("import sys\nprint('STRAY SYNC SCRIPT RAN')\nsys.exit(1)\n", encoding="utf-8")
    _cgit(root, "add", "-A")
    _cgit(root, "commit", "-q", "--no-verify", "-m", "seed")
    _hooks_dir(root, tmp_path)
    r = subprocess.run([bash, "tools/vendor/repokit-common/install-hooks.sh"], cwd=root, env=_env(),
                       input=b"y\n", capture_output=True)
    assert r.returncode == 0, r.stdout + r.stderr
    rc, text = _commit(root, "docs/page.md")
    assert rc == 0, text
    assert "STRAY SYNC SCRIPT RAN" not in text


def test_the_installer_warns_when_core_hookspath_would_hide_the_stubs(repo, tmp_path):
    """CONSEQUENCE: 6 (safety) -- with core.hooksPath set, git would never run the stubs; the installer says so."""
    root, bash = repo
    _git(root, "config", "core.hooksPath", ".husky/_")
    _hooks_dir(root, tmp_path)
    out = _install(root, bash)
    assert "core.hooksPath is set to '.husky/_'" in out
