"""Tests for vault-lint.py — each named for the vault-spec clause it enforces.

Fixture mirrors the real 12-broken-link population measured in the
claude-session-logger vault on 2026-08-12: 7 mechanically fixable
(unique resolution), 5 requiring judgment (timestamps, prose refs).
"""

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "vault-lint.py"


def _load():
    spec = importlib.util.spec_from_file_location("vault_lint", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


VL = _load()


@pytest.fixture
def vault(tmp_path):
    """A miniature vault reproducing every broken-link class."""
    v = tmp_path / "private" / "claude"
    (v / "_maps").mkdir(parents=True)
    (v / "issues").mkdir()
    (v / "notes" / "ideas").mkdir(parents=True)
    (v / "x").mkdir()
    (v / "y").mkdir()

    (v / "A.md").write_text("# A\n", encoding="utf-8")
    (v / "B.md").write_text("# B\n", encoding="utf-8")
    (v / "issues" / "C.md").write_text("# C\n", encoding="utf-8")
    (v / "x" / "Ambig.md").write_text("# ambig 1\n", encoding="utf-8")
    (v / "y" / "Ambig.md").write_text("# ambig 2\n", encoding="utf-8")
    (v / "_maps" / "MOC-test.md").write_text(
        "---\nlast_refreshed: 2026-08-13\n---\n# MOC\n[[A]] [[B]] [[issues/C]]\n",
        encoding="utf-8")

    (v / "notes" / "ideas" / "note.md").write_text(
        "# Note\n"
        "[[../../A]]\n"                       # REL -> unique -> fix to [[A]]
        "[[../../issues/C.md]]\n"             # REL+MD -> unique -> fix to [[issues/C]]
        "[[B.md|Bee]]\n"                      # MD, aliased -> fix keeps alias
        "| col | [[A\\|alias]] |\n"           # PIPE (table) -> alias-free [[A]]
        "[[2026-05-06 14:58:40]]\n"           # TIMESTAMP -> refuse
        "[[tool.repokit-common.extra-targets]]\n"  # MISSING prose ref -> refuse
        "[[../../Ambig.md]]\n"                # normalizes to 2 candidates -> refuse (AUTH-3)
        "```\n[[../../A]] inside fence is not a link\n```\n",
        encoding="utf-8")
    return v


def _run(v, *flags):
    return subprocess.run([sys.executable, str(TOOL), str(v), *flags],
                          capture_output=True, text=True, encoding="utf-8")


# --- vault-spec section WL: classification ---------------------------------

def test_WL1_relative_traversal_classified(vault):
    files = VL.vault_files(vault)
    assert "REL" in VL.classify("../../A", files)


def test_WL2_md_suffix_classified(vault):
    files = VL.vault_files(vault)
    assert "MD" in VL.classify("B.md", files)


def test_WL4_table_pipe_escape_classified(vault):
    files = VL.vault_files(vault)
    assert "PIPE" in VL.classify("A\\", files)


def test_WL_timestamp_pseudolink_classified(vault):
    files = VL.vault_files(vault)
    assert VL.classify("2026-05-06 14:58:40", files) == ["TIMESTAMP"]


def test_WL_fence_content_is_not_a_link(vault):
    targets = [t for _s, t, _l in VL.link_occurrences(vault)]
    assert "../../A inside fence is not a link" not in " ".join(targets)


# --- vault-spec AUTH-3: the fix contract -----------------------------------

def test_AUTH3_fix_applies_only_unique_resolutions(vault):
    files = VL.vault_files(vault)
    broken = [(s, t, l, VL.classify(t, files))
              for s, t, l in VL.link_occurrences(vault)
              if VL.classify(t, files)]
    fixed, refused = VL.apply_fixes(vault, files, broken, dry_run=False)
    fixed_targets = sorted(t for _s, t, _c in fixed)
    assert fixed_targets == sorted(["../../A", "../../issues/C.md", "B.md", "A\\"])
    refused_targets = {t for _s, t, _tags, _r in refused}
    assert {"2026-05-06 14:58:40", "tool.repokit-common.extra-targets", "../../Ambig.md"} <= refused_targets


def test_AUTH3_ambiguous_target_refused_with_candidates(vault):
    files = VL.vault_files(vault)
    assert len(VL.fix_candidates("../../Ambig.md", files)) == 2  # never auto-picked


def test_AUTH3_fix_rewrites_to_canonical_form_and_keeps_alias(vault):
    _run(vault, "--fix")
    text = (vault / "notes" / "ideas" / "note.md").read_text(encoding="utf-8")
    assert "[[A]]" in text and "[[issues/C]]" in text
    assert "[[B|Bee]]" in text                      # alias survives an MD fix
    assert "[[A\\|alias]]" not in text              # WL-4 artifact gone
    assert "\n[[../../A]]\n" not in text            # the link line was fixed...
    assert "[[../../A]] inside fence" in text       # ...but fenced content is untouched (--fix side of the fence rule)
    assert "[[2026-05-06 14:58:40]]" in text        # judgment classes untouched
    assert "[[tool.repokit-common.extra-targets]]" in text
    assert "[[../../Ambig.md]]" in text            # ambiguous: untouched


def test_AUTH3_fix_is_idempotent(vault):
    _run(vault, "--fix")
    before = (vault / "notes" / "ideas" / "note.md").read_bytes()
    _run(vault, "--fix")
    assert (vault / "notes" / "ideas" / "note.md").read_bytes() == before


def test_AUTH3_default_mode_is_read_only(vault):
    before = (vault / "notes" / "ideas" / "note.md").read_bytes()
    _run(vault)              # report mode
    _run(vault, "--check")   # check mode
    _run(vault, "--fix", "--dry-run")
    assert (vault / "notes" / "ideas" / "note.md").read_bytes() == before


# --- CLI contract -----------------------------------------------------------

def test_check_exit_codes(vault):
    assert _run(vault, "--check").returncode == 1     # findings present
    _run(vault, "--fix")
    # timestamps/prose/ambiguous remain -> still nonzero, honestly
    assert _run(vault, "--check").returncode == 1


def test_clean_vault_exits_zero(tmp_path):
    v = tmp_path / "private" / "claude"
    (v / "_maps").mkdir(parents=True)
    (v / "A.md").write_text("# A\n", encoding="utf-8")
    (v / "_maps" / "MOC-t.md").write_text("---\nlast_refreshed: 2099-01-01\n---\n[[A]]\n",
                                          encoding="utf-8")
    assert _run(v, "--check").returncode == 0


# --- vault-spec LAYOUT: root location (the wrong-root hazard) ---------------

def test_LAYOUT3_project_root_argument_descends_to_vault(vault, tmp_path):
    """Handed the PROJECT dir (parent of private/), the tool must lint the
    vault inside it — field-observed: linting a repo as a vault reported 31
    valid vault-root links as MISSING and --fix would have miswritten REL
    fixes into project-rooted (dead) forms."""
    direct = _run(vault)
    via_project = _run(tmp_path)          # tmp_path contains private/claude
    assert "descending to its vault" in via_project.stdout
    # identical broken-link population either way
    import re
    count = lambda r: re.search(r"Broken links: (\d+)", r.stdout).group(1)
    assert count(direct) == count(via_project)


def test_LAYOUT3_non_vault_path_refused(tmp_path):
    empty = tmp_path / "not-a-vault"
    empty.mkdir()
    r = _run(empty)
    assert r.returncode == 2
    assert "refusing" in r.stderr.lower()


# --- adopted from the 2026-08-13 mutation run (M4/M7 killers, verbatim) -----

def test_AUTH3_anchor_combined_with_fixable_class_refused_for_judgment(vault):
    """A target that is BOTH a fixable class (MD) and ANCHOR must be refused
    for the judgment reason specifically -- not merely land in the refused
    list for some other reason. normalize() never strips '#...', so an
    ANCHOR+MD target can never actually resolve to a file either way; this
    test exists to pin the REASON the guard produces, so a change that lets
    ANCHOR/TIMESTAMP+fixable-class targets fall through to the lookup path
    (instead of being refused up front) is caught even though the current
    fixture never puts a fixable-class tag together with ANCHOR."""
    files = VL.vault_files(vault)
    target = "B#note.md"  # MD (ends .md) + ANCHOR (contains '#')
    tags = VL.classify(target, files)
    assert set(tags) == {"MD", "ANCHOR"}
    broken = [(vault / "notes" / "ideas" / "note.md", target, 1, tags)]
    _fixed, refused = VL.apply_fixes(vault, files, broken, dry_run=True)
    assert len(refused) == 1
    _src, _t, _tags, reason = refused[0]
    assert reason == "class needs judgment"


def test_WL1_double_dot_dot_normalization_disambiguates_via_full_path(vault):
    """normalize()'s while-loop strips ALL leading '../' segments so the
    resulting string can hit the exact full-path 'in files' fast path in
    fix_candidates -- not just the basename fallback. Without that
    stripping, a target pointing at one of two same-named files in
    different directories (x/Ambig.md vs y/Ambig.md) degrades from a unique
    full-path resolution into an ambiguous basename resolution, silently
    turning a safe, mechanical fix into a refusal."""
    files = VL.vault_files(vault)
    assert VL.normalize("../../x/Ambig.md") == "x/Ambig"
    assert VL.fix_candidates("../../x/Ambig.md", files) == ["x/Ambig"]


# --- newline preservation (the real-file sweep finding) ---------------------
# Fixtures MUST author endings explicitly: a bare write_text on Windows
# creates CRLF fixtures, which is exactly the blind spot that hid this bug.

LF = chr(10)
CRLF = chr(13) + chr(10)


def _ending_vault(tmp_path, newline):
    v = tmp_path / 'private' / 'claude'
    (v / '_maps').mkdir(parents=True)
    (v / 'A.md').write_text('# A' + LF, encoding='utf-8')
    note = v / 'note.md'
    with note.open('w', encoding='utf-8', newline=newline) as fh:
        fh.write('# N' + LF + '[[../../A]]' + LF + 'plain one' + LF + 'plain two' + LF)
    return v, note


def test_fix_preserves_LF_endings(tmp_path):
    v, note = _ending_vault(tmp_path, LF)
    assert CRLF.encode() not in note.read_bytes()
    _run(v, '--fix')
    data = note.read_bytes()
    assert b'[[A]]' in data                 # the fix landed
    assert CRLF.encode() not in data        # endings stayed pure LF


def test_fix_preserves_CRLF_endings(tmp_path):
    v, note = _ending_vault(tmp_path, CRLF)
    assert note.read_bytes().count(CRLF.encode()) == 4
    _run(v, '--fix')
    data = note.read_bytes()
    assert b'[[A]]' in data                 # the fix landed
    assert data.count(CRLF.encode()) == 4   # every CRLF survived
    assert LF.encode() not in data.replace(CRLF.encode(), b'')  # no bare-LF leakage
