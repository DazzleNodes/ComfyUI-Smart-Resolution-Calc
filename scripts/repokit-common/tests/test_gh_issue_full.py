"""Tests for gh_issue_full.py's full-vs-truncated default.

The script shows issues in full unless told otherwise. resolve_full() picks the
answer: a --full/--no-full flag, else GH_ISSUE_FULL_DEFAULT, else
gh-issue-full-default in the consuming project's pyproject.toml, else full.

_load_full_default_config() walks up from the script's own ``__file__``, so
each test points the loaded module's ``__file__`` into a temp tree. No test
touches the network: display_issue() is never called.

Ordered by consequence score, highest first.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

TOOL = Path(__file__).resolve().parents[1] / "gh_issue_full.py"
_spec = importlib.util.spec_from_file_location("gh_issue_full", TOOL)
GH = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(GH)


@pytest.fixture
def project(tmp_path, monkeypatch):
    """A consuming project with the script vendored at scripts/repokit-common/.

    Returns a writer for the project's pyproject.toml. The environment
    variable is cleared so the machine running the suite cannot leak in.
    """
    script_dir = tmp_path / "proj" / "scripts" / "repokit-common"
    script_dir.mkdir(parents=True)
    monkeypatch.setattr(GH, "__file__", str(script_dir / "gh_issue_full.py"))
    monkeypatch.delenv(GH.FULL_DEFAULT_ENV, raising=False)

    def write(value=None):
        body = "[project]\nname = 'x'\n"
        if value is not None:
            body += f"\n[tool.repokit-common]\ngh-issue-full-default = \"{value}\"\n"
        (tmp_path / "proj" / "pyproject.toml").write_text(body, encoding="utf-8")

    return write


def test_default_is_full_with_nothing_configured(project):
    """10 -- the whole point: forgetting the flag must not hide the history."""
    project()
    assert GH.resolve_full(None) is True


def test_flag_wins_over_env_and_config(project, monkeypatch):
    """10 -- a flag on the command line always wins, in both directions."""
    project("truncated")
    monkeypatch.setenv(GH.FULL_DEFAULT_ENV, "truncated")
    assert GH.resolve_full(True) is True
    project("full")
    monkeypatch.setenv(GH.FULL_DEFAULT_ENV, "full")
    assert GH.resolve_full(False) is False


def test_main_passes_the_resolved_choice_to_display(project, monkeypatch):
    """10 -- the flag must reach display_issue through main(), not just the parser.

    display_issue is stubbed, so nothing reaches the network.
    """
    seen = []
    monkeypatch.setattr(GH, "display_issue", lambda *a, **kw: seen.append(kw["full"]))
    monkeypatch.setattr(GH, "ensure_utf8_stdout", lambda: None)
    project("full")
    monkeypatch.setenv(GH.FULL_DEFAULT_ENV, "full")
    GH.main(["5", "--no-full"])
    project("truncated")
    monkeypatch.setenv(GH.FULL_DEFAULT_ENV, "truncated")
    GH.main(["5", "--full"])
    GH.main(["5"])
    GH.main(["5", "--edit", "1"])
    assert seen == [False, True, False, True]


def test_env_wins_over_config(project, monkeypatch):
    """9 -- the per-user setting overrides the per-repo one."""
    project("full")
    monkeypatch.setenv(GH.FULL_DEFAULT_ENV, "truncated")
    assert GH.resolve_full(None) is False
    project("truncated")
    monkeypatch.setenv(GH.FULL_DEFAULT_ENV, "full")
    assert GH.resolve_full(None) is True


def test_config_sets_the_default(project):
    """9 -- a repo can choose truncated, and the value is read case-insensitively."""
    project("Truncated")
    assert GH.resolve_full(None) is False
    project("full")
    assert GH.resolve_full(None) is True
    project(" truncated ")
    assert GH.resolve_full(None) is False


def test_empty_env_is_unset_not_invalid(project, monkeypatch, capsys):
    """7 -- `GH_ISSUE_FULL_DEFAULT=` means unset: no warning, the repo setting applies."""
    project("truncated")
    monkeypatch.setenv(GH.FULL_DEFAULT_ENV, "")
    assert GH.resolve_full(None) is False
    assert capsys.readouterr().err == ""


def test_invalid_values_warn_and_fall_through(project, monkeypatch, capsys):
    """8 -- a typo is reported by source and never silently flips the default."""
    project("truncated")
    monkeypatch.setenv(GH.FULL_DEFAULT_ENV, "yes")
    assert GH.resolve_full(None) is False  # env ignored, config used
    err = capsys.readouterr().err
    assert GH.FULL_DEFAULT_ENV in err and "'yes'" in err

    project("sometimes")
    monkeypatch.delenv(GH.FULL_DEFAULT_ENV)
    assert GH.resolve_full(None) is True  # config ignored, built-in full
    assert "sometimes" in capsys.readouterr().err


def test_parser_flags_are_exclusive_and_tri_state():
    """8 -- neither flag leaves the choice to resolve_full; both is an error."""
    parser = GH.build_parser()
    assert parser.parse_args(["5"]).full is None
    assert parser.parse_args(["5", "--full"]).full is True
    assert parser.parse_args(["5", "-f"]).full is True
    assert parser.parse_args(["5", "--no-full"]).full is False
    with pytest.raises(SystemExit):
        parser.parse_args(["5", "--full", "--no-full"])


def test_no_parser_warns_only_when_the_key_is_present(project, monkeypatch, capsys):
    """6 -- a parser-less Python ignores the key, says so, and is quiet otherwise."""
    monkeypatch.setitem(sys.modules, "tomllib", None)
    monkeypatch.setitem(sys.modules, "tomli", None)
    project("truncated")
    assert GH.resolve_full(None) is True
    assert GH.FULL_DEFAULT_KEY in capsys.readouterr().err

    project()
    assert GH.resolve_full(None) is True
    assert capsys.readouterr().err == ""


def test_tomli_is_used_when_tomllib_is_missing(project, monkeypatch):
    """6 -- Python 3.10 with tomli installed still honours the repo setting."""
    import tomllib as real_parser

    monkeypatch.setitem(sys.modules, "tomllib", None)
    monkeypatch.setitem(sys.modules, "tomli", real_parser)
    project("truncated")
    assert GH.resolve_full(None) is False


def test_no_pyproject_means_full(tmp_path, monkeypatch):
    """5 -- a script run outside any project still defaults to full."""
    deep = tmp_path / "a" / "b" / "c" / "d" / "e" / "f"
    deep.mkdir(parents=True)
    monkeypatch.setattr(GH, "__file__", str(deep / "gh_issue_full.py"))
    monkeypatch.delenv(GH.FULL_DEFAULT_ENV, raising=False)
    assert GH._load_full_default_config() is None
    assert GH.resolve_full(None) is True
