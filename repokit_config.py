#!/usr/bin/env python3
"""Find and read a project's repokit-common settings.

Settings live in the consuming project's ``pyproject.toml`` under
``[tool.repokit-common]``. A project without a ``pyproject.toml`` (C/C++,
Rust, ...) puts the same table in a ``.repokit-common.toml`` at its root.
When both exist in one directory, ``pyproject.toml`` wins.

Discovery walks up from the calling tool's own directory -- not the current
directory -- to the nearest file that holds the table, skipping a
``pyproject.toml`` without it. The walk never leaves the project: when it
reaches a directory containing ``.git`` it asks git, once, where the project
ends (the superproject's root when repokit-common is a submodule, else the
repository root) and stops there. Outside git there is no bound. This rule was
chosen by a proof of concept over eight layouts
(tests/one-offs/thinking/config-discovery/poc_config_discovery.py).

Command line (for the sh hooks):

    repokit_config.py --get KEY           print the value; a list prints one
                                          item per line; unset prints nothing
    repokit_config.py --shell KEY [KEY..] print REPOKIT_<KEY>=<quoted value>
                                          lines for `eval`; one call per hook
    repokit_config.py --where             print the config file's path
    --start DIR                           walk from DIR instead of this file's
                                          directory

Exit 0 on success (also when nothing is configured), 2 when a config file
exists but cannot be read (malformed TOML), with the reason on stderr, so a
hook can refuse rather than silently fall back to defaults. A Python with no
TOML parser (before 3.11, without tomli) is an environment gap, not a broken
file: it prints a warning on stderr and answers as if nothing were set.

Output for the hooks (stdout) is always UTF-8 with LF line endings, whatever
the console code page, because git gives the hooks paths as UTF-8.
"""

import argparse
import re
import shlex
import subprocess
import sys
from pathlib import Path

TABLE = "repokit-common"
FALLBACK_NAME = ".repokit-common.toml"
_TABLE_HEADER = re.compile(r'^\s*\[\s*tool\s*\.\s*"?repokit-common"?\s*\]', re.MULTILINE)


class ConfigError(Exception):
    """A config file exists but could not be read."""


class NoTomlParser(ConfigError):
    """This Python has no TOML parser (before 3.11, without tomli installed).

    An environment gap, not a broken file: callers warn and carry on without
    the project's settings, as sync-versions.py always has, instead of
    refusing every commit and push on such a machine.
    """


def _has_table(pyproject):
    """True when this pyproject.toml declares [tool.repokit-common].

    Decided from the text, so discovery works on a Python with no TOML parser;
    the chosen file is parsed later.
    """
    try:
        return bool(_TABLE_HEADER.search(pyproject.read_text(encoding="utf-8", errors="replace")))
    except OSError:
        return False


def _git(start, *args):
    try:
        r = subprocess.run(["git", "-C", str(start), "rev-parse", *args],
                           capture_output=True, text=True)
    except OSError:
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""


def _project_bound(start):
    """Where the project ends, asked from the tool's own directory.

    When repokit-common is its own repository (a submodule, or a clone of it)
    its directory is that repository's root, and the project is the
    superproject when there is one. When it is a subtree or a copy inside a
    project, the project is the repository that contains it -- even if that
    repository is itself a submodule of something larger, whose settings
    belong to a different project.
    """
    top = _git(start, "--show-toplevel")
    if not top:
        return None
    top = Path(top).resolve()
    if top == Path(start).resolve():
        sup = _git(start, "--show-superproject-working-tree")
        if sup:
            return Path(sup).resolve()
    return top


def find_config(start):
    """Return the config file for the project containing ``start``, or None."""
    start = Path(start).resolve()
    bound = ...  # not asked yet: git is only consulted at a .git marker
    for d in (start, *start.parents):
        py = d / "pyproject.toml"
        if py.is_file() and _has_table(py):
            return py
        alt = d / FALLBACK_NAME
        if alt.is_file():
            return alt
        if (d / ".git").exists():
            if bound is ...:
                bound = _project_bound(start)
            # A .git marker git will not explain is treated as the boundary.
            if bound is None or d == bound:
                return None
    return None


def _load_toml(path):
    try:
        import tomllib
    except ImportError:
        try:
            import tomli as tomllib
        except ImportError:
            raise NoTomlParser(
                f"{path} needs a TOML parser: use Python 3.11+ or install tomli") from None
    try:
        with open(path, "rb") as f:
            return tomllib.load(f)
    except (tomllib.TOMLDecodeError, OSError) as e:
        raise ConfigError(f"cannot read {path}: {e}") from None


def read_table(path):
    """The [tool.repokit-common] table from ``path`` (a dict; empty when absent)."""
    data = _load_toml(path)
    table = data.get("tool", {}).get(TABLE, {})
    return table if isinstance(table, dict) else {}


def load(start):
    """(config path or None, table dict) for the project containing ``start``."""
    path = find_config(start)
    return (path, read_table(path)) if path else (None, {})


def _as_text(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, tuple)):
        return "\n".join(str(v) for v in value)
    return str(value)


def _var_name(key):
    return "REPOKIT_" + re.sub(r"[^A-Za-z0-9]", "_", key).upper()


def _set_up_streams():
    """stdout is read by the hooks, not by a person: always UTF-8 with LF.

    git hands the hooks staged paths as UTF-8 bytes, so a non-ASCII pattern or
    command must arrive in UTF-8 whatever the console code page is (on
    Windows a pipe defaults to cp1252, which cannot encode e.g. a check mark
    and used to crash the call). stderr is read by a person: it keeps the
    console's encoding but can never crash on a character it cannot show.
    """
    for stream, kwargs in ((sys.stdout, {"encoding": "utf-8", "newline": "\n"}),
                           (sys.stderr, {"errors": "backslashreplace"})):
        try:
            stream.reconfigure(**kwargs)
        except (AttributeError, ValueError):
            pass  # not a text stream we can reconfigure (e.g. replaced by a test)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Read repokit-common settings for the project.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--get", metavar="KEY")
    g.add_argument("--shell", metavar="KEY", nargs="+")
    g.add_argument("--where", action="store_true")
    ap.add_argument("--start", default=str(Path(__file__).resolve().parent))
    args = ap.parse_args(argv)
    _set_up_streams()

    if args.where:
        path = find_config(args.start)
        if path:
            print(path)
        return 0
    try:
        _, table = load(args.start)
    except NoTomlParser as e:
        print(f"repokit-common: warning: {e}; the project's settings are skipped", file=sys.stderr)
        table = {}
    except ConfigError as e:
        print(f"repokit-common: {e}", file=sys.stderr)
        return 2
    if args.get:
        if args.get in table:
            print(_as_text(table[args.get]))
        return 0
    for key in args.shell:
        value = _as_text(table[key]) if key in table else ""
        print(f"{_var_name(key)}={shlex.quote(value)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
