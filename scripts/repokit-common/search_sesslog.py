#!/usr/bin/env python3
"""Search Claude Code session logs (transcript.jsonl) for commands, code, or text.

Extracts matching content from deeply nested JSON structures in session
transcripts. Useful for finding how something was done in a previous session
when you need to relocate a command, code snippet, or decision.

Usage:
    python search_sesslog.py <sesslog_path> <search_term> [--context N]
    python search_sesslog.py <sesslog_path> <term1> <term2>  # AND search
    python search_sesslog.py <sesslog_path> <search_term> --type bash
    python search_sesslog.py <sesslog_path> <search_term> --around 5

Examples:
    # Find gifsicle commands
    python search_sesslog.py transcript.jsonl gifsicle --type bash

    # Find lines mentioning both "lossy" and "demo"
    python search_sesslog.py transcript.jsonl lossy demo

    # Find pip install commands with surrounding context
    python search_sesslog.py transcript.jsonl "pip install" --context 3

    # Search a full sesslog directory (auto-finds transcript.jsonl)
    python search_sesslog.py C:\\Users\\Me\\.claude\\sesslogs\\MySession lossy

Notes:
    Install https://github.com/DazzleML/claude-session-logger
    Session logs live in: ~/.claude/sesslogs/<session_name>/transcript.jsonl
    Each line is a JSON object with varying structure (user messages, assistant
    responses, tool calls, tool results). This script recursively searches all
    string values in each JSON object.
"""

import argparse
import json
import re
import sys
from pathlib import Path


def extract_strings(obj, depth=0, max_depth=6):
    """Recursively extract all string values from a JSON object."""
    if depth > max_depth:
        return
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from extract_strings(v, depth + 1, max_depth)
    elif isinstance(obj, list):
        for v in obj:
            yield from extract_strings(v, depth + 1, max_depth)


def find_context(text, term, context_chars=150):
    """Find all occurrences of term in text and return surrounding context."""
    results = []
    lower_text = text.lower()
    lower_term = term.lower()
    start = 0
    while True:
        idx = lower_text.find(lower_term, start)
        if idx == -1:
            break
        # Extract context window
        begin = max(0, idx - context_chars)
        end = min(len(text), idx + len(term) + context_chars)
        snippet = text[begin:end]
        # Clean up: trim to nearest newline boundaries if possible
        if begin > 0:
            nl = snippet.find("\n")
            if nl != -1 and nl < context_chars:
                snippet = snippet[nl + 1 :]
        if end < len(text):
            nl = snippet.rfind("\n")
            if nl != -1 and nl > len(snippet) - context_chars:
                snippet = snippet[:nl]
        results.append(snippet.strip())
        start = idx + 1
    return results


def search_transcript(path, terms, context_chars=150, type_filter=None):
    """Search a transcript.jsonl file for lines containing all search terms."""
    matches = []
    with open(path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Optional: filter by message type (bash, user, assistant, etc.)
            msg_type = obj.get("type", "")
            if type_filter:
                # Check type field and also tool names in content
                type_match = type_filter.lower() in str(msg_type).lower()
                raw_lower = line.lower()
                if not type_match and type_filter.lower() not in raw_lower:
                    continue

            # Collect all string content from this JSON object
            all_text = "\n".join(extract_strings(obj))
            lower_all = all_text.lower()

            # Check if ALL search terms are present
            if all(t.lower() in lower_all for t in terms):
                # Extract context snippets for the primary (first) term
                snippets = find_context(all_text, terms[0], context_chars)
                if snippets:
                    matches.append(
                        {
                            "line": line_num,
                            "type": msg_type,
                            "snippets": snippets,
                        }
                    )
    return matches


def main():
    parser = argparse.ArgumentParser(
        description="Search Claude Code session logs for commands and text.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Session logs: ~/.claude/sesslogs/<session>/transcript.jsonl",
    )
    parser.add_argument(
        "path",
        help="Path to transcript.jsonl or its parent directory",
    )
    parser.add_argument(
        "terms",
        nargs="+",
        help="Search terms (all must match). Use quotes for phrases.",
    )
    parser.add_argument(
        "--context",
        "-c",
        type=int,
        default=150,
        help="Characters of context around each match (default: 150)",
    )
    parser.add_argument(
        "--type",
        "-t",
        dest="type_filter",
        help="Filter by message type (e.g., bash, user, assistant)",
    )
    parser.add_argument(
        "--max",
        "-m",
        type=int,
        default=0,
        help="Maximum number of matches to show (0 = unlimited)",
    )
    args = parser.parse_args()

    # Resolve path -- accept directory or file
    path = Path(args.path)
    if path.is_dir():
        path = path / "transcript.jsonl"
    if not path.exists():
        print(f"Error: {path} not found", file=sys.stderr)
        sys.exit(1)

    matches = search_transcript(path, args.terms, args.context, args.type_filter)

    if not matches:
        print(f"No matches for: {' AND '.join(args.terms)}")
        sys.exit(0)

    print(f"Found {len(matches)} matching lines for: {' AND '.join(args.terms)}")
    print("=" * 72)

    shown = 0
    for m in matches:
        if args.max and shown >= args.max:
            remaining = len(matches) - shown
            print(f"\n... {remaining} more matches (use --max to see more)")
            break
        print(f"\nL{m['line']} [{m['type']}]:")
        for snippet in m["snippets"]:
            print(f"  {snippet}")
        print("-" * 72)
        shown += 1


if __name__ == "__main__":
    main()
