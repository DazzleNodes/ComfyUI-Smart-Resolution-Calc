# git-repokit-common

Shared scripts, hooks, and developer tools for DazzleTools projects. Consumed as a git subtree in `scripts/`.

## Quick Start

Add to your project:

```bash
# Add as a subtree at scripts/
git subtree add --prefix=scripts https://github.com/DazzleTools/git-repokit-common.git main --squash

# Add named remote for convenience
git remote add repokit-common https://github.com/DazzleTools/git-repokit-common.git

# Install git hooks
bash scripts/install-hooks.sh
```

Update to latest:

```bash
bash scripts/update-common.sh            # pull latest
bash scripts/update-common.sh --check    # check if behind upstream
bash scripts/update-common.sh --push     # push local changes upstream
```

## What's Included

### Git Hooks (`hooks/`)
- **pre-commit** -- Version sync (`sync-versions.py --auto`), private content protection, large file blocking
- **post-commit** -- Refreshes version hash after commit
- **pre-push** -- Python syntax check, pytest, debug statement detection

### Version Management
- **sync-versions.py** -- Single source of truth for version bumping with git metadata. See [docs/sync-versions.md](docs/sync-versions.md) for full reference.
- **update-version.sh** -- Legacy bash version updater (deprecated; use sync-versions.py)

### GitHub Tools
- **gh_issue_full.py** -- Display complete issue context: timeline, cross-refs, sub-issues, comments
- **gh_sub_issues.py** -- Manage GitHub sub-issue relationships

### Knowledge Vault Tools
- **[docs/vault-spec.md](docs/vault-spec.md)** -- the Vault Specification: canonical definition of `private/claude/` knowledge vaults (layout, maturity ladder, wikilink rules, write authority, ecosystem)
- **generate-backlinks.py** -- Generate the `_oracle/backlinks.md` reverse-link index for a vault
- **vault-lint.py** -- Lint a vault against the spec: broken-link classes, orphans, freshness, manifest coverage; `--check` for CI/hooks, `--fix` for the provably-safe class only

### Claude Code Session Tools
- **search_sesslog.py** -- Search Claude Code JSONL session transcripts
- **extract_tool_result.py** -- Find and extract tool results from session data

### CLI Demo Recording (`demo/`)
- **demo/build_demo.py** -- Build CLI demo recordings
- **demo/demo_render.py** -- Render demo recordings
- **demo/vhs/** -- VHS tape templates for CLI demo recording

### Utilities
- **install-hooks.sh** -- Install git hooks from this submodule into `.git/hooks/`
- **paths.sh** -- Common path constants for scripts
- **safe_move.sh** -- Hash-verified file move with timestamp preservation

## Configuration

Projects configure repokit-common via `[tool.repokit-common]` in `pyproject.toml`:

```toml
[tool.repokit-common]
version-source = "mypackage/_version.py"
changelog = "CHANGELOG.md"
repo-url = "https://github.com/DazzleTools/my-project"
tag-prefix = "v"
tag-format = "pep440"
private-patterns = ["private/", "local/", ".env"]
```

### Tag Format

The `tag-format` option controls how git tags are generated for CHANGELOG compare links and `--check` validation:

| Value | Example Tag | When to Use |
|-------|-------------|-------------|
| `"pep440"` (default) | `v0.1.3a1` | Projects using PEP 440 tags for PyPI compatibility |
| `"human"` | `v0.1.3-alpha` | Projects using human-readable tags matching CHANGELOG headers |

For stable releases (no phase suffix), both formats produce identical tags (`v0.5.0`). The difference only matters for pre-release versions (alpha, beta, rc).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full version history. Current version: see [`VERSION`](VERSION).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) for details.
