"""Tests for sync-versions.py's _load_config().

_load_config() walks up from the script's own ``__file__``, not the working
directory, so each test points the loaded module's ``__file__`` into a temp
tree. The TOML parser is chosen by ``import`` at call time, so a ``None`` entry
in ``sys.modules`` reproduces a parser-less Python on any version.

Ordered by consequence score, highest first; the superficial test is last.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

TOOL = Path(__file__).resolve().parents[1] / "sync-versions.py"
_spec = importlib.util.spec_from_file_location("sync_versions", TOOL)
SV = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SV)

DEFAULTS = (
    "$PACKAGE_NAME/_version.py",
    "CHANGELOG.md",
    "https://github.com/$GITHUB_ORG/$PROJECT_NAME",
    "v",
    "pep440",
)

CONFIGURED = """\
[tool.repokit-common]
version-source = "mypkg/_version.py"
changelog = "CHANGELOG.md"
repo-url = "https://github.com/acme/mypkg"
tag-prefix = "v"
tag-format = "human"
"""


@pytest.fixture
def pyproject(tmp_path, monkeypatch):
    """The path of a pyproject.toml the walk-up will find; each test writes it."""
    root = tmp_path / "proj"
    (root / "scripts").mkdir(parents=True)
    monkeypatch.setattr(SV, "__file__", str(root / "scripts" / "sync-versions.py"))
    return root / "pyproject.toml"


@pytest.fixture
def no_parser(monkeypatch):
    monkeypatch.setitem(sys.modules, "tomllib", None)
    monkeypatch.setitem(sys.modules, "tomli", None)


def test_readable_config_is_used_silently(pyproject, capsys):
    """CONSEQUENCE: 6 (behaviour) -- a readable [tool.repokit-common] table is
    what the script uses, and reading it says nothing."""
    pyproject.write_text(CONFIGURED, encoding="utf-8")

    assert SV._load_config() == (
        "mypkg/_version.py", "CHANGELOG.md", "https://github.com/acme/mypkg",
        "v", "human",
    )
    assert capsys.readouterr().err == ""


def test_unreadable_pyproject_still_returns_the_defaults(pyproject, no_parser):
    """CONSEQUENCE: 6 (behaviour) -- with no parser the loader falls back to the
    defaults rather than failing; the fix only adds a warning."""
    pyproject.write_text(CONFIGURED, encoding="utf-8")

    assert SV._load_config() == DEFAULTS


def test_unreadable_pyproject_warns_once_naming_the_file_and_the_remedies(
        pyproject, no_parser, capsys):
    """CONSEQUENCE: 5 (behaviour) -- the anchor. A pyproject.toml that cannot be
    parsed is announced in one line naming the file and both remedies; the
    remedy text is a contract, since it is what the user must act on."""
    pyproject.write_text(CONFIGURED, encoding="utf-8")

    SV._load_config()

    lines = [ln for ln in capsys.readouterr().err.splitlines() if ln.strip()]
    assert len(lines) == 1, f"expected one warning line, got {lines!r}"
    assert str(pyproject) in lines[0]
    assert "3.11" in lines[0] and "tomli" in lines[0]


def test_no_pyproject_anywhere_is_silent(tmp_path, monkeypatch, no_parser, capsys):
    """CONSEQUENCE: 5 (behaviour) -- nothing went unread, so nothing is said; a
    fix that warned on a missing parser alone would fire on every project."""
    deep = tmp_path / "a" / "b" / "c" / "d" / "e"
    deep.mkdir(parents=True)
    monkeypatch.setattr(SV, "__file__", str(deep / "sync-versions.py"))

    assert SV._load_config() == DEFAULTS
    assert capsys.readouterr().err == ""


def test_pyproject_without_the_table_is_silent(pyproject, capsys):
    """CONSEQUENCE: 5 (behaviour) -- a readable pyproject with no
    [tool.repokit-common] table is a normal state, not a failure."""
    pyproject.write_text('[project]\nname = "mypkg"\n', encoding="utf-8")

    assert SV._load_config() == DEFAULTS
    assert capsys.readouterr().err == ""


def test_unknown_tag_format_warns_and_falls_back(pyproject, capsys):
    """CONSEQUENCE: 5 (behaviour) -- an invalid tag-format is reported and
    replaced by pep440."""
    pyproject.write_text('[tool.repokit-common]\ntag-format = "banana"\n',
                         encoding="utf-8")

    assert SV._load_config()[4] == "pep440"
    assert "banana" in capsys.readouterr().err


# --- superficial (CONSEQUENCE 1-3) ---

def test_project_root_error_names_the_version_source(monkeypatch):
    """CONSEQUENCE: 2 (ux) -- the downstream error still names the file it
    looked for; pins wording in another function."""
    monkeypatch.setattr(SV, "VERSION_SOURCE", DEFAULTS[0])

    def _no_git(*a, **kw):
        raise FileNotFoundError("git not on PATH")

    monkeypatch.setattr(SV.subprocess, "run", _no_git)   # never reach a real repo

    with pytest.raises(FileNotFoundError, match=r"Cannot find \$PACKAGE_NAME/_version\.py"):
        SV.find_project_root()
