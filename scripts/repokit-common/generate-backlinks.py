#!/usr/bin/env python3
"""Generate a backlinks index for an Obsidian-style knowledge vault.

Scans all .md files in a vault directory, parses [[wikilinks]] and
[[wikilinks|aliases]], builds a reverse-link (backlinks) index, and
writes it to _oracle/backlinks.md.

Zero dependencies beyond Python stdlib. Optional networkx integration
for graph export (--graph flag).

Usage:
    python generate-backlinks.py                        # Auto-detect vault from cwd
    python generate-backlinks.py /path/to/vault         # Explicit vault path
    python generate-backlinks.py --json                 # JSON output to stdout
    python generate-backlinks.py --orphans              # List isolated notes
    python generate-backlinks.py --broken               # List broken wikilinks
    python generate-backlinks.py --stats                # Summary statistics
    python generate-backlinks.py --graph out.json       # NetworkX graph export (requires networkx)
    python generate-backlinks.py --dry-run              # Preview without writing
"""

import argparse
import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Wikilink regex: matches [[target]] and [[target|alias]]
# Does NOT match ![[embeds]] (those start with !)
# ---------------------------------------------------------------------------
WIKILINK_RE = re.compile(r'(?<!!)\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]')

# Fenced code block delimiters (``` or ~~~, with optional language tag)
FENCE_RE = re.compile(r'^(`{3,}|~{3,})')

# Byte-order marks for the encodings a vault realistically contains. Documents
# pasted out of Windows tools (PowerShell redirection, Notepad "Save as
# Unicode", some chat exports) land as UTF-16 with a BOM.
_BOMS = (
    (b'\xff\xfe\x00\x00', 'utf-32'),
    (b'\x00\x00\xfe\xff', 'utf-32'),
    (b'\xff\xfe', 'utf-16'),
    (b'\xfe\xff', 'utf-16'),
    (b'\xef\xbb\xbf', 'utf-8-sig'),
)

# Files that could not be decoded as text at all, reported once at the end.
_undecodable: list[Path] = []
# Files that decoded, but not as UTF-8. Their links ARE parsed; the vault owner
# is told so they can normalize (obsidiantools cannot read them -- see
# validate_against_obsidiantools).
_non_utf8: list[tuple[Path, str]] = []


def read_note_text(fpath: Path) -> str:
    """
    Read a note as text, honouring its byte-order mark.

    Previously this was ``read_text(encoding='utf-8', errors='ignore')``, which
    never raised and therefore looked safe -- but a UTF-16 document decoded that
    way becomes ``#\\x00 \\x00T\\x00i\\x00...``, so every ``[[wikilink]]`` in it
    silently fails to match and the note appears to have no links at all. A
    wrong graph with no error is worse than a crash, so encoding is now
    detected rather than assumed.
    """
    raw = fpath.read_bytes()

    for bom, encoding in _BOMS:
        if raw.startswith(bom):
            try:
                text = raw.decode(encoding)
                if encoding != 'utf-8-sig':
                    _non_utf8.append((fpath, encoding))
                return text
            except UnicodeDecodeError:
                break

    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        pass

    # No BOM and not valid UTF-8. Which family to try is decided by a NUL byte
    # rather than by trying each in turn: NUL is not a text character in any
    # single-byte codec, but a wide encoding emits one per ASCII character.
    #
    # The order matters more than it looks. Python's utf-16 codec accepts ANY
    # even-length byte string when there is no BOM (it assumes little-endian),
    # so trying it first turns a 24-byte cp1252 note into 12 characters of wide
    # garbage -- a silent wrong decode, which is the exact failure this function
    # exists to prevent, reintroduced one branch further down.
    candidates = ('utf-16', 'utf-32') if b'\x00' in raw else ('cp1252', 'latin-1')

    for encoding in candidates:
        try:
            text = raw.decode(encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
        _non_utf8.append((fpath, encoding))
        return text

    _undecodable.append(fpath)
    return ''


def report_encoding_issues() -> None:
    """Tell the vault owner about anything that was not plain UTF-8."""
    if _non_utf8:
        print(
            f'\nNote: {len(_non_utf8)} file(s) are not UTF-8. Their wikilinks WERE '
            'parsed, but obsidiantools cannot read them, so --validate will skip '
            'cross-validation. Convert them to UTF-8 to silence this:',
            file=sys.stderr,
        )
        for fpath, encoding in _non_utf8:
            print(f'  {fpath}  ({encoding})', file=sys.stderr)
    if _undecodable:
        print(
            f'\nWarning: {len(_undecodable)} file(s) could not be decoded as text '
            'and were skipped entirely:',
            file=sys.stderr,
        )
        for fpath in _undecodable:
            print(f'  {fpath}', file=sys.stderr)


def find_vault_root(start: Path) -> Path | None:
    """Walk upward from start looking for private/claude/ or _maps/."""
    current = start.resolve()
    # If we're already in or pointing at the vault
    if (current / '_maps').is_dir():
        return current
    if (current / 'private' / 'claude').is_dir():
        return current / 'private' / 'claude'
    # Walk up
    for parent in current.parents:
        candidate = parent / 'private' / 'claude'
        if candidate.is_dir():
            return candidate
    return None


INLINE_CODE_RE = re.compile(r'`[^`]+`')


def parse_wikilinks(text: str) -> list[str]:
    """Extract wikilink targets from markdown text, skipping fenced and inline code."""
    targets = []
    in_fence = False
    fence_marker = ''

    for line in text.splitlines():
        fence_match = FENCE_RE.match(line.strip())
        if fence_match:
            marker = fence_match.group(1)
            if not in_fence:
                in_fence = True
                fence_marker = marker[0]  # ` or ~
            elif line.strip().startswith(fence_marker):
                in_fence = False
                fence_marker = ''
            continue

        if in_fence:
            continue

        # Strip inline code spans before searching for wikilinks
        cleaned = INLINE_CODE_RE.sub('', line)

        for match in WIKILINK_RE.finditer(cleaned):
            targets.append(match.group(1).strip())

    return targets


def build_indices(vault_root: Path) -> tuple[dict, dict, dict]:
    """Build forward links, backlinks, and file index for the vault.

    Returns:
        (forward_links, backlinks, file_index)
        - forward_links: {stem: [target_stems]}
        - backlinks: {stem: [source_stems]}
        - file_index: {stem: Path}
    """
    file_index: dict[str, Path] = {}
    # Also map relative paths (e.g. "notes/bugs/filename") to stems
    # so path-prefixed wikilinks like [[notes/bugs/filename|alias]] resolve
    path_to_stem: dict[str, str] = {}
    # Skip _links/: navigation junctions to sibling vaults. rglob follows
    # junctions on Windows, so without this the sibling's notes are indexed
    # as phantom local notes -- and a link cycle never terminates.
    for f in sorted(p for p in vault_root.rglob('*.md') if '_links' not in p.parts):
        file_index[f.stem] = f
        # Register relative path variants (without .md extension)
        rel = f.relative_to(vault_root).with_suffix('')
        rel_posix = rel.as_posix()  # normalize to forward slashes
        path_to_stem[rel_posix] = f.stem
        # Also register with backslashes for Windows-authored links
        path_to_stem[str(rel).replace('\\', '/')] = f.stem

    def resolve_target(target: str) -> str | None:
        """Resolve a wikilink target to a file stem, supporting both
        stem-only ('filename') and path-prefixed ('notes/bugs/filename') formats."""
        # Direct stem match
        if target in file_index:
            return target
        # Path-prefixed match
        normalized = target.replace('\\', '/')
        if normalized in path_to_stem:
            return path_to_stem[normalized]
        return None

    forward: dict[str, list[str]] = {}
    for stem, fpath in file_index.items():
        text = read_note_text(fpath)
        raw_targets = parse_wikilinks(text)
        # Resolve each target to a stem (or keep raw for broken-link detection)
        resolved = []
        for t in raw_targets:
            r = resolve_target(t)
            resolved.append(r if r is not None else t)
        forward[stem] = resolved

    backlinks: dict[str, list[str]] = {stem: [] for stem in file_index}
    for source, targets in forward.items():
        seen = set()
        for target in targets:
            if target in backlinks and target not in seen:
                backlinks[target].append(source)
                seen.add(target)

    return forward, backlinks, file_index


def format_backlinks_md(backlinks: dict, file_index: dict) -> str:
    """Format the backlinks index as markdown for _oracle/backlinks.md."""
    lines = [
        '---',
        'type: oracle-metadata',
        'purpose: Reverse-link index -- which documents reference each document',
        f'generated-by: scripts/generate-backlinks.py',
        '---',
        '',
        '# Backlinks Index',
        '',
        'Auto-generated reverse-link index. For each document, lists all documents that',
        'reference it via `[[wikilinks]]`. Regenerate with:',
        '',
        '```bash',
        'python scripts/generate-backlinks.py',
        '```',
        '',
    ]

    # Sort by backlink count (most referenced first), then alphabetically
    sorted_notes = sorted(
        backlinks.items(),
        key=lambda x: (-len(x[1]), x[0])
    )

    # Stats header
    with_bl = sum(1 for v in backlinks.values() if v)
    total_entries = sum(len(v) for v in backlinks.values())
    lines.append(f'**{with_bl}** notes with backlinks, **{total_entries}** total references')
    lines.append('')

    # Only show notes that have backlinks
    for note, sources in sorted_notes:
        if not sources:
            continue
        lines.append(f'## {note}')
        lines.append('')
        for src in sorted(sources):
            lines.append(f'- `{src}`')
        lines.append('')

    return '\n'.join(lines)


def get_orphans(forward: dict, backlinks: dict) -> list[str]:
    """Find notes with no inbound or outbound wikilinks."""
    orphans = []
    for stem in sorted(forward.keys()):
        has_outbound = bool(forward.get(stem))
        has_inbound = bool(backlinks.get(stem))
        if not has_outbound and not has_inbound:
            orphans.append(stem)
    return orphans


def get_broken_links(forward: dict, file_index: dict) -> dict[str, list[str]]:
    """Find wikilinks that point to non-existent notes."""
    existing = set(file_index.keys())
    broken: dict[str, list[str]] = {}
    for source, targets in forward.items():
        for target in targets:
            if target not in existing:
                broken.setdefault(source, []).append(target)
    return broken


def validate_against_obsidiantools(vault_root: Path, our_backlinks: dict):
    """Cross-validate our backlinks against obsidiantools for redundancy."""
    try:
        import obsidiantools.api as otools
    except ImportError:
        print('Note: obsidiantools not installed, skipping cross-validation. '
              'Install with: pip install obsidiantools', file=sys.stderr)
        return

    # obsidiantools opens every note as UTF-8 unconditionally. On a
    # UnicodeDecodeError its _get_md_front_matter_and_content never binds
    # `file_string` and raises UnboundLocalError from inside the library --
    # an error that says nothing about the actual cause. Check first and
    # report the real reason.
    if _non_utf8:
        print(
            'Skipping obsidiantools cross-validation: the vault contains '
            f'{len(_non_utf8)} non-UTF-8 file(s), which the library cannot read. '
            'Convert them to UTF-8 to enable validation (see the note above).',
            file=sys.stderr,
        )
        return

    print('Running obsidiantools for cross-validation...')
    try:
        vault = otools.Vault(vault_root).connect()
    except UnboundLocalError:
        # The signature of the same bug, for a file whose encoding slipped past
        # the check above (no BOM, and coincidentally valid in a fallback).
        print(
            'obsidiantools failed to read a file in this vault (it decodes every '
            'note as UTF-8). Cross-validation skipped; the backlinks index above '
            'is still correct.',
            file=sys.stderr,
        )
        return
    except Exception as exc:  # noqa: BLE001 - validation must never be fatal
        print(f'obsidiantools cross-validation failed ({type(exc).__name__}: {exc}). '
              'The backlinks index above is still correct.', file=sys.stderr)
        return
    ot_backlinks = vault.backlinks_index

    # Normalize both to sets for comparison
    our_set: dict[str, set[str]] = {
        k: set(v) for k, v in our_backlinks.items() if v
    }
    ot_set: dict[str, set[str]] = {
        k: set(v) for k, v in ot_backlinks.items() if v
    }

    all_notes = sorted(set(our_set.keys()) | set(ot_set.keys()))

    only_ours = 0
    only_theirs = 0
    agree = 0

    for note in all_notes:
        ours = our_set.get(note, set())
        theirs = ot_set.get(note, set())
        diff_ours = ours - theirs
        diff_theirs = theirs - ours
        common = ours & theirs
        agree += len(common)

        if diff_ours:
            only_ours += len(diff_ours)
            for src in sorted(diff_ours):
                print(f'  [regex only]  {src} -> {note}')
        if diff_theirs:
            only_theirs += len(diff_theirs)
            for src in sorted(diff_theirs):
                print(f'  [obstools only]  {src} -> {note}')

    total_ours = sum(len(v) for v in our_set.values())
    total_theirs = sum(len(v) for v in ot_set.values())
    print(f'\nValidation summary:')
    print(f'  Regex parser:      {total_ours} backlink edges')
    print(f'  obsidiantools:     {total_theirs} backlink edges')
    print(f'  Agree:             {agree}')
    print(f'  Regex-only:        {only_ours} (typically YAML frontmatter wikilinks)')
    print(f'  obsidiantools-only: {only_theirs}')


def export_graph(forward: dict, output_path: str):
    """Export the link graph as JSON using networkx (optional dependency)."""
    try:
        import networkx as nx
    except ImportError:
        print('Error: networkx is required for --graph. Install with: pip install networkx',
              file=sys.stderr)
        sys.exit(1)

    G = nx.DiGraph()
    for source, targets in forward.items():
        G.add_node(source)
        for target in targets:
            G.add_edge(source, target)

    data = nx.node_link_data(G, edges='links')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    print(f'Graph exported: {len(G.nodes)} nodes, {len(G.edges)} edges -> {output_path}')


def main():
    parser = argparse.ArgumentParser(
        description='Generate backlinks index for an Obsidian-style knowledge vault.'
    )
    parser.add_argument('vault_path', nargs='?', default='.',
                        help='Path to vault root (default: auto-detect from cwd)')
    parser.add_argument('--json', action='store_true',
                        help='Output backlinks as JSON to stdout')
    parser.add_argument('--orphans', action='store_true',
                        help='List isolated notes (no links in or out)')
    parser.add_argument('--broken', action='store_true',
                        help='List broken wikilinks (target does not exist)')
    parser.add_argument('--stats', action='store_true',
                        help='Print summary statistics')
    parser.add_argument('--graph', metavar='FILE',
                        help='Export link graph as JSON (requires networkx)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview output without writing _oracle/backlinks.md')
    parser.add_argument('--output', metavar='FILE',
                        help='Write backlinks to a custom path instead of _oracle/backlinks.md')
    parser.add_argument('--validate', action='store_true',
                        help='Cross-validate against obsidiantools (requires pip install obsidiantools)')

    args = parser.parse_args()

    # Find vault root
    start = Path(args.vault_path).resolve()
    vault_root = find_vault_root(start)
    if vault_root is None:
        # Fall back to the given path directly
        vault_root = start
        if not any(p for p in vault_root.rglob('*.md') if '_links' not in p.parts):
            print(f'Error: No .md files found in {vault_root}', file=sys.stderr)
            sys.exit(1)

    # Build indices
    forward, backlinks, file_index = build_indices(vault_root)

    # Cross-validation (runs after normal output, not instead of it)
    run_validation = args.validate

    # Handle action flags
    if args.json:
        # Output backlinks as JSON
        output = {
            note: sorted(set(sources))
            for note, sources in backlinks.items()
            if sources
        }
        json.dump(output, sys.stdout, indent=2)
        print()
        return

    if args.orphans:
        orphans = get_orphans(forward, backlinks)
        print(f'Isolated notes ({len(orphans)}):')
        for o in orphans:
            print(f'  - {o}')
        return

    if args.broken:
        broken = get_broken_links(forward, file_index)
        if not broken:
            print('No broken wikilinks found.')
        else:
            total = sum(len(v) for v in broken.values())
            print(f'Broken wikilinks ({total}):')
            for source, targets in sorted(broken.items()):
                for t in targets:
                    print(f'  {source} -> [[{t}]] (not found)')
        return

    if args.graph:
        export_graph(forward, args.graph)
        return

    if args.stats:
        with_bl = sum(1 for v in backlinks.values() if v)
        total_bl = sum(len(v) for v in backlinks.values())
        total_fl = sum(len(v) for v in forward.values())
        orphans = get_orphans(forward, backlinks)
        broken = get_broken_links(forward, file_index)
        broken_count = sum(len(v) for v in broken.values())

        print(f'Vault: {vault_root}')
        print(f'Total .md files: {len(file_index)}')
        print(f'Forward link edges: {total_fl}')
        print(f'Notes with backlinks: {with_bl}')
        print(f'Total backlink edges: {total_bl}')
        print(f'Isolated notes: {len(orphans)}')
        print(f'Broken wikilinks: {broken_count}')

        # Top referenced
        sorted_bl = sorted(backlinks.items(), key=lambda x: -len(x[1]))[:5]
        print('\nTop 5 most referenced:')
        for name, sources in sorted_bl:
            print(f'  {len(sources):3d} <- {name}')

        if run_validation:
            print()
            validate_against_obsidiantools(vault_root, backlinks)
        return

    # Default: generate _oracle/backlinks.md
    md_content = format_backlinks_md(backlinks, file_index)

    if args.dry_run:
        print(md_content)
        return

    # Determine output path
    if args.output:
        out_path = Path(args.output)
    else:
        oracle_dir = vault_root / '_oracle'
        oracle_dir.mkdir(exist_ok=True)
        out_path = oracle_dir / 'backlinks.md'

    out_path.write_text(md_content, encoding='utf-8')

    # Print summary
    with_bl = sum(1 for v in backlinks.values() if v)
    total_bl = sum(len(v) for v in backlinks.values())
    print(f'Wrote {out_path}')
    print(f'  {len(file_index)} files scanned, {with_bl} notes with backlinks, {total_bl} link edges')

    report_encoding_issues()

    if run_validation:
        print()
        validate_against_obsidiantools(vault_root, backlinks)


if __name__ == '__main__':
    main()
