"""Tests for generate-backlinks.py, centred on note decoding.

The bug these exist for: the indexer read every note with
``read_text(encoding='utf-8', errors='ignore')``. That call never raises, so
it looked safe -- but a UTF-16 document decodes to ``#\\x00 \\x00T\\x00i...``
and every ``[[wikilink]]`` in it silently fails to match. The note reported
zero links and dropped out of the graph with no error at all. Two documents
in the EDAPITool vault had been invisible that way; the script is consumed by
nine-plus projects, so any of them holding a non-UTF-8 note had the same
silent hole.

Each encoding test therefore asserts the *edge exists*, not merely that the
read succeeded -- reading was never what failed.
"""

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "generate-backlinks.py"


def _load():
    spec = importlib.util.spec_from_file_location("generate_backlinks", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


GB = _load()


@pytest.fixture(autouse=True)
def _reset_encoding_state():
    """Clear the module-level accumulators between tests.

    ``_non_utf8`` and ``_undecodable`` are module globals filled during a walk
    and drained once at the end of a run. One process = one vault, so that is
    correct for the tool -- but the test module loads it once and reuses it,
    so without this every test would see its predecessors' findings.
    """
    GB._non_utf8.clear()
    GB._undecodable.clear()
    yield
    GB._non_utf8.clear()
    GB._undecodable.clear()


@pytest.fixture
def vault(tmp_path):
    """A miniature vault. Notes are added per-test; TARGET is always present."""
    v = tmp_path / "private" / "claude"
    (v / "_maps").mkdir(parents=True)
    (v / "TARGET.md").write_text("# Target\n", encoding="utf-8")
    return v


def _run(v, *flags):
    return subprocess.run(
        [sys.executable, str(TOOL), str(v), *flags],
        capture_output=True, text=True, encoding="utf-8",
        env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"},
    )


# --- the bug: non-UTF-8 notes must still contribute their links ------------

@pytest.mark.parametrize("encoding,label", [
    ("utf-16", "utf-16 with BOM"),
    ("utf-16-le", "utf-16 LE, BOM written explicitly"),
    ("utf-16-be", "utf-16 BE, BOM written explicitly"),
])
def test_utf16_note_contributes_its_links(vault, encoding, label):
    """ANCHOR. Pre-fix this found zero links and reported no error."""
    note = vault / "source.md"
    text = "# Source\n\nSee [[TARGET]] for the rest.\n"
    if encoding == "utf-16":
        note.write_bytes(text.encode("utf-16"))          # codec emits the BOM
    elif encoding == "utf-16-le":
        note.write_bytes(b"\xff\xfe" + text.encode("utf-16-le"))
    else:
        note.write_bytes(b"\xfe\xff" + text.encode("utf-16-be"))

    forward, backlinks, _ = GB.build_indices(vault)

    assert forward["source"] == ["TARGET"], f"{label}: link not parsed"
    assert backlinks["TARGET"] == ["source"], f"{label}: no reverse edge"


def test_cp1252_note_without_bom_contributes_its_links(vault):
    """ANCHOR. No BOM and invalid UTF-8 -- the fallback chain must catch it."""
    note = vault / "source.md"
    # U+2019 encodes to the single byte 0x92 in cp1252, which is not valid UTF-8.
    note.write_bytes("# It’s here\n\n[[TARGET]]\n".encode("cp1252"))

    forward, _, _ = GB.build_indices(vault)

    assert forward["source"] == ["TARGET"]
    assert [p.name for p, _ in GB._non_utf8] == ["source.md"]


def test_utf8_note_with_bom_is_read_and_not_flagged(vault):
    """A utf-8-sig note is still UTF-8; it must not be reported as an exception."""
    note = vault / "source.md"
    note.write_bytes(b"\xef\xbb\xbf" + "# Source\n\n[[TARGET]]\n".encode("utf-8"))

    forward, _, _ = GB.build_indices(vault)

    assert forward["source"] == ["TARGET"]
    assert GB._non_utf8 == [], "utf-8-sig must not be reported as non-UTF-8"


def test_plain_utf8_note_is_unaffected(vault):
    """GUARD. The common path must not regress; this passed before the fix too."""
    (vault / "source.md").write_text(
        "# Source\n\n[[TARGET]]\n\n```\n[[TARGET]] in a fence is not a link\n```\n",
        encoding="utf-8")

    forward, backlinks, _ = GB.build_indices(vault)

    assert forward["source"] == ["TARGET"], "fenced link must not be counted twice"
    assert backlinks["TARGET"] == ["source"]
    assert GB._non_utf8 == []


def test_utf32_bom_is_matched_before_utf16(vault):
    """A UTF-32 LE BOM starts with the UTF-16 LE BOM; order in _BOMS decides."""
    note = vault / "source.md"
    note.write_bytes("# Source\n\n[[TARGET]]\n".encode("utf-32"))

    forward, _, _ = GB.build_indices(vault)

    assert forward["source"] == ["TARGET"]


# --- reporting: the vault owner has to be told -----------------------------

def test_non_utf8_file_is_reported_by_name(vault, capsys):
    """ANCHOR. Silence was the whole defect; the file must be named."""
    (vault / "quiet.md").write_bytes("# Quiet\n\n[[TARGET]]\n".encode("utf-16"))

    GB.build_indices(vault)
    GB.report_encoding_issues()

    err = capsys.readouterr().err
    assert "quiet.md" in err
    assert "utf-16" in err
    assert "not UTF-8" in err


def test_clean_vault_reports_nothing(vault, capsys):
    """GUARD. No findings must mean no output -- a report that always fires is noise."""
    (vault / "source.md").write_text("[[TARGET]]\n", encoding="utf-8")

    GB.build_indices(vault)
    GB.report_encoding_issues()

    assert capsys.readouterr().err == ""


def test_undecodable_file_is_skipped_and_reported(vault, capsys):
    """A file no codec accepts must not abort the run."""
    # Lone UTF-16 surrogate halves: rejected by utf-8 and by utf-16, and the
    # latin-1 fallback cannot fail, so this exercises the reported-but-read path.
    (vault / "binary.md").write_bytes(b"\x80\x81\x82\xfd\xfe\xff\x00")
    (vault / "source.md").write_text("[[TARGET]]\n", encoding="utf-8")

    forward, _, _ = GB.build_indices(vault)
    GB.report_encoding_issues()

    assert forward["source"] == ["TARGET"], "one bad file must not stop the walk"
    assert "binary.md" in capsys.readouterr().err


# --- validation: explain the skip instead of raising UnboundLocalError -----

def test_validate_skips_with_a_real_reason_when_vault_is_not_utf8(vault, capsys):
    """ANCHOR. Pre-fix obsidiantools raised UnboundLocalError from inside itself,
    naming a local variable and explaining nothing."""
    (vault / "source.md").write_bytes("[[TARGET]]\n".encode("utf-16"))

    _, backlinks, _ = GB.build_indices(vault)
    GB.validate_against_obsidiantools(vault, backlinks)

    err = capsys.readouterr().err
    assert "non-UTF-8" in err
    assert "Convert them to UTF-8" in err
    assert "UnboundLocalError" not in err


# --- end to end ------------------------------------------------------------

def test_cli_writes_the_edge_from_a_utf16_note(vault):
    """The whole point, through the real entry point."""
    (vault / "source.md").write_bytes(
        "# Source\n\n[[TARGET]]\n".encode("utf-16"))

    result = _run(vault)

    assert result.returncode == 0, result.stderr
    written = (vault / "_oracle" / "backlinks.md").read_text(encoding="utf-8")
    assert "source" in written, "the UTF-16 note's edge never reached the index"
    assert "source.md" in result.stderr, "and the owner was not told about it"
