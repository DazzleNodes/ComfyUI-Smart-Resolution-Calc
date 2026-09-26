#!/usr/bin/env python3
"""Build the project demo GIF from the VHS tape.

Runs VHS to record the demo tape, then post-processes with gifsicle
for optimization and loop control.

Usage:
    python scripts/build_demo.py                    # Full pipeline
    python scripts/build_demo.py --postprocess-only # Just gifsicle on existing GIF
    python scripts/build_demo.py --tape scripts/vhs/demo.tape  # Custom tape

Environment variables (override auto-detection):
    VHS_BIN      Path to vhs executable
    TTYD_BIN     Path to ttyd executable (directory added to PATH)
    GIFSICLE_BIN Path to gifsicle executable

The script auto-detects binaries in common locations. If your setup
differs, set the environment variables above.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path


# -- Configuration --

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_TAPE = PROJECT_ROOT / "scripts" / "demo" / "vhs" / "demo.tape"
DEFAULT_OUTPUT = PROJECT_ROOT / "docs" / "demo.gif"

# Common binary locations (checked in order)
VHS_SEARCH_PATHS = [
    Path(r"C:\code-ext\vhs-fork\vhs.exe"),
    Path(r"C:\code-ext\vhs-windows-fixes\vhs.exe"),
]
TTYD_SEARCH_PATHS = [
    Path(r"C:\code-ext\ttyd-fork\build\Release"),
    Path(r"C:\code-ext\ttyd-msvc\build\Release"),
]


def find_binary(name, env_var, search_paths, is_dir=False):
    """Locate a binary by env var, then search paths, then system PATH."""
    # 1. Environment variable override
    env_val = os.environ.get(env_var)
    if env_val:
        p = Path(env_val)
        if p.exists():
            return p
        print(f"  Warning: {env_var}={env_val} not found, searching...")

    # 2. Known locations
    for p in search_paths:
        if is_dir and p.is_dir():
            return p
        elif not is_dir and p.is_file():
            return p

    # 3. System PATH
    if not is_dir:
        found = shutil.which(name)
        if found:
            return Path(found)

    return None


def find_gifsicle():
    """Locate gifsicle binary."""
    env_val = os.environ.get("GIFSICLE_BIN")
    if env_val and Path(env_val).is_file():
        return Path(env_val)
    found = shutil.which("gifsicle")
    if found:
        return Path(found)
    return None


def run_vhs(vhs_bin, ttyd_dir, tape, cwd):
    """Run VHS to record the tape."""
    env = os.environ.copy()
    # Prepend ttyd directory to PATH so VHS can find ttyd.exe + DLLs
    if ttyd_dir:
        env["PATH"] = str(ttyd_dir) + os.pathsep + env.get("PATH", "")

    print(f"  VHS:  {vhs_bin}")
    print(f"  ttyd: {ttyd_dir}")
    print(f"  Tape: {tape}")
    print()

    result = subprocess.run(
        [str(vhs_bin), str(tape)],
        cwd=str(cwd),
        env=env,
    )
    return result.returncode == 0


def run_gifsicle(gifsicle_bin, gif_path, lossy=80):
    """Post-process GIF with gifsicle: optimize, set no-loop, lossy compress.

    Writes to a separate file (demo-lossy80.gif) so the original VHS
    output is preserved. If the result looks good, the caller can
    replace the original manually.
    """
    if not gif_path.is_file():
        print(f"  Error: {gif_path} not found")
        return False

    size_before = gif_path.stat().st_size
    print(f"  Input:  {gif_path} ({size_before / 1024 / 1024:.1f} MB)")

    # Write to a separate file so the original is preserved
    # Name encodes the exact post-processing applied
    stem = gif_path.stem
    optimized_path = gif_path.with_name(f"{stem}-O3-lossy{lossy}-noloop.gif")

    args = [
        str(gifsicle_bin),
        f"--lossy={lossy}",
        "--no-loopcount",
        "-O3",
        str(gif_path),
        "-o",
        str(optimized_path),
    ]
    result = subprocess.run(args)
    if result.returncode != 0:
        print(f"  Error: gifsicle exited with code {result.returncode}")
        return False

    size_after = optimized_path.stat().st_size
    reduction = (1 - size_after / size_before) * 100 if size_before > 0 else 0
    print(f"  Output: {optimized_path} ({size_after / 1024 / 1024:.1f} MB)")
    print(f"  Saved:  {reduction:.0f}% (lossy={lossy})")
    print(f"  Original preserved: {gif_path}")
    return True


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Build project demo GIF",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--tape",
        type=Path,
        default=DEFAULT_TAPE,
        help=f"VHS tape file (default: {DEFAULT_TAPE.relative_to(PROJECT_ROOT)})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output GIF path (default: {DEFAULT_OUTPUT.relative_to(PROJECT_ROOT)})",
    )
    parser.add_argument(
        "--postprocess-only",
        action="store_true",
        help="Skip VHS recording, only run gifsicle on existing GIF",
    )
    parser.add_argument(
        "--lossy",
        type=int,
        default=80,
        help="Gifsicle lossy compression level (default: 80, 0=lossless)",
    )
    parser.add_argument(
        "--no-gifsicle",
        action="store_true",
        help="Skip gifsicle post-processing",
    )
    args = parser.parse_args()

    print("=== project demo GIF builder ===\n")

    # -- Locate binaries --
    print("Locating binaries...")
    vhs_bin = find_binary("vhs", "VHS_BIN", VHS_SEARCH_PATHS)
    ttyd_dir = find_binary("ttyd", "TTYD_BIN", TTYD_SEARCH_PATHS, is_dir=True)
    gifsicle_bin = find_gifsicle()

    if not args.postprocess_only:
        if not vhs_bin:
            print("  Error: VHS not found. Set VHS_BIN or install VHS.")
            sys.exit(1)
        if not ttyd_dir:
            print("  Warning: ttyd directory not found. Set TTYD_BIN.")
            print("  VHS may fail if ttyd is not on PATH.")

    if not args.no_gifsicle and not gifsicle_bin:
        print("  Warning: gifsicle not found. Skipping post-processing.")
        print("  Install: choco install gifsicle -y")
        args.no_gifsicle = True

    # -- Record --
    if not args.postprocess_only:
        print(f"\nRecording demo...")
        if not run_vhs(vhs_bin, ttyd_dir, args.tape, PROJECT_ROOT):
            print("\nVHS recording failed.")
            sys.exit(1)
        print("\nRecording complete.")

    # -- Post-process --
    if not args.no_gifsicle:
        print(f"\nPost-processing with gifsicle...")
        gif_path = args.output
        if not run_gifsicle(gifsicle_bin, gif_path, args.lossy):
            print("\nGifsicle post-processing failed.")
            sys.exit(1)

    print(f"\nDone. Output: {args.output}")


if __name__ == "__main__":
    main()
