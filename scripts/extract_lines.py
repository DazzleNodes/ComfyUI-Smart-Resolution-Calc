#!/usr/bin/env python3
"""
Extract a range of lines from a source file into a new file.

Usage:
    python scripts/extract_lines.py <source> <start> <end> <dest> [--header FILE] [--replace TEXT] [--dry-run]

Arguments:
    source      Source file to extract from
    start       Start line number (1-indexed, inclusive)
    end         End line number (1-indexed, inclusive)
    dest        Destination file to write extracted lines to

Options:
    --header FILE       Prepend contents of FILE before extracted lines
    --header-text TEXT  Prepend TEXT (with \\n for newlines) before extracted lines
    --replace TEXT      Replace extracted lines in source with TEXT (with \\n for newlines)
    --no-remove         Don't modify the source file (copy only, don't extract)
    --dry-run           Show what would happen without writing files

Examples:
    # Extract lines 240-838 to a new file, replace in source with a comment
    python scripts/extract_lines.py py/source.py 240 838 py/dest.py \\
        --header-text "import logging\\nfrom math import gcd\\n" \\
        --replace "# Extracted to dest.py\\nfrom .dest import MyClass\\n"

    # Just copy lines without modifying source
    python scripts/extract_lines.py py/source.py 100 200 py/snippet.py --no-remove

    # Preview what would happen
    python scripts/extract_lines.py py/source.py 240 838 py/dest.py --dry-run
"""

import argparse
import sys
import os


def main():
    parser = argparse.ArgumentParser(description="Extract line range from file to new file")
    parser.add_argument("source", help="Source file path")
    parser.add_argument("start", type=int, help="Start line (1-indexed, inclusive)")
    parser.add_argument("end", type=int, help="End line (1-indexed, inclusive)")
    parser.add_argument("dest", help="Destination file path")
    parser.add_argument("--header", help="File whose contents to prepend to dest")
    parser.add_argument("--header-text", help="Text to prepend to dest (use \\n for newlines)")
    parser.add_argument("--replace", help="Text to replace extracted lines in source (use \\n for newlines)")
    parser.add_argument("--no-remove", action="store_true", help="Don't modify source (copy only)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")

    args = parser.parse_args()

    # Read source
    with open(args.source, "r", encoding="utf-8") as f:
        lines = f.readlines()

    total = len(lines)
    start_idx = args.start - 1  # Convert to 0-indexed
    end_idx = args.end          # end is inclusive, so slice to end_idx

    if start_idx < 0 or end_idx > total:
        print(f"Error: line range {args.start}-{args.end} out of bounds (file has {total} lines)")
        sys.exit(1)

    extracted = lines[start_idx:end_idx]
    extract_count = len(extracted)

    # Build destination content
    dest_parts = []
    if args.header:
        with open(args.header, "r", encoding="utf-8") as f:
            dest_parts.append(f.read())
    if args.header_text:
        dest_parts.append(args.header_text.replace("\\n", "\n"))
    dest_parts.append("".join(extracted))
    dest_content = "".join(dest_parts)

    # Build replacement for source
    if args.replace:
        replacement_lines = [line + "\n" if not line.endswith("\n") else line
                           for line in args.replace.replace("\\n", "\n").split("\n")
                           if line or True]
        # Fix: split adds empty string at end if text ends with \n
        replacement_text = args.replace.replace("\\n", "\n")
        replacement_lines = replacement_text.splitlines(keepends=True)
        if replacement_text.endswith("\n") and not replacement_lines[-1].endswith("\n"):
            replacement_lines[-1] += "\n"
    else:
        replacement_lines = []

    # Report
    print(f"Source: {args.source} ({total} lines)")
    print(f"Extracting lines {args.start}-{args.end} ({extract_count} lines)")
    print(f"Destination: {args.dest}")
    if args.header:
        print(f"Header file: {args.header}")
    if args.header_text:
        header_preview = args.header_text[:80].replace("\\n", " | ")
        print(f"Header text: {header_preview}...")
    if args.replace and not args.no_remove:
        print(f"Replacement: {len(replacement_lines)} lines in source")
    if args.no_remove:
        print("Mode: copy only (source unchanged)")

    if args.dry_run:
        print("\n[DRY RUN] No files written.")
        print(f"  Would write {len(dest_content)} chars to {args.dest}")
        if not args.no_remove:
            new_total = total - extract_count + len(replacement_lines)
            print(f"  Would modify {args.source}: {total} -> {new_total} lines")
        return

    # Write destination
    os.makedirs(os.path.dirname(args.dest) or ".", exist_ok=True)
    with open(args.dest, "w", encoding="utf-8", newline="\n") as f:
        f.write(dest_content)
    print(f"Wrote {args.dest} ({len(dest_content.splitlines())} lines)")

    # Modify source (unless --no-remove)
    if not args.no_remove:
        new_lines = lines[:start_idx] + replacement_lines + lines[end_idx:]
        with open(args.source, "w", encoding="utf-8", newline="\n") as f:
            f.writelines(new_lines)
        print(f"Updated {args.source}: {total} -> {len(new_lines)} lines ({extract_count} removed, {len(replacement_lines)} added)")


if __name__ == "__main__":
    main()
