#!/usr/bin/env python3
"""
Synchronize version numbers across all project files.

Single source of truth: <package>/_version.py (MAJOR, MINOR, PATCH, PHASE).
This script reads those components and propagates to:
- _version.py __version__ string (git metadata: branch, build, date, hash)
- CHANGELOG.md compare links at the bottom

Replaces scripts/update-version.sh -- all version logic lives here.
Git hooks call this with --auto.

Usage:
    python scripts/sync-versions.py [OPTIONS]

Options:
    --check         Only check if versions are in sync (don't modify)
    --bump PART     Bump version before syncing (major, minor, patch)
    --demote PART   Demote version before syncing (major, minor, patch)
    --set X.Y.Z     Set version directly (e.g., --set 0.3.0)
    --phase PHASE   Set release phase (alpha, beta, rc1) or 'none' to clear
    --pre-num N     Set PRE_RELEASE_NUM explicitly (rarely needed)
    --dry-run       Show what would change without modifying files
    --auto          Git hook mode (quiet, stages files, uses today's date)
    --no-git-ver    Skip __version__ string update (components only)
    --force / -f    Skip confirmation prompts
    --verbose / -v  Show detailed output

Examples:
    # Check sync status
    python scripts/sync-versions.py --check

    # Bump patch version and sync everything
    python scripts/sync-versions.py --bump patch

    # Just sync (no version change) -- useful after manual edits
    python scripts/sync-versions.py

    # Set phase to alpha, PRE_RELEASE_NUM resets to 1
    python scripts/sync-versions.py --phase alpha

    # Clear phase for stable release
    python scripts/sync-versions.py --phase none

    # Git hook mode (called by pre-commit)
    python scripts/sync-versions.py --auto
"""

import argparse
import datetime
import re
import subprocess
import sys
from pathlib import Path


# --- Project-specific config ---
# These values are auto-detected from pyproject.toml [tool.repokit-common]
# if available. Otherwise, edit these defaults for your project.
# When used as a submodule, the consuming project's pyproject.toml is checked.
_DEFAULT_VERSION_SOURCE = "$PACKAGE_NAME/_version.py"
_DEFAULT_CHANGELOG_FILE = "CHANGELOG.md"
_DEFAULT_REPO_URL = "https://github.com/$GITHUB_ORG/$PROJECT_NAME"
_DEFAULT_TAG_PREFIX = "v"
_DEFAULT_TAG_FORMAT = "pep440"  # "pep440" or "human"
_VALID_TAG_FORMATS = {"pep440", "human"}

def _load_config():
    """Load config from pyproject.toml [tool.repokit-common] or use defaults."""
    try:
        import tomllib
    except ImportError:
        try:
            import tomli as tomllib
        except ImportError:
            tomllib = None

    # Walk up to find pyproject.toml (handles submodule case)
    check_dir = Path(__file__).resolve().parent
    for _ in range(5):
        candidate = check_dir / "pyproject.toml"
        if candidate.exists():
            if tomllib:
                with open(candidate, "rb") as f:
                    data = tomllib.load(f)
                cfg = data.get("tool", {}).get("repokit-common", {})
                if cfg:
                    tag_format = cfg.get("tag-format", _DEFAULT_TAG_FORMAT)
                    if tag_format not in _VALID_TAG_FORMATS:
                        print(
                            f"Warning: unknown tag-format '{tag_format}' "
                            f"in pyproject.toml (expected: {', '.join(sorted(_VALID_TAG_FORMATS))}). "
                            f"Falling back to '{_DEFAULT_TAG_FORMAT}'.",
                            file=sys.stderr,
                        )
                        tag_format = _DEFAULT_TAG_FORMAT
                    return (
                        cfg.get("version-source", _DEFAULT_VERSION_SOURCE),
                        cfg.get("changelog", _DEFAULT_CHANGELOG_FILE),
                        cfg.get("repo-url", _DEFAULT_REPO_URL),
                        cfg.get("tag-prefix", _DEFAULT_TAG_PREFIX),
                        tag_format,
                    )
            break
        check_dir = check_dir.parent

    return (_DEFAULT_VERSION_SOURCE, _DEFAULT_CHANGELOG_FILE, _DEFAULT_REPO_URL,
            _DEFAULT_TAG_PREFIX, _DEFAULT_TAG_FORMAT)

VERSION_SOURCE, CHANGELOG_FILE, REPO_URL, TAG_PREFIX, TAG_FORMAT = _load_config()
# --------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Project root
# ---------------------------------------------------------------------------

def find_project_root() -> Path:
    """Find project root by looking for the version source file."""
    if Path(VERSION_SOURCE).exists():
        return Path.cwd()
    # Try git root
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        )
        root = Path(result.stdout.strip())
        if (root / VERSION_SOURCE).exists():
            return root
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    raise FileNotFoundError(f"Cannot find {VERSION_SOURCE}. Run from project root.")


# ---------------------------------------------------------------------------
# Version component read/write
# ---------------------------------------------------------------------------

def read_version_components(file_path: Path) -> dict:
    """Read MAJOR, MINOR, PATCH, PHASE, PRE_RELEASE_NUM, PROJECT_PHASE."""
    content = file_path.read_text(encoding="utf-8")

    major = re.search(r"^MAJOR\s*=\s*(\d+)", content, re.MULTILINE)
    minor = re.search(r"^MINOR\s*=\s*(\d+)", content, re.MULTILINE)
    patch = re.search(r"^PATCH\s*=\s*(\d+)", content, re.MULTILINE)

    if not all([major, minor, patch]):
        raise ValueError(f"Could not parse MAJOR, MINOR, PATCH from {file_path}")

    # PHASE: extract, strip comments and quotes, normalize empty/None
    phase_match = re.search(r"^PHASE\s*=\s*(.+)$", content, re.MULTILINE)
    phase = None
    if phase_match:
        raw = phase_match.group(1).strip()
        raw = re.sub(r"#.*$", "", raw).strip()
        raw = raw.strip("\"'")
        if raw and raw.lower() not in ("none", "null", ""):
            phase = raw

    # PRE_RELEASE_NUM
    pre_num_match = re.search(r"^PRE_RELEASE_NUM\s*=\s*(\d+)", content, re.MULTILINE)
    pre_release_num = int(pre_num_match.group(1)) if pre_num_match else 1

    # PROJECT_PHASE (read-only)
    proj_phase_match = re.search(r'^PROJECT_PHASE\s*=\s*"([^"]*)"', content, re.MULTILINE)
    project_phase = proj_phase_match.group(1) if proj_phase_match else None

    return {
        "major": int(major.group(1)),
        "minor": int(minor.group(1)),
        "patch": int(patch.group(1)),
        "phase": phase,
        "pre_release_num": pre_release_num,
        "project_phase": project_phase,
    }


def write_version_components(
    file_path: Path, components: dict, dry_run: bool = False
) -> bool:
    """Update MAJOR, MINOR, PATCH, PHASE, PRE_RELEASE_NUM in version file."""
    content = file_path.read_text(encoding="utf-8")
    original = content

    content = re.sub(
        r"^(MAJOR\s*=\s*)\d+",
        f"\\g<1>{components['major']}",
        content, flags=re.MULTILINE,
    )
    content = re.sub(
        r"^(MINOR\s*=\s*)\d+",
        f"\\g<1>{components['minor']}",
        content, flags=re.MULTILINE,
    )
    content = re.sub(
        r"^(PATCH\s*=\s*)\d+",
        f"\\g<1>{components['patch']}",
        content, flags=re.MULTILINE,
    )

    # PHASE: write as quoted string or empty string
    phase_str = f'"{components["phase"]}"' if components["phase"] else '""'
    content = re.sub(
        r'^(PHASE\s*=\s*).*$',
        f"\\g<1>{phase_str}  # Per-MINOR feature set: None, \"alpha\", \"beta\", \"rc1\", etc.",
        content, flags=re.MULTILINE,
    )

    # PRE_RELEASE_NUM
    content = re.sub(
        r"^(PRE_RELEASE_NUM\s*=\s*)\d+",
        f"\\g<1>{components['pre_release_num']}",
        content, flags=re.MULTILINE,
    )

    if content != original:
        if not dry_run:
            file_path.write_text(content, encoding="utf-8")
        return True
    return False


# ---------------------------------------------------------------------------
# __version__ string (git metadata)
# ---------------------------------------------------------------------------

def get_git_info(root: Path, auto_mode: bool = False) -> dict:
    """Gather git metadata for the __version__ string."""
    info = {
        "branch": "unknown",
        "build_count": "0",
        "date": datetime.date.today().strftime("%Y%m%d"),
        "commit_hash": "unknown0",
    }

    try:
        subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            cwd=str(root), capture_output=True, check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return info

    # Branch
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=str(root), capture_output=True, text=True, check=True,
        )
        branch = result.stdout.strip()
        if branch:
            info["branch"] = branch.replace("/", "-")
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    # Build count
    try:
        result = subprocess.run(
            ["git", "rev-list", "--count", "HEAD"],
            cwd=str(root), capture_output=True, text=True, check=True,
        )
        count = int(result.stdout.strip())
        if auto_mode:
            count += 1  # pre-commit: about to create a new commit
        info["build_count"] = str(count)
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError):
        pass

    # Commit hash
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short=8", "HEAD"],
            cwd=str(root), capture_output=True, text=True, check=True,
        )
        info["commit_hash"] = result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    # Date -- in auto mode always use today; otherwise smart default
    if not auto_mode:
        try:
            result = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=str(root), capture_output=True, text=True, check=True,
            )
            modified = result.stdout.strip()
            if modified:
                other_changes = [
                    line for line in modified.split("\n")
                    if "_version.py" not in line
                ]
                if not other_changes:
                    # Only version files changed -- use last commit date
                    result = subprocess.run(
                        ["git", "log", "-1", "--format=%cd", "--date=format:%Y%m%d"],
                        cwd=str(root), capture_output=True, text=True, check=True,
                    )
                    info["date"] = result.stdout.strip()
            else:
                # Clean working dir -- use last commit date
                result = subprocess.run(
                    ["git", "log", "-1", "--format=%cd", "--date=format:%Y%m%d"],
                    cwd=str(root), capture_output=True, text=True, check=True,
                )
                info["date"] = result.stdout.strip()
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass

    return info


def build_version_string(components: dict, git_info: dict) -> str:
    """Build the full __version__ string.

    Format: MAJOR.MINOR.PATCH[-PHASE]_BRANCH_BUILD-YYYYMMDD-HASH
    """
    base = format_human_version(components)
    return (
        f"{base}_{git_info['branch']}_{git_info['build_count']}"
        f"-{git_info['date']}-{git_info['commit_hash']}"
    )


def read_version_string(file_path: Path) -> str | None:
    """Read the current __version__ value from a file."""
    content = file_path.read_text(encoding="utf-8")
    match = re.search(r'__version__\s*=\s*"([^"]+)"', content)
    return match.group(1) if match else None


def write_version_string(
    file_path: Path, new_version: str, dry_run: bool = False
) -> bool:
    """Update the __version__ string in a file."""
    content = file_path.read_text(encoding="utf-8")
    original = content

    content = re.sub(
        r'(__version__\s*=\s*")[^"]+(")',
        f"\\g<1>{new_version}\\g<2>",
        content,
    )

    if content != original:
        if not dry_run:
            file_path.write_text(content, encoding="utf-8")
        return True
    return False


# ---------------------------------------------------------------------------
# Version formatting
# ---------------------------------------------------------------------------

def format_human_version(components: dict) -> str:
    """Human-readable version (e.g., 0.2.3, 0.2.3-alpha)."""
    base = f"{components['major']}.{components['minor']}.{components['patch']}"
    if components["phase"]:
        return f"{base}-{components['phase']}"
    return base


def to_pep440(components: dict) -> str:
    """Convert to PEP 440 version string.

    Examples:
        phase=None           -> "0.2.3"
        phase="alpha", pre=1 -> "0.2.3a1"
        phase="beta", pre=2  -> "0.2.3b2"
        phase="rc1"          -> "0.2.3rc1"
    """
    base = f"{components['major']}.{components['minor']}.{components['patch']}"
    phase = components["phase"]
    if not phase:
        return base

    phase_map = {
        "alpha": f"a{components['pre_release_num']}",
        "beta": f"b{components['pre_release_num']}",
    }
    # rc1, rc2 etc. pass through directly
    suffix = phase_map.get(phase, phase)
    return f"{base}{suffix}"


def to_tag(components: dict) -> str:
    """Convert to git tag format, respecting project's tag-format config.

    tag-format options (set in pyproject.toml [tool.repokit-common]):
      "pep440" (default): v0.2.3a1, v0.2.3b1, v0.2.3rc1, v0.2.3
      "human":            v0.2.3-alpha, v0.2.3-beta, v0.2.3-rc1, v0.2.3
    """
    if TAG_FORMAT == "human":
        return f"{TAG_PREFIX}{format_human_version(components)}"
    return f"{TAG_PREFIX}{to_pep440(components)}"


def bump_version(components: dict, part: str) -> dict:
    """Bump the specified version part. Returns new components."""
    c = dict(components)
    if part == "major":
        c["major"] += 1
        c["minor"] = 0
        c["patch"] = 0
    elif part == "minor":
        c["major"] = c["major"]
        c["minor"] += 1
        c["patch"] = 0
    elif part == "patch":
        c["patch"] += 1
    else:
        raise ValueError(f"Unknown version part: {part}")
    return c


def demote_version(components: dict, part: str) -> dict:
    """Demote the specified version part. Returns new components."""
    c = dict(components)
    if part == "major" and c["major"] > 0:
        c["major"] -= 1
        c["minor"] = 0
        c["patch"] = 0
    elif part == "minor" and c["minor"] > 0:
        c["minor"] -= 1
        c["patch"] = 0
    elif part == "patch" and c["patch"] > 0:
        c["patch"] -= 1
    else:
        raise ValueError(
            f"Cannot demote {part} below 0 "
            f"(current: {c['major']}.{c['minor']}.{c['patch']})"
        )
    return c


def parse_version_string(version_str: str) -> tuple[int, int, int]:
    """Parse 'X.Y.Z' into (major, minor, patch)."""
    match = re.match(r"^(\d+)\.(\d+)\.(\d+)$", version_str.strip())
    if not match:
        raise ValueError(
            f"Invalid version format: '{version_str}'. Expected X.Y.Z (e.g., 0.3.0)"
        )
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


# ---------------------------------------------------------------------------
# CHANGELOG management
# ---------------------------------------------------------------------------

def check_changelog_header(root: Path, version_str: str) -> bool:
    """Check if CHANGELOG.md has a section header for this version."""
    changelog = root / CHANGELOG_FILE
    if not changelog.exists():
        return False
    content = changelog.read_text(encoding="utf-8")
    pattern = rf"##\s*\[{re.escape(version_str)}\]"
    return bool(re.search(pattern, content))


def update_changelog_links(
    root: Path, components: dict, dry_run: bool = False
) -> bool:
    """Update or add compare links at the bottom of CHANGELOG.md.

    Manages two things:
    1. The link for the current version (compare from previous tag)
    2. The [Unreleased] link (compare from current tag to HEAD)

    Only touches the link-reference block at the bottom of the file.
    Never modifies section headers or content.
    """
    changelog = root / CHANGELOG_FILE
    if not changelog.exists():
        return False

    content = changelog.read_text(encoding="utf-8")
    original = content

    human_ver = format_human_version(components)
    tag = to_tag(components)

    # Find or update the link for this version
    # Pattern: [0.2.3]: https://github.com/.../compare/vX...vY
    link_pattern = rf"^\[{re.escape(human_ver)}\]:.*$"
    link_match = re.search(link_pattern, content, re.MULTILINE)

    if link_match:
        # Link exists -- update it with correct tags
        old_line = link_match.group(0)
        # Extract the "from" tag from the existing compare URL
        compare_match = re.search(r"compare/([^.]+(?:\.[^.]+)*)\.\.\.", old_line)
        from_tag = compare_match.group(1) if compare_match else None
        if from_tag:
            new_line = f"[{human_ver}]: {REPO_URL}/compare/{from_tag}...{tag}"
        else:
            # No compare URL -- this is the first release, use releases/tag/
            new_line = f"[{human_ver}]: {REPO_URL}/releases/tag/{tag}"

        if old_line != new_line:
            content = content.replace(old_line, new_line)

    # Update [Unreleased] link to point from current tag to HEAD
    unreleased_pattern = r"^\[Unreleased\]:.*$"
    unreleased_match = re.search(unreleased_pattern, content, re.MULTILINE)
    unreleased_line = f"[Unreleased]: {REPO_URL}/compare/{tag}...HEAD"

    if unreleased_match:
        content = re.sub(
            unreleased_pattern, unreleased_line, content, flags=re.MULTILINE
        )
    else:
        # Add [Unreleased] link before the first version link
        first_link = re.search(r"^\[[\d.]+", content, re.MULTILINE)
        if first_link:
            content = content[:first_link.start()] + unreleased_line + "\n" + content[first_link.start():]

    if content != original:
        if not dry_run:
            changelog.write_text(content, encoding="utf-8")
        return True
    return False


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

def git_tag_exists(root: Path, tag: str) -> bool:
    """Check if a git tag exists in the repository."""
    try:
        result = subprocess.run(
            ["git", "tag", "-l", tag],
            cwd=str(root), capture_output=True, text=True, check=True,
        )
        return tag in result.stdout.strip().split("\n")
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def git_stage(root: Path, *files: str) -> None:
    """Stage files for commit."""
    try:
        subprocess.run(
            ["git", "add"] + list(files),
            cwd=str(root), capture_output=True, check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description=f"Sync versions across {Path(VERSION_SOURCE).parent.name} project files"
    )
    parser.add_argument(
        "--check", action="store_true", help="Only check, don't modify"
    )
    parser.add_argument(
        "--bump", choices=["major", "minor", "patch"], help="Bump version part"
    )
    parser.add_argument(
        "--demote", choices=["major", "minor", "patch"], help="Demote version part"
    )
    parser.add_argument("--set", metavar="X.Y.Z", help="Set version directly")
    parser.add_argument(
        "--phase", metavar="PHASE",
        help="Set release phase (alpha, beta, rc1) or 'none'/'stable' to clear",
    )
    parser.add_argument(
        "--pre-num", type=int, metavar="N",
        help="Set PRE_RELEASE_NUM explicitly (rarely needed)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Show changes without modifying"
    )
    parser.add_argument(
        "--auto", action="store_true",
        help="Git hook mode (quiet, stages files, uses today's date)",
    )
    parser.add_argument(
        "--no-git-ver", action="store_true",
        help="Skip __version__ string update (components only)",
    )
    parser.add_argument(
        "--force", "-f", action="store_true", help="Skip confirmation prompts"
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Verbose output"
    )
    args = parser.parse_args()

    quiet = args.auto

    try:
        root = find_project_root()
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    # Read current version from source of truth
    components = read_version_components(root / VERSION_SOURCE)
    current_version = format_human_version(components)
    components_changed = False

    if args.verbose:
        print(f"Project root: {root}")
        print(f"Source: {VERSION_SOURCE}")
        print(f"Current: {current_version} (PEP 440: {to_pep440(components)})")
        if components["phase"]:
            print(f"Phase: {components['phase']} (pre-release num: {components['pre_release_num']})")

    # Handle --phase
    if args.phase:
        if args.phase.lower() in ("none", "null", "stable", "release", ""):
            components["phase"] = None
        else:
            # If transitioning from stable/different phase to alpha, reset PRE_RELEASE_NUM
            if components["phase"] != args.phase:
                components["pre_release_num"] = 1
            components["phase"] = args.phase
        components_changed = True

    # Handle --pre-num
    if args.pre_num is not None:
        components["pre_release_num"] = args.pre_num
        components_changed = True

    # Handle --set, --bump, or --demote (mutually exclusive)
    version_ops = [args.set, args.bump, args.demote]
    if sum(1 for op in version_ops if op) > 1:
        print("Error: Cannot use --set, --bump, and --demote together", file=sys.stderr)
        return 1

    if args.set:
        try:
            new_major, new_minor, new_patch = parse_version_string(args.set)
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1

        components["major"] = new_major
        components["minor"] = new_minor
        components["patch"] = new_patch

        new_version = format_human_version(components)

        if new_major != components["major"] and not args.force and not args.dry_run and not args.check:
            print(f"\n  WARNING: Major version change: {current_version} -> {new_version}")
            try:
                confirm = input("\n  Type 'yes' to confirm: ")
                if confirm.lower() != "yes":
                    print("  Aborted.")
                    return 1
            except (EOFError, KeyboardInterrupt):
                print("\n  Aborted.")
                return 1

        if not quiet:
            print(f"Setting version: {current_version} -> {new_version}")
        components_changed = True

    elif args.bump:
        new_components = bump_version(components, args.bump)
        new_version = format_human_version(new_components)

        if args.bump == "major" and not args.force and not args.dry_run and not args.check:
            print(f"\n  WARNING: Major version bump: {current_version} -> {new_version}")
            try:
                confirm = input("\n  Type 'yes' to confirm: ")
                if confirm.lower() != "yes":
                    print("  Aborted.")
                    return 1
            except (EOFError, KeyboardInterrupt):
                print("\n  Aborted.")
                return 1

        if not quiet:
            print(f"Bumping {args.bump}: {current_version} -> {new_version}")

        components["major"] = new_components["major"]
        components["minor"] = new_components["minor"]
        components["patch"] = new_components["patch"]
        components_changed = True

    elif args.demote:
        try:
            new_components = demote_version(components, args.demote)
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1

        new_version = format_human_version(new_components)
        if not quiet:
            print(f"Demoting {args.demote}: {current_version} -> {new_version}")

        components["major"] = new_components["major"]
        components["minor"] = new_components["minor"]
        components["patch"] = new_components["patch"]
        components_changed = True

    # Recalculate after any changes
    current_version = format_human_version(components)
    pip_version = to_pep440(components)
    tag = to_tag(components)

    if not quiet:
        print(f"Version: {current_version}  (PEP 440: {pip_version}, tag: {tag})")

    # Track status
    all_synced = True
    files_updated = []

    # --- Write components if changed ---
    if components_changed and not args.check:
        updated = write_version_components(root / VERSION_SOURCE, components, args.dry_run)
        if updated:
            action = "would update" if args.dry_run else "updated"
            if not quiet:
                print(f"  [OK] {VERSION_SOURCE}: components {action}")
            files_updated.append(VERSION_SOURCE)

    # --- Sync __version__ string with git metadata ---
    if not args.no_git_ver:
        git_info = get_git_info(root, auto_mode=args.auto)
        new_ver_string = build_version_string(components, git_info)

        ver_path = root / VERSION_SOURCE
        current_str = read_version_string(ver_path)

        if current_str != new_ver_string:
            all_synced = False
            if args.check:
                print(f"  [X] {VERSION_SOURCE}: __version__ out of date")
                if args.verbose:
                    print(f"       current:  {current_str}")
                    print(f"       expected: {new_ver_string}")
            else:
                updated = write_version_string(ver_path, new_ver_string, args.dry_run)
                if updated:
                    action = "would update" if args.dry_run else "updated"
                    if not quiet:
                        print(f"  [OK] {VERSION_SOURCE}: __version__ {action}")
                    if VERSION_SOURCE not in files_updated:
                        files_updated.append(VERSION_SOURCE)
        else:
            if args.verbose:
                print(f"  [OK] {VERSION_SOURCE}: __version__ in sync")

    # --- Sync CHANGELOG.md compare links ---
    changelog_path = root / CHANGELOG_FILE
    if changelog_path.exists():
        # Check header
        has_header = check_changelog_header(root, current_version)
        if not has_header:
            all_synced = False
            if args.check:
                print(f"  [X] {CHANGELOG_FILE}: no ## [{current_version}] header")
            elif not quiet:
                print(f"  [!!] {CHANGELOG_FILE}: no ## [{current_version}] header (add manually)")

        # Update compare links
        if not args.check:
            updated = update_changelog_links(root, components, args.dry_run)
            if updated:
                action = "would update" if args.dry_run else "updated"
                if not quiet:
                    print(f"  [OK] {CHANGELOG_FILE}: compare links {action}")
                files_updated.append(CHANGELOG_FILE)
        else:
            # In check mode, verify the current version's link has the right tag
            content = changelog_path.read_text(encoding="utf-8")
            human_ver = format_human_version(components)
            # Check that the link ends with the correct tag (not a substring like v0.2.3a1 matching v0.2.3)
            link_pattern = rf"^\[{re.escape(human_ver)}\]:.*\.\.\.{re.escape(tag)}$"
            # Also accept releases/tag/ format (used for first release with no prior tag)
            release_pattern = rf"^\[{re.escape(human_ver)}\]:.*releases/tag/{re.escape(tag)}$"
            if not re.search(link_pattern, content, re.MULTILINE) and \
               not re.search(release_pattern, content, re.MULTILINE):
                # Check if the tag exists yet -- new repos won't have tags before first release
                if not git_tag_exists(root, tag):
                    # Tag doesn't exist yet -- this is expected for unreleased versions
                    if not quiet:
                        print(f"  [--] {CHANGELOG_FILE}: [{human_ver}] link references {tag} (tag not yet created, OK)")
                else:
                    all_synced = False
                    print(f"  [X] {CHANGELOG_FILE}: compare link for [{human_ver}] missing or wrong tag (expected {tag})")
            elif args.verbose:
                print(f"  [OK] {CHANGELOG_FILE}: compare link for [{human_ver}] correct")
    else:
        if args.verbose:
            print(f"  [--] {CHANGELOG_FILE}: not found (skipped)")

    # Stage files in auto mode
    if args.auto and files_updated and not args.dry_run:
        git_stage(root, *files_updated)

    # Summary
    if args.check:
        if all_synced:
            if not quiet:
                print("\nAll versions are in sync.")
            return 0
        else:
            if not quiet:
                print("\nVersions are out of sync. Run without --check to fix.")
            return 1
    elif files_updated:
        if not quiet:
            if args.dry_run:
                print(f"\nDry run: would update {len(files_updated)} file(s)")
            else:
                print(f"\nUpdated {len(files_updated)} file(s)")
    else:
        if not quiet:
            print("\nAll versions already in sync.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
