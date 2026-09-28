"""Tests for repokit_config.py: finding and reading a project's settings.

Layouts mirror the proof of concept in
tests/one-offs/thinking/config-discovery/poc_config_discovery.py, which chose
the rule. Each builds throwaway repositories under ``tmp_path``; git runs only
there, with signing off.

Ordered by consequence score, highest first.
"""

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

TOOL = Path(__file__).resolve().parents[1] / "repokit_config.py"
_spec = importlib.util.spec_from_file_location("repokit_config", TOOL)
RC = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(RC)

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")
GIT = ["git", "-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false"]


def _w(path, text=""):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _cfg(marker):
    return f'[project]\nname = "p"\n\n[tool.repokit-common]\nmarker = "{marker}"\n'


def _init(path):
    subprocess.run(GIT + ["init", "-q", "-b", "main", str(path)], check=True)


def test_never_leaves_the_project_for_an_unrelated_config(tmp_path):
    """CONSEQUENCE: 8 (safety) -- a project with no config never picks up a configured pyproject.toml above its repository."""
    _w(tmp_path / "outer" / "pyproject.toml", _cfg("UNRELATED"))
    proj = tmp_path / "outer" / "proj"
    tool = _w(proj / "scripts" / "repokit-common" / "tool.py")
    _init(proj)
    assert RC.find_config(tool.parent) is None


def test_submodule_finds_the_superprojects_config(tmp_path):
    """CONSEQUENCE: 7 (behaviour) -- repokit-common as a real submodule reads the consuming project's config, not its own table-less pyproject."""
    src = tmp_path / "rk"
    _w(src / "pyproject.toml", '[project]\nname = "repokit-common"\n')
    _w(src / "tool.py")
    _init(src)
    subprocess.run(GIT + ["-C", str(src), "add", "-A"], check=True)
    subprocess.run(GIT + ["-C", str(src), "commit", "-q", "-m", "rk"], check=True)
    proj = tmp_path / "proj"
    exp = _w(proj / "pyproject.toml", _cfg("proj"))
    _init(proj)
    subprocess.run(GIT + ["-c", "protocol.file.allow=always", "-C", str(proj), "submodule", "add", "-q",
                          src.as_posix(), "scripts/repokit-common"], check=True)
    sub = proj / "scripts" / "repokit-common"
    assert (sub / ".git").is_file()
    assert RC.find_config(sub) == exp.resolve()


def test_a_project_that_is_itself_a_submodule_never_reads_its_parents_config(tmp_path):
    """CONSEQUENCE: 8 (safety) -- a subtree copy inside a submodule (a DazzleNodes node) stops at the node, never taking the parent's settings or test-command."""
    node = tmp_path / "node-src"
    _w(node / "pyproject.toml", '[project]\nname = "node"\n')
    _w(node / "scripts" / "repokit-common" / "tool.py")
    _init(node)
    subprocess.run(GIT + ["-C", str(node), "add", "-A"], check=True)
    subprocess.run(GIT + ["-C", str(node), "commit", "-q", "-m", "node"], check=True)
    sup = tmp_path / "super"
    _w(sup / "pyproject.toml", _cfg("PARENT"))
    _init(sup)
    subprocess.run(GIT + ["-c", "protocol.file.allow=always", "-C", str(sup), "submodule", "add", "-q",
                          node.as_posix(), "nodes/node"], check=True)
    tool_dir = sup / "nodes" / "node" / "scripts" / "repokit-common"
    assert tool_dir.is_dir()
    assert RC.find_config(tool_dir) is None


@pytest.mark.parametrize("rel", [
    "scripts",                                               # flat
    "scripts/repokit-common",                                # nested subtree
    "Software/area/tools/vendor/Repokit-Scripts/lib",        # deeper than the old 5-level limit
])
def test_finds_the_project_config_from_any_mount_depth(tmp_path, rel):
    """CONSEQUENCE: 7 (behaviour) -- the project's config is found wherever repokit-common is mounted."""
    proj = tmp_path / "proj"
    exp = _w(proj / "pyproject.toml", _cfg("proj"))
    tool = _w(proj / rel / "tool.py")
    _init(proj)
    assert RC.find_config(tool.parent) == exp.resolve()


def test_skips_a_pyproject_without_the_table(tmp_path):
    """CONSEQUENCE: 6 (behaviour) -- a nested pyproject.toml that does not declare the table is walked past."""
    proj = tmp_path / "proj"
    exp = _w(proj / "pyproject.toml", _cfg("proj"))
    _w(proj / "tools" / "pyproject.toml", '[project]\nname = "inner"\n')
    tool = _w(proj / "tools" / "scripts" / "tool.py")
    _init(proj)
    assert RC.find_config(tool.parent) == exp.resolve()


def test_fallback_file_for_a_project_without_pyproject(tmp_path):
    """CONSEQUENCE: 6 (behaviour) -- a C/C++ or Rust project's .repokit-common.toml is found and read."""
    proj = tmp_path / "proj"
    _w(proj / ".repokit-common.toml", '[tool.repokit-common]\ntest-command = "make test"\n')
    tool = _w(proj / "scripts" / "repokit-common" / "tool.py")
    _init(proj)
    path, table = RC.load(tool.parent)
    assert path.name == ".repokit-common.toml"
    assert table == {"test-command": "make test"}


def test_pyproject_wins_over_the_fallback_file(tmp_path):
    """CONSEQUENCE: 5 (behaviour) -- when both files are in one directory, pyproject.toml is used."""
    proj = tmp_path / "proj"
    exp = _w(proj / "pyproject.toml", _cfg("pyproject"))
    _w(proj / ".repokit-common.toml", '[tool.repokit-common]\nmarker = "fallback"\n')
    tool = _w(proj / "scripts" / "tool.py")
    _init(proj)
    path, table = RC.load(tool.parent)
    assert path == exp.resolve() and table["marker"] == "pyproject"


def test_malformed_config_exits_2_with_a_reason(tmp_path, capsys):
    """CONSEQUENCE: 7 (safety) -- an unreadable config is reported, never silently replaced by defaults, so a hook can refuse."""
    proj = tmp_path / "proj"
    _w(proj / "pyproject.toml", '[tool.repokit-common]\ntest-command = "unterminated\n')
    tool = _w(proj / "scripts" / "tool.py")
    _init(proj)
    assert RC.main(["--get", "test-command", "--start", str(tool.parent)]) == 2
    assert "cannot read" in capsys.readouterr().err


def test_shell_output_is_safe_to_eval_and_unset_keys_are_empty(tmp_path, capsys):
    """CONSEQUENCE: 6 (behaviour) -- one call gives a hook every key it needs, quoted for sh; lists arrive one item per line."""
    proj = tmp_path / "proj"
    _w(proj / "pyproject.toml",
       "[tool.repokit-common]\n"
       "test-command = \"python t.py && echo 'done' $HOME\"\n"
       'private-patterns = ["private/", "convos/"]\n')
    tool = _w(proj / "scripts" / "tool.py")
    _init(proj)
    assert RC.main(["--shell", "test-command", "private-patterns", "print-warning",
                    "--start", str(tool.parent)]) == 0
    out = capsys.readouterr().out
    sh = shutil.which("sh")
    if sh is None:
        pytest.skip("no sh on PATH")
    script = out + 'printf "%s|%s|%s" "$REPOKIT_TEST_COMMAND" "$REPOKIT_PRIVATE_PATTERNS" "$REPOKIT_PRINT_WARNING"'
    r = subprocess.run([sh, "-c", script], capture_output=True, text=True)
    assert r.stdout == "python t.py && echo 'done' $HOME|private/\nconvos/|"


def test_non_ascii_values_reach_the_hooks_as_utf8_on_any_console(tmp_path):
    """CONSEQUENCE: 7 (safety) -- a value like a check mark neither crashes the call on a Windows pipe (cp1252) nor arrives in the console's code page; git gives hooks UTF-8 paths, so patterns must be UTF-8 too."""
    proj = tmp_path / "proj"
    _w(proj / ".repokit-common.toml",
       '[tool.repokit-common]\ntest-command = "echo ✓ café"\nprivate-patterns = ["brouillons-é/", "b/"]\n')
    _init(proj)
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONIOENCODING", "PYTHONUTF8")}
    r = subprocess.run([sys.executable, str(TOOL), "--get", "private-patterns", "--start", str(proj)],
                       capture_output=True, env=env)
    assert r.returncode == 0, r.stderr
    assert r.stdout == "brouillons-é/\nb/\n".encode("utf-8")   # UTF-8, LF only
    r = subprocess.run([sys.executable, str(TOOL), "--shell", "test-command", "--start", str(proj)],
                       capture_output=True, env=env)
    assert r.returncode == 0, r.stderr
    assert "✓ café" in r.stdout.decode("utf-8")


def test_a_python_without_a_toml_parser_warns_and_skips_instead_of_blocking(tmp_path, monkeypatch, capsys):
    """CONSEQUENCE: 8 (behaviour) -- before 3.11 without tomli, the helper warns and answers as if nothing were set, so hooks do not refuse every commit and push; a broken file still exits 2."""
    proj = tmp_path / "proj"
    _w(proj / "pyproject.toml", "[tool.repokit-common]\nprint-warning = false\n")
    tool = _w(proj / "scripts" / "tool.py")
    _init(proj)
    monkeypatch.setitem(sys.modules, "tomllib", None)
    monkeypatch.setitem(sys.modules, "tomli", None)
    assert RC.main(["--shell", "test-command", "print-warning", "--start", str(tool.parent)]) == 0
    out, err = capsys.readouterr()
    assert out == "REPOKIT_TEST_COMMAND=''\nREPOKIT_PRINT_WARNING=''\n"
    assert "needs a TOML parser" in err and "skipped" in err


def test_stops_at_the_repository_when_git_cannot_say_where_it_ends(tmp_path, monkeypatch):
    """CONSEQUENCE: 8 (safety) -- if git gives no answer, the .git marker itself is the boundary; the walk never escapes."""
    _w(tmp_path / "outer" / "pyproject.toml", _cfg("UNRELATED"))
    proj = tmp_path / "outer" / "proj"
    tool = _w(proj / "scripts" / "tool.py")
    (proj / ".git").mkdir(parents=True)
    monkeypatch.setattr(RC, "_git", lambda start, *args: "")
    assert RC.find_config(tool.parent) is None


def test_a_commented_out_table_header_does_not_count(tmp_path):
    """CONSEQUENCE: 5 (behaviour) -- only a real [tool.repokit-common] header marks the config, not a comment mentioning it."""
    proj = tmp_path / "proj"
    exp = _w(proj / "pyproject.toml", _cfg("proj"))
    _w(proj / "pkg" / "pyproject.toml", '[project]\nname = "inner"\n# see [tool.repokit-common] in the root\n')
    tool = _w(proj / "pkg" / "scripts" / "tool.py")
    _init(proj)
    assert RC.find_config(tool.parent) == exp.resolve()


def test_a_non_table_value_reads_as_empty(tmp_path):
    """CONSEQUENCE: 4 (behaviour) -- a malformed-but-parseable config (a value where the table should be) yields no settings rather than a crash."""
    f = _w(tmp_path / ".repokit-common.toml", '[tool]\nrepokit-common = "oops"\n')
    assert RC.read_table(f) == {}


def test_get_prints_booleans_lowercase_and_nothing_for_unset_keys(tmp_path, capsys):
    """CONSEQUENCE: 5 (behaviour) -- hooks compare against 'false'; an unset key prints nothing at all."""
    proj = tmp_path / "proj"
    _w(proj / "pyproject.toml", "[tool.repokit-common]\nprint-warning = false\n")
    tool = _w(proj / "scripts" / "tool.py")
    _init(proj)
    assert RC.main(["--get", "print-warning", "--start", str(tool.parent)]) == 0
    assert capsys.readouterr().out == "false\n"
    assert RC.main(["--get", "test-command", "--start", str(tool.parent)]) == 0
    assert capsys.readouterr().out == ""
