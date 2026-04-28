"""One-off transformer: gate [INVEST] diagnostic logging behind INVEST_ENABLED flag.

Rewrites py/smart_resolution_calc.py:

1. Adds INVEST_ENABLED env-var flag and _invest() helper near the logger config.
2. Wraps each `# >>> [INVEST] ... # <<< [INVEST]` block with `if INVEST_ENABLED:`.
3. Replaces standalone `print(f"[INVEST] ...")` lines with `_invest(f"...")`.
4. Fixes em-dash to `--` in any runtime [INVEST] print strings.

Idempotent guard: bails out if INVEST_ENABLED is already defined in the file.

Usage: from repo root
    python tests/one-offs/gate_invest_logging.py
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "py" / "smart_resolution_calc.py"


def transform(text: str) -> str:
    if "INVEST_ENABLED" in text:
        print("INVEST_ENABLED already present -- aborting (idempotent).")
        sys.exit(1)

    lines = text.splitlines(keepends=True)

    # Step 1: insert INVEST_ENABLED flag + _invest() helper after the existing
    # logger handler block. We anchor on the comment "# Always log when module is loaded".
    insert_idx = None
    for i, ln in enumerate(lines):
        if ln.strip().startswith("# Always log when module is loaded"):
            insert_idx = i
            break
    assert insert_idx is not None, "Could not find logger setup anchor"

    flag_block = (
        "# [INVEST] diagnostic logging -- gated behind a separate flag so it can\n"
        "# be enabled independently of general DEBUG-level logs. The blocks\n"
        '# below wrap data-gathering as well as printing, so when disabled there\n'
        "# is zero overhead (no tensor .sum().item() syncs, etc.).\n"
        "INVEST_ENABLED = os.getenv('COMFY_INVEST_SMART_RES_CALC', 'false').lower() == 'true'\n"
        "\n"
        "def _invest(msg: str) -> None:\n"
        '    """Emit an [INVEST] diagnostic line when COMFY_INVEST_SMART_RES_CALC=true."""\n'
        "    if INVEST_ENABLED:\n"
        '        print(f"[INVEST] {msg}")\n'
        "\n"
    )
    lines.insert(insert_idx, flag_block)

    # Step 2: wrap each `# >>> [INVEST] ... # <<< [INVEST]` block in `if INVEST_ENABLED:`
    out = []
    i = 0
    block_count = 0
    while i < len(lines):
        ln = lines[i]
        m = re.match(r"^(\s*)# >>> \[INVEST\]", ln)
        if m:
            indent = m.group(1)
            # Find matching closer
            j = i + 1
            while j < len(lines):
                if "# <<< [INVEST]" in lines[j]:
                    break
                j += 1
            assert j < len(lines), f"Unmatched # >>> [INVEST] at line {i+1}"

            # Emit `if INVEST_ENABLED:` at original indent, then re-indent block contents
            out.append(f"{indent}if INVEST_ENABLED:\n")
            out.append(f"{indent}    # >>> [INVEST] dimensions-only image-leak diagnostic 2026-04-28\n")
            for k in range(i + 1, j):
                inner = lines[k]
                # Add 4 more spaces of indent to non-empty lines; preserve blank lines
                if inner.strip() == "":
                    out.append(inner)
                else:
                    out.append("    " + inner)
            out.append(f"{indent}    # <<< [INVEST]\n")

            block_count += 1
            i = j + 1
            continue

        # Step 3: standalone `print(f"[INVEST] ...")` -> `_invest(f"...")`
        # Match outside-block prints; we know we're outside because the block
        # branch above consumes block content.
        std_match = re.match(r'^(\s*)print\(f"\[INVEST\] (.*)\)\s*$', ln.rstrip("\n"))
        if std_match:
            indent = std_match.group(1)
            payload = std_match.group(2)
            # Strip trailing closing-paren+quote if present (we matched ".*" greedy then "\)")
            # payload still ends with `"` (the closing quote of the f-string).
            # Replace any em-dash in payload
            payload = payload.replace("—", "--")
            out.append(f'{indent}_invest(f"{payload})\n')
            i += 1
            continue

        out.append(ln)
        i += 1

    print(f"Wrapped {block_count} INVEST blocks.")
    return "".join(out)


def main() -> int:
    text = SRC.read_text(encoding="utf-8")
    new_text = transform(text)
    SRC.write_text(new_text, encoding="utf-8")
    print(f"Wrote {SRC}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
