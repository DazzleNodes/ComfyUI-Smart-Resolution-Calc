#!/usr/bin/env python3
"""Extract MCP tool results from Claude Code session logs.

Searches transcript.jsonl AND compaction files for tool_result entries,
which may be lost from the main transcript during context compaction.
Useful for recovering AI consultation responses, large tool outputs,
or any tool_result that was processed but not persisted.

Usage:
    python extract_tool_result.py <session_path> <tool_use_id>
    python extract_tool_result.py <session_path> <tool_use_id> --save output.md
    python extract_tool_result.py <session_path> --tool-name mcp__zen__chat --list
    python extract_tool_result.py <session_path> --tool-name mcp__zen__chat --last

Examples:
    # Extract a specific tool result by ID
    python extract_tool_result.py transcript.jsonl toolu_01LNFTPgE28xzcdK3WoKsgYV

    # List all mcp__zen__chat calls in a session
    python extract_tool_result.py transcript.jsonl --tool-name mcp__zen__chat --list

    # Extract the last mcp__zen__chat result and save to file
    python extract_tool_result.py transcript.jsonl --tool-name mcp__zen__chat --last --save response.md

    # Search compaction files too (auto-detected from session dir)
    python extract_tool_result.py C:\\Users\\Me\\.claude\\projects\\proj\\session-id.jsonl toolu_abc123

Notes:
    Session logs: ~/.claude/projects/<project>/<session-id>.jsonl
    Compaction files: ~/.claude/projects/<project>/<session-id>/subagents/agent-acompact-*.jsonl
    Tool results may only exist in compaction files if context was compressed
    before the result could be persisted to the main transcript.
"""

import argparse
import json
import sys
from pathlib import Path


def _extract_text_content(content):
    """Extract text from tool_result content (string or list of content blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return str(content)


def _parse_mcp_json(text):
    """Try to parse MCP response JSON and extract content + metadata."""
    try:
        data = json.loads(text)
        if isinstance(data, dict) and "content" in data:
            return {
                "content": data["content"],
                "status": data.get("status", ""),
                "metadata": data.get("metadata", {}),
                "continuation_id": (
                    data.get("continuation_offer", {}).get("continuation_id", "")
                    or data.get("continuation_id", "")
                ),
                "raw": data,
            }
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def find_tool_calls(jsonl_path, tool_name=None, tool_use_id=None):
    """Find tool_use entries in a JSONL file."""
    results = []
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            msg = obj.get("message", {})
            content = msg.get("content", [])
            if not isinstance(content, list):
                continue

            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") != "tool_use":
                    continue

                block_name = block.get("name", "")
                block_id = block.get("id", "")

                if tool_use_id and block_id != tool_use_id:
                    continue
                if tool_name and block_name != tool_name:
                    continue

                # Extract the prompt/input
                inp = block.get("input", {})
                prompt = inp.get("prompt", inp.get("message", ""))
                if isinstance(prompt, dict):
                    prompt = json.dumps(prompt, indent=2)

                results.append(
                    {
                        "line": line_num,
                        "file": str(jsonl_path),
                        "tool_use_id": block_id,
                        "tool_name": block_name,
                        "prompt_preview": (
                            str(prompt)[:200] if prompt else "(no prompt)"
                        ),
                        "prompt_full": prompt,
                        "input": inp,
                    }
                )
    return results


def find_tool_result(jsonl_path, tool_use_id):
    """Find a tool_result entry by tool_use_id in a JSONL file."""
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f):
            if tool_use_id not in line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            msg = obj.get("message", {})
            content = msg.get("content", [])
            if not isinstance(content, list):
                continue

            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") != "tool_result":
                    continue
                if block.get("tool_use_id") != tool_use_id:
                    continue

                raw_content = block.get("content", "")
                text = _extract_text_content(raw_content)
                return {
                    "line": line_num,
                    "file": str(jsonl_path),
                    "tool_use_id": tool_use_id,
                    "text": text,
                    "parsed": _parse_mcp_json(text),
                }
    return None


def find_compaction_files(jsonl_path):
    """Find compaction JSONL files associated with a session."""
    path = Path(jsonl_path)
    # Session ID is the stem of the JSONL file
    session_id = path.stem
    session_dir = path.parent / session_id
    subagents_dir = session_dir / "subagents"

    compaction_files = []
    if subagents_dir.exists():
        for f in sorted(subagents_dir.glob("agent-acompact-*.jsonl")):
            compaction_files.append(f)
    return compaction_files


def extract_result(jsonl_path, tool_use_id):
    """Search main transcript and compaction files for a tool_result."""
    # Try main transcript first
    result = find_tool_result(jsonl_path, tool_use_id)
    if result:
        result["source"] = "transcript"
        return result

    # Try compaction files
    for compact_file in find_compaction_files(jsonl_path):
        result = find_tool_result(compact_file, tool_use_id)
        if result:
            result["source"] = "compaction"
            return result

    return None


def main():
    parser = argparse.ArgumentParser(
        description="Extract MCP tool results from Claude Code session logs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Session logs: ~/.claude/projects/<project>/<session-id>.jsonl\n"
            "Also searches compaction files in <session-id>/subagents/"
        ),
    )
    parser.add_argument(
        "path",
        help="Path to transcript.jsonl or session JSONL file",
    )
    parser.add_argument(
        "tool_use_id",
        nargs="?",
        help="The tool_use_id to extract (e.g., toolu_01ABC...)",
    )
    parser.add_argument(
        "--tool-name",
        help="Filter by tool name (e.g., mcp__zen__chat)",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List matching tool calls instead of extracting results",
    )
    parser.add_argument(
        "--last",
        action="store_true",
        help="Extract the last matching tool result (use with --tool-name)",
    )
    parser.add_argument(
        "--save",
        metavar="FILE",
        help="Save extracted content to a file",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Output raw content without parsing MCP JSON",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="output_json",
        help="Output as JSON",
    )
    args = parser.parse_args()

    # Resolve path
    path = Path(args.path)
    if path.is_dir():
        # Try to find transcript.jsonl
        candidates = list(path.glob("*.jsonl"))
        if not candidates:
            path = path / "transcript.jsonl"
        elif len(candidates) == 1:
            path = candidates[0]
        else:
            print(f"Multiple JSONL files in {path}. Specify one.", file=sys.stderr)
            sys.exit(1)

    if not path.exists():
        print(f"Error: {path} not found", file=sys.stderr)
        sys.exit(1)

    # List mode
    if args.list:
        if not args.tool_name and not args.tool_use_id:
            print("Error: --list requires --tool-name or a tool_use_id", file=sys.stderr)
            sys.exit(1)

        all_calls = find_tool_calls(path, tool_name=args.tool_name, tool_use_id=args.tool_use_id)

        # Also search compaction files
        for compact_file in find_compaction_files(path):
            all_calls.extend(
                find_tool_calls(compact_file, tool_name=args.tool_name, tool_use_id=args.tool_use_id)
            )

        if not all_calls:
            print("No matching tool calls found.")
            sys.exit(0)

        print(f"Found {len(all_calls)} tool call(s):")
        print("=" * 72)
        for i, call in enumerate(all_calls, 1):
            source = Path(call["file"]).name
            print(f"\n  [{i}] {call['tool_name']}")
            print(f"      ID:     {call['tool_use_id']}")
            print(f"      Line:   {call['line']} in {source}")
            print(f"      Prompt: {call['prompt_preview']}")
        print()
        sys.exit(0)

    # Determine tool_use_id
    target_id = args.tool_use_id

    if not target_id and args.tool_name and args.last:
        # Find the last call with this tool name
        all_calls = find_tool_calls(path, tool_name=args.tool_name)
        for compact_file in find_compaction_files(path):
            all_calls.extend(find_tool_calls(compact_file, tool_name=args.tool_name))
        if not all_calls:
            print(f"No {args.tool_name} calls found.", file=sys.stderr)
            sys.exit(1)
        target_id = all_calls[-1]["tool_use_id"]
        print(f"Using last {args.tool_name} call: {target_id}", file=sys.stderr)

    if not target_id:
        print("Error: provide a tool_use_id or use --tool-name with --last", file=sys.stderr)
        sys.exit(1)

    # Extract the result
    result = extract_result(path, target_id)

    if not result:
        print(f"No tool_result found for {target_id}", file=sys.stderr)
        print("Searched: main transcript + compaction files", file=sys.stderr)
        sys.exit(1)

    # Output
    source_label = f"{result['source']} ({Path(result['file']).name})"
    print(f"Found in: {source_label}, line {result['line']}", file=sys.stderr)

    if args.output_json:
        output = json.dumps(result, indent=2, ensure_ascii=False)
        if args.save:
            Path(args.save).write_text(output, encoding="utf-8")
            print(f"Saved JSON to: {args.save}", file=sys.stderr)
        else:
            print(output)
        sys.exit(0)

    # Determine display content
    parsed = result.get("parsed")
    if parsed and not args.raw:
        display_content = parsed["content"]
        meta = parsed.get("metadata", {})
        cid = parsed.get("continuation_id", "")

        if meta:
            print(f"Model: {meta.get('model_used', 'unknown')}", file=sys.stderr)
            print(f"Provider: {meta.get('provider_used', 'unknown')}", file=sys.stderr)
        if cid:
            print(f"Continuation ID: {cid}", file=sys.stderr)
        print("---", file=sys.stderr)
    else:
        display_content = result["text"]

    if args.save:
        Path(args.save).write_text(display_content, encoding="utf-8")
        print(f"Saved {len(display_content)} chars to: {args.save}", file=sys.stderr)
    else:
        print(display_content)


if __name__ == "__main__":
    main()
