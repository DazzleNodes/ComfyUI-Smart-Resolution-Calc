#!/usr/bin/env python3
"""Lint an Obsidian-style knowledge vault against docs/vault-spec.md.

Checks wikilink health (vault-spec section WL), orphan distribution,
manifest coverage, and MOC freshness. Fixes ONLY the provably-safe
class of broken links (vault-spec AUTH-3): a target that, after
mechanical normalization, resolves to exactly ONE existing file.
Everything else is reported, never touched.

Zero dependencies beyond the Python stdlib. Reuses the wikilink parser
from generate-backlinks.py (shipped alongside this file) so there is
exactly one parsing truth.

Usage:
    python vault-lint.py [vault]              # report (default; read-only)
    python vault-lint.py [vault] --check      # quiet; exit 1 on findings (CI/hooks)
    python vault-lint.py [vault] --fix        # apply safe fixes, then report the rest
    python vault-lint.py [vault] --fix --dry-run   # show what --fix would do
Exit codes: 0 clean, 1 findings, 2 usage/environment error.
"""

import argparse
import importlib.util
import re
import sys
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Windows consoles default to cp1252; vault content is UTF-8 and frequently
# non-ASCII. Reconfigure stdout/stderr up front so this tool never dies with
# UnicodeEncodeError the way its sibling script historically did.
# ---------------------------------------------------------------------------
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# ---------------------------------------------------------------------------
# Reuse the parser from generate-backlinks.py (same directory). One source of
# parsing truth: if the resolution model changes there, this tool follows.
# ---------------------------------------------------------------------------
_HERE = Path(__file__).resolve().parent


def _load_backlinks_module():
    src = _HERE / "generate-backlinks.py"
    if not src.is_file():
        sys.exit(f"Error: cannot find companion script {src} (ships alongside vault-lint.py)")
    spec = importlib.util.spec_from_file_location("generate_backlinks", src)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_GB = _load_backlinks_module()

# vault-spec section WL: link classes. TIMESTAMP-shaped pseudo-links are
# session timestamps someone bracketed, not documents.
TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$")

# Directories whose files are EXPECTED to be orphans (archives by nature);
# per vault-spec section LADDER usage guidance. An orphaned design doc is a
# map gap; an orphaned commit-message archive is normal.
EXPECTED_ORPHAN_DIRS = {
    "issues", "commits", "releases", "checklists", "drafts", "questions",
    "instructions", "thinking", "revisions", "baselines", "backups",
}

FENCE_RE = _GB.FENCE_RE


# ---------------------------------------------------------------------------
# Vault location (vault-spec LAYOUT-1/LAYOUT-3): link validation is only
# meaningful from the true vault root. Handed a project directory, DESCEND to
# its vault; handed something that is neither, REFUSE — linting a repo as if
# it were a vault reports valid links as broken and, worse, --fix from the
# wrong root would rewrite vault-internal links into project-rooted forms
# that are dead when read from the real vault. (Field-observed hazard.)
# ---------------------------------------------------------------------------

def _locate_vault(p: Path):
    if (p / "_maps").is_dir():
        return p                                  # a vault, L1+
    if p.name == "claude" and p.parent.name == "private":
        return p                                  # a vault, even at L0
    for cand in (p / "private" / "claude", p / "local" / "private" / "claude"):
        if cand.is_dir():
            print(f"note: {p} is a project directory; descending to its vault {cand}\n")
            return cand
    print(f"Error: {p} is not a vault and contains no private/claude/ — refusing "
          f"to lint a non-vault tree (valid vault-root links would report as broken).",
          file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

def vault_files(vault: Path):
    """All .md files, with their canonical vault-root-relative stems."""
    files = {}
    for p in sorted(vault.rglob("*.md")):
        rel = p.relative_to(vault).as_posix()
        files[rel[:-3]] = p  # strip .md -> canonical citable form (WL-1/WL-2)
    return files


def link_occurrences(vault: Path):
    """Yield (source_file, target, line_no) for every wikilink outside code."""
    for p in sorted(vault.rglob("*.md")):
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        in_fence = False
        for i, line in enumerate(text.splitlines(), 1):
            if FENCE_RE.match(line.strip()):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            scrubbed = _GB.INLINE_CODE_RE.sub("", line)
            for m in _GB.WIKILINK_RE.finditer(scrubbed):
                yield p, m.group(1).strip(), i


# ---------------------------------------------------------------------------
# Classification (vault-spec section WL)
# ---------------------------------------------------------------------------

def resolve(target: str, files: dict):
    """Resolve a target per the WL-1 model: vault-root path (exact key) OR
    bare filename (stem match). The explicit slash guard documents the model;
    mutation testing proved it behaviorally redundant (the basename
    comparison below can never match a slash-containing target anyway) --
    kept deliberately as the model made visible, not as load-bearing code."""
    t = target.strip()
    if t in files:
        return True
    if "/" in t:
        return False
    return any(k.rsplit("/", 1)[-1] == t for k in files)


def classify(target: str, files: dict):
    """Return a list of class tags for a broken target (empty if resolvable)."""
    if resolve(target, files):
        return []
    tags = []
    if target.startswith("../") or "/../" in target:
        tags.append("REL")            # WL-1
    if target.endswith(".md"):
        tags.append("MD")             # WL-2
    if target.startswith("#") or "#" in target:
        tags.append("ANCHOR")         # WL-3
    if target.endswith("\\"):
        tags.append("PIPE")           # WL-4 (table alias escape artifact)
    if TIMESTAMP_RE.match(target):
        tags.append("TIMESTAMP")      # pseudo-link; judgment, never auto-fix
    if not tags:
        tags.append("MISSING")        # target simply doesn't exist
    return tags


def normalize(target: str):
    """Mechanical normalization for the fixable classes (REL/MD/PIPE)."""
    t = target.strip().rstrip("\\")
    while t.startswith("../"):
        t = t[3:]
    if t.endswith(".md"):
        t = t[:-3]
    return t


def fix_candidates(target: str, files: dict):
    """Canonical targets the normalized form could mean. AUTH-3: fix only if
    this returns exactly one."""
    t = normalize(target)
    if t in files:
        return [t]
    base = t.rsplit("/", 1)[-1]
    return sorted(k for k in files if k.rsplit("/", 1)[-1] == base)


# ---------------------------------------------------------------------------
# Fixing (vault-spec AUTH-3: exactly-one resolution, else refuse)
# ---------------------------------------------------------------------------

def apply_fixes(vault: Path, files: dict, broken, dry_run: bool):
    """Rewrite fixable links in place. Returns (fixed, refused) lists."""
    fixed, refused = [], []
    by_file = {}
    for src, target, line_no, tags in broken:
        fixable_class = bool({"REL", "MD", "PIPE"} & set(tags)) and not (
            {"TIMESTAMP", "ANCHOR"} & set(tags))
        if not fixable_class:
            refused.append((src, target, tags, "class needs judgment"))
            continue
        cands = fix_candidates(target, files)
        if len(cands) != 1:
            reason = "ambiguous: " + ", ".join(cands[:4]) if cands else "no such file"
            refused.append((src, target, tags, reason))
            continue
        by_file.setdefault(src, []).append((target, cands[0], tags))

    for src, jobs in by_file.items():
        # newline="" on BOTH read and write: text-mode newline translation
        # otherwise rewrites every LF to CRLF on Windows (or, if suppressed
        # only on write, CRLF files to LF) -- touching every line of a file
        # whose fix changed one line. Found by real-file sweep; the unit
        # fixtures were blind to it because they were authored with the same
        # translating write. splitlines(keepends=True) preserves whatever
        # endings were actually read.
        with src.open("r", encoding="utf-8", errors="replace", newline="") as fh:
            text = fh.read()
        lines = text.splitlines(keepends=True)
        in_fence = False
        for idx, line in enumerate(lines):
            if FENCE_RE.match(line.strip()):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            for target, canon, tags in jobs:
                esc = re.escape(target)
                if "PIPE" in tags:
                    # WL-4: alias-free in tables — [[target\|alias]] -> [[canon]]
                    line = re.sub(r"\[\[" + esc + r"\|[^\]]*\]\]",
                                  "[[" + canon + "]]", line)
                line = re.sub(r"\[\[" + esc + r"(?=[\]|])", "[[" + canon, line)
            lines[idx] = line
        new_text = "".join(lines)
        if new_text != text:
            if not dry_run:
                with src.open("w", encoding="utf-8", newline="") as fh:
                    fh.write(new_text)
            for target, canon, tags in jobs:
                fixed.append((src, target, canon))
    return fixed, refused


# ---------------------------------------------------------------------------
# Additional report sections
# ---------------------------------------------------------------------------

def orphan_report(vault: Path, files: dict):
    """Files with no inbound links, split expected/unexpected by directory."""
    linked = set()
    for _src, target, _ln in link_occurrences(vault):
        for c in fix_candidates(target, files):
            linked.add(c)
        if target in files:
            linked.add(target)
    expected, unexpected = {}, []
    for key in files:
        if key in linked:
            continue
        top = key.split("/", 1)[0] if "/" in key else ""
        name = key.rsplit("/", 1)[-1]
        if top in EXPECTED_ORPHAN_DIRS or name.startswith(("MOC-", "backlinks", "manifest", "concepts", "OPEN-LOOPS")):
            expected[top or "(root)"] = expected.get(top or "(root)", 0) + 1
        else:
            unexpected.append(key)
    return expected, unexpected


def freshness(vault: Path):
    """MOC last_refreshed vs newest doc mtime (staleness is informational)."""
    maps = sorted((vault / "_maps").glob("*.md")) if (vault / "_maps").is_dir() else []
    newest = max((p.stat().st_mtime for p in vault.rglob("*.md")), default=None)
    out = []
    for moc in maps:
        m = re.search(r"last_refreshed:\s*(\d{4}-\d{2}-\d{2})", moc.read_text(encoding="utf-8", errors="replace"))
        if m and newest:
            behind = (datetime.fromtimestamp(newest).date()
                      - datetime.strptime(m.group(1), "%Y-%m-%d").date()).days
            out.append((moc.name, m.group(1), behind))
    return out


def manifest_coverage(vault: Path, files: dict):
    manifest = vault / "_oracle" / "manifest.md"
    if not manifest.is_file():
        return None
    text = manifest.read_text(encoding="utf-8", errors="replace")
    doc_keys = [k for k in files if not k.startswith(("_maps/", "_oracle/", "_todo/"))]
    missing = [k for k in doc_keys if k.rsplit("/", 1)[-1] not in text]
    return len(doc_keys), missing


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Lint a knowledge vault against vault-spec.md")
    ap.add_argument("vault", nargs="?", help="vault path (default: auto-detect from cwd)")
    ap.add_argument("--check", action="store_true", help="quiet mode; exit 1 on findings")
    ap.add_argument("--fix", action="store_true", help="apply AUTH-3-safe link fixes")
    ap.add_argument("--dry-run", action="store_true", help="with --fix: preview only")
    args = ap.parse_args()

    if args.dry_run and not args.fix:
        print("note: --dry-run only affects --fix; running plain report mode\n")

    vault = _locate_vault(Path(args.vault).resolve()) if args.vault else _GB.find_vault_root(Path.cwd())
    if not vault or not Path(vault).is_dir():
        sys.exit("Error: no vault found (expected private/claude/ or a path argument)")
    vault = Path(vault)

    files = vault_files(vault)
    broken = []
    for src, target, ln in link_occurrences(vault):
        tags = classify(target, files)
        if tags:
            broken.append((src, target, ln, tags))

    fixed, refused = [], [(s, t, tags, "not in --fix mode") for s, t, _l, tags in broken]
    if args.fix:
        fixed, refused = apply_fixes(vault, files, broken, args.dry_run)
        files = vault_files(vault)  # re-inventory (paths unchanged, but honest)

    expected_orphans, unexpected_orphans = orphan_report(vault, files)
    fresh = freshness(vault)
    cover = manifest_coverage(vault, files)

    findings = len(broken) - len(fixed)
    if args.check:
        print(f"vault-lint: {len(broken)} broken link(s), {len(unexpected_orphans)} unexpected orphan(s)")
        sys.exit(1 if (broken or unexpected_orphans) else 0)

    print(f"Vault: {vault}")
    print(f"Files: {len(files)}  |  Broken links: {len(broken)}"
          + (f"  |  Fixed: {len(fixed)}{' (dry-run)' if args.dry_run else ''}" if args.fix else ""))
    if broken:
        print("\nBroken links by class (vault-spec section WL):")
        for src, target, ln, tags in broken:
            mark = "FIXED " if any(f[1] == target and f[0] == src for f in fixed) else "      "
            print(f"  {mark}[{'+'.join(tags):9}] {src.relative_to(vault).as_posix()}:{ln}  [[{target}]]")
    if args.fix and refused:
        print("\nRefused (vault-spec AUTH-3 — report, never touch):")
        for src, target, tags, reason in refused:
            print(f"  [{'+'.join(tags):9}] [[{target}]] — {reason}")
    if unexpected_orphans:
        print(f"\nUnexpected orphans ({len(unexpected_orphans)}) — possible map gaps:")
        for k in unexpected_orphans[:20]:
            print(f"  {k}")
        if len(unexpected_orphans) > 20:
            print(f"  ... and {len(unexpected_orphans) - 20} more")
    if expected_orphans:
        total = sum(expected_orphans.values())
        print(f"\nExpected orphans (archives, {total}): "
              + ", ".join(f"{d}={n}" for d, n in sorted(expected_orphans.items())))
    for name, stamp, behind in fresh:
        note = f"content is {behind} day(s) newer than its last_refreshed" if behind > 0 else "current"
        print(f"\nFreshness: {name} last_refreshed {stamp} — {note}")
    if cover:
        n, missing = cover
        print(f"\nManifest coverage: {n - len(missing)}/{n} docs mentioned in _oracle/manifest.md"
              + (f"; missing: {', '.join(m.rsplit('/', 1)[-1] for m in missing[:5])}"
                 + (" ..." if len(missing) > 5 else "") if missing else ""))

    sys.exit(1 if findings or unexpected_orphans else 0)


if __name__ == "__main__":
    main()
