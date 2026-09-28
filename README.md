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
- **pre-commit** -- Version sync (`sync-versions.py --auto`), private content protection (built-in patterns plus the project's own `private-patterns`), large file blocking. Works in normal clones and in git worktrees
- **post-commit** -- Refreshes version hash after commit, and says so plainly when it could not
- **pre-push** -- Python syntax check (the package and root-level `.py` files), tests, debug statement detection. Tests run as `python -P -m pytest` over the project's declared `testpaths`, or `tests/` without `one-offs/`, `thinking/` and the vendored repokit-common copy; a project can replace pytest with its own `test-command`. The result is reported as it happened: failing tests, or a test runner that cannot start, block a push to a **gated branch** (`strict-branches`: by default `main`, `master`, `staging` and `live`) and are warnings anywhere else, so experimental branches can still be pushed; no tests is a notice, not a failure
- **lib.sh** -- The code the three hooks share: finding the vendored copy, its settings and the version tool, the branch rules, and the output markers. One place, so a fix reaches every hook

**How the hooks run.** `install-hooks.sh` writes a small stub for each hook into `.git/hooks`. The stub finds the checkout's own vendored copy and runs the real hook from there, so **pulling a new repokit-common updates the hooks**, with no need to re-install. It looks first in the folder the installer was run from, which the installer records relative to the repository root, so a copy at any path is found even if git does not track it. Then it tries `scripts/repokit-common/`, `scripts/`, the root, and anywhere git tracks `repokit_config.py`. In a git worktree the stub finds that worktree's copy. On a branch whose tree has no vendored copy, the checks cannot run: a gated branch is blocked, and any other branch gets a warning. `REPOKIT_STRICT_BRANCHES= git <command>` loosens that for one run, and `--no-verify` skips the hooks entirely. The installer writes the project's `strict-branches` into each stub, so re-run it after changing that setting. If `core.hooksPath` is set, git ignores `.git/hooks`, and the installer warns about it.

**Output.** Messages use `[OK]`, `[!]` and `[X]` with no colour codes when they are not going to a terminal: an IDE's git panel, CI, or a tool that captures them. When they are going to a terminal, they use `✓`, `⚠` and `✗` with colour. `output = "plain"` or `"rich"` fixes the choice, and `REPOKIT_OUTPUT` overrides the setting for one run.

**Line endings.** The hooks and shell scripts are kept at LF through `.gitattributes`. Git for Windows' bash also runs CRLF hooks correctly.

### Version Management
- **sync-versions.py** -- Single source of truth for version bumping with git metadata. See [docs/sync-versions.md](docs/sync-versions.md) for full reference.
- **update-version.sh** -- Legacy bash version updater (deprecated; use sync-versions.py)

### GitHub Tools
- **gh_issue_full.py** -- Display complete issue context: timeline, cross-refs, sub-issues, comments. Shows the body and every comment in full by default; `--no-full` truncates. The default can be changed per user with `GH_ISSUE_FULL_DEFAULT=truncated` or per repo with `gh-issue-full-default = "truncated"` under `[tool.repokit-common]` in `pyproject.toml`; a flag always wins, and the environment variable wins over the repo setting.
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
- **install-hooks.sh** -- Install the hook stubs into `.git/hooks/` (see "How the hooks run" above). A different hook already there is kept as `<hook>.backup-YYYYMMDD-HHMMSS`; an identical one is left alone
- **repokit_config.py** -- Find and read the project's `[tool.repokit-common]` settings (used by the tools and hooks; `--get KEY`, `--shell KEY...`, `--where`)
- **paths.sh** -- Common path constants for scripts
- **safe_move.sh** -- Hash-verified file move with timestamp preservation

## Configuration

Projects configure repokit-common via `[tool.repokit-common]` in `pyproject.toml`. A project without a `pyproject.toml` (C/C++, Rust, ...) puts the same table in `.repokit-common.toml` at its repository root. Every key is optional; a project with pytest tests in `tests/`, or with no tests, needs none of the hook settings.

```toml
[tool.repokit-common]
version-source = "mypackage/_version.py"
changelog = "CHANGELOG.md"
repo-url = "https://github.com/DazzleTools/my-project"
tag-prefix = "v"
tag-format = "pep440"
private-patterns = ["private/", "local/", ".env"]
test-command = "python tests/run_all.py"
print-warning = false
strict-branches = ["main", "master", "staging", "live", "release/*"]
output = "auto"
```

| Key | Read by | Meaning |
|-----|---------|---------|
| `version-source`, `changelog`, `repo-url`, `tag-prefix`, `tag-format` | `sync-versions.py` | See [docs/sync-versions.md](docs/sync-versions.md) |
| `gh-issue-full-default` | `gh_issue_full.py` | `full` or `truncated` |
| `private-patterns` | pre-commit | Extra paths a public branch must not receive. Each entry is a **literal path prefix from the repository root**, not a regular expression: `private/` blocks `private/notes.md` but not `docs/private/notes.md`, and `.env` blocks `.env` and `.env.local`. Entries are added to the built-in list, never replacing it. `.repokit-allowlist` still exempts listed paths |
| `test-command` | pre-push | Replaces pytest. Run with `sh -c` from the repository root; any non-zero exit counts as failing tests |
| `print-warning` | pre-push | `false` turns off the warning about many `print()` calls (for CLIs, whose output is `print()` by design). The count never includes `tests/` or the vendored copy |
| `strict-branches` | pre-push, hook stubs | The gated branches, as shell glob patterns. Failing tests, or a test runner that cannot start, block a push to them and are warnings elsewhere. Unset means `main`, `master`, `staging` and `live`, from git-repokit's branch model: `main` passes CI, `staging` is pre-release, `live` is production. `REPOKIT_STRICT_BRANCHES` overrides it for one run, and an empty value gates nothing |
| `output` | all hooks | `auto` (default), `plain` or `rich`; see "Output" above. `REPOKIT_OUTPUT` overrides it for one run |

**How the settings are found.** `repokit_config.py` walks up from repokit-common's own directory to the nearest `pyproject.toml` that holds the table, or to a `.repokit-common.toml`; `pyproject.toml` wins when both are in one directory, and a `pyproject.toml` without the table is walked past. The walk never leaves the project: it stops at the repository root, or at the superproject's root when repokit-common is a git submodule. This works wherever the copy is mounted (`scripts/`, `scripts/repokit-common/`, or deeper). The hooks run from the vendored copy, through the stubs, so they read the settings through that copy's own `repokit_config.py`. A settings file that exists but cannot be parsed stops the commit or push with the reason, rather than silently using defaults.

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
