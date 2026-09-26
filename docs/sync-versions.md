# sync-versions.py

Single source of truth for version management across DazzleTools projects.

## Overview

`sync-versions.py` reads version components from `_version.py` and propagates them to:
- The `__version__` string (with git metadata: branch, build count, date, commit hash)
- CHANGELOG.md compare links

It replaces manual version editing. Git hooks call it automatically on every commit.

## How It Works

### The Version File (`_version.py`)

Every project has a `_version.py` in its package directory. This is the canonical source:

```python
# Version components - edit these for version bumps
MAJOR = 0
MINOR = 3
PATCH = 0
PHASE = ""        # "" (stable), "alpha", "beta", "rc1"
PROJECT_PHASE = "" # "prealpha", "alpha", "beta", "stable"

# Auto-updated by git hooks - do not edit manually
__version__ = "0.3.0_main_12-20260404-a1b2c3d4"
__app_name__ = "my-project"
```

**You edit:** `MAJOR`, `MINOR`, `PATCH`, `PHASE`, `PROJECT_PHASE`
**Hooks update:** `__version__`, `PIP_VERSION`, `VERSION`, etc.

### The `__version__` String Format

```
MAJOR.MINOR.PATCH[-PHASE]_BRANCH_BUILD-YYYYMMDD-COMMITHASH
```

Examples:
- `0.3.0_main_12-20260404-a1b2c3d4` -- stable, 12th build on main
- `0.3.0-alpha_dev_5-20260401-b2c3d4e5` -- alpha phase, 5th build on dev

### Version Levels

| Level | Scope | Changes when... | Example |
|-------|-------|-----------------|---------|
| `PHASE` | Per-MINOR feature set | Feature set matures: `"alpha"` -> `"beta"` -> `""` | `0.3.0-alpha` -> `0.3.0` |
| `PROJECT_PHASE` | Entire project | Project hits maturity threshold (rare) | `PREALPHA 0.3.0` -> `BETA 0.5.0` |

`PHASE` resets with each MINOR bump. `PROJECT_PHASE` is independent of version numbers.

## Configuration

In `pyproject.toml`:

```toml
[tool.repokit-common]
version-source = "my_package/_version.py"
changelog = "CHANGELOG.md"
repo-url = "https://github.com/MyOrg/my-project"
tag-prefix = "v"
tag-format = "pep440"    # or "human"
private-patterns = ["private/", "local/", ".env"]
```

### Tag Format

| Setting | Tag example | PEP 440 | Use when |
|---------|-------------|---------|----------|
| `"pep440"` (default) | `v0.3.0a1` | `0.3.0a1` | Publishing to PyPI |
| `"human"` | `v0.3.0-alpha` | N/A | Human-readable tags, not on PyPI |

For stable releases (no phase), both produce identical tags: `v0.3.0`.

## Usage

### Check if versions are in sync

```bash
python scripts/sync-versions.py --check
```

Reports `[OK]` or `[X]` for each managed file. Returns exit code 1 if out of sync.

### Sync without changing version

```bash
python scripts/sync-versions.py
```

Updates `__version__` with current git metadata (branch, build count, date, hash). Run this after manual edits to `_version.py`.

### Bump version

```bash
python scripts/sync-versions.py --bump patch    # 0.3.0 -> 0.3.1
python scripts/sync-versions.py --bump minor    # 0.3.0 -> 0.4.0
python scripts/sync-versions.py --bump major    # 0.3.0 -> 1.0.0
```

### Set version directly

```bash
python scripts/sync-versions.py --set 1.0.0
```

### Change phase

```bash
python scripts/sync-versions.py --phase alpha   # add -alpha suffix
python scripts/sync-versions.py --phase beta    # add -beta suffix
python scripts/sync-versions.py --phase none    # clear phase (stable)
```

### Demote version

```bash
python scripts/sync-versions.py --demote patch  # 0.3.1 -> 0.3.0
```

### Dry run

```bash
python scripts/sync-versions.py --bump minor --dry-run
```

Shows what would change without modifying any files.

### Git hook mode

```bash
python scripts/sync-versions.py --auto
```

Called by the pre-commit hook. Quiet mode, stages modified files, uses today's date.

## PEP 440 Mapping

The `get_pip_version()` function in `_version.py` converts to PEP 440 for PyPI:

| Our format | PEP 440 | Notes |
|------------|---------|-------|
| `0.3.0` | `0.3.0` | Stable release |
| `0.3.0-alpha` | `0.3.0a0` | Alpha pre-release |
| `0.3.0-beta` | `0.3.0b0` | Beta pre-release |
| `0.3.0-rc1` | `0.3.0rc1` | Release candidate |
| `0.3.0` (on dev branch) | `0.3.0.dev5` | Dev build |

## CHANGELOG Management

`sync-versions.py` manages the compare links at the bottom of `CHANGELOG.md`:

```markdown
[Unreleased]: https://github.com/Org/repo/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Org/repo/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Org/repo/releases/tag/v0.2.0
```

- `[Unreleased]` always points from the current tag to `HEAD`
- Each version link compares from the previous tag
- The first release uses `releases/tag/` format (no prior tag to compare)

The script updates these links automatically. It does **not** modify section headers or content -- you write changelog entries manually.

## Git Hooks Integration

### pre-commit

Runs `sync-versions.py --auto` to update `__version__` with the pending commit's metadata. Also:
- Blocks private files from public branches
- Blocks files > 10MB

### post-commit

Runs `sync-versions.py --auto` again to update the commit hash (which isn't known until after the commit).

### pre-push

Does **not** run sync-versions. Instead:
- Validates Python syntax
- Runs pytest
- Checks for debug statements

## Flags Reference

| Flag | Description |
|------|-------------|
| `--check` | Verify sync status, exit 1 if out of sync |
| `--bump PART` | Bump major, minor, or patch before syncing |
| `--demote PART` | Demote major, minor, or patch |
| `--set X.Y.Z` | Set version directly |
| `--phase PHASE` | Set phase (alpha, beta, rc1, none) |
| `--pre-num N` | Set PRE_RELEASE_NUM explicitly |
| `--dry-run` | Show changes without modifying files |
| `--auto` | Git hook mode (quiet, stages files) |
| `--no-git-ver` | Skip `__version__` string update |
| `--force`, `-f` | Skip confirmation prompts |
| `--verbose`, `-v` | Show detailed output |
