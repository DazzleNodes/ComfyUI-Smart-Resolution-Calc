# Changelog

All notable changes to git-repokit-common are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note on versioning:** Early releases had a non-linear version sequence. v0.1.3-alpha and v0.1.4-alpha were cut *after* v0.2.1 as experimental side-branches before returning to the 0.2.x line at v0.2.2. Entries below are listed in commit order (newest first), not version order.

## [Unreleased]

## [0.2.10] - 2026-09-14

### Fixed

- **`generate-backlinks.py` no longer loses every link in a note that is not UTF-8.** The indexer read each note with `read_text(encoding='utf-8', errors='ignore')`. That call never raises, so it looked safe — but a UTF-16 document decodes that way into `#\x00 \x00T\x00i…`, and every `[[wikilink]]` in it silently fails to match. The note reported zero links and dropped out of the graph with no error, no warning, and nothing in the output to suggest anything had gone wrong. Encoding is now detected from the byte-order mark, with a fallback for notes that have none, and **any note that is not plain UTF-8 is reported by name** so it can be converted.

  Two documents in one consuming project's vault had been invisible this way. Because the script is used across the ecosystem, any vault holding a note saved as UTF-16 — the default for PowerShell redirection and for Notepad's "Save as Unicode" — had the same hole and no way to notice it.

  The fallback chooses between wide and single-byte encodings by looking for a NUL byte rather than trying each in turn. Python's UTF-16 decoder accepts *any* even-length input when there is no byte-order mark, so attempting it first would turn an ordinary Windows-1252 note into wide-character garbage and destroy its links — the same silent wrong decode, one level further down.

- **`--validate` explains why it skipped instead of failing with an unrelated error.** `obsidiantools` decodes every note as UTF-8 unconditionally and, on a note it cannot read, fails inside itself with an error naming one of its own local variables, which tells the reader nothing about the cause. Validation now checks for unreadable notes first and says which ones they are, and any other failure inside the library is reported without taking down the run. The backlinks index itself is unaffected either way.

- `generate-backlinks.py` skips any `_links/` directory inside the vault. `_links/` is the convention for navigation junctions to sibling vaults; `Path.rglob` follows junctions on Windows, so without the skip a sibling's notes were indexed as phantom local notes, and a cycle of junctions never terminated.

### Added

- **`tests/test_generate_backlinks.py`** — the first automated tests for this script, twelve of them: UTF-16 in both byte orders, UTF-32, Windows-1252 with no byte-order mark, UTF-8 *with* a byte-order mark (which must not be reported as a problem), a file no codec can read, the skip-with-a-reason path in `--validate`, and the whole thing end to end through the command line. Each encoding test asserts that the link edge exists rather than that the read succeeded — reading was never what failed. Nine of the twelve fail if the fix is removed.

- `docs/community-docs-playbook.md` -- how to install the support/conduct doc stack in a Dazzle repo (issue forms, conduct and support docs, moderation as the enforcement that works; licenses stay clean). Piloted in `DazzleML/comfyui-triton-and-sageattention-installer`; written 2026-08-11 and committed now.

## [0.2.9] - 2026-08-13

### Added

- **`docs/vault-spec.md`** — the Vault Specification (spec-version 1.0.0): the canonical definition of project knowledge vaults (`private/claude/`). Ten citable sections: layout and the minimum-viable floor, the L0–L4 maturity ladder, naming conventions (the zero-ceremony producer interface), wikilink rules, the write-authority table (including the checkpoint rule and the no-background-autofix rule), the observed-gaps sensor-log schema, the three-ring ecosystem map around the oracle, survey guardrails for vault crawlers, the distribution/specialization model (one spec here; vaults carry versioned pointers, never copies; per-project bylaws; subtree pulls as the update channel), and the amendment discipline. Consumers — skills, agents, tools, and per-vault docs — cite clause codes (e.g. the wikilink rules section) instead of restating the rules. Written as transcription of field-adopted practice from the 2026-08 vault-bootstrapping arc.
- **`vault-lint.py`** — the spec's first enforcement tool. Checks wikilink health (classified by rule: relative-traversal, `.md`-suffix, table-pipe artifact, heading anchor, timestamp pseudo-link, plain missing), orphan distribution (split expected-archive vs possible-map-gap by directory), MOC freshness (`last_refreshed` vs newest doc), and manifest coverage. `--check` gives a one-line summary + exit code for CI and hooks; `--fix` applies ONLY the provably-safe class — a target that, after mechanical normalization, resolves to exactly one existing file — and refuses everything else with the reason (ambiguity is never auto-picked; timestamps and prose refs are never rewritten; code fences are never touched; a second run fixes zero). Reuses `generate-backlinks.py`'s parser via import so there is one parsing truth, and configures UTF-8 output up front so it cannot die on cp1252 consoles the way its sibling historically did. Locates the vault inside whatever path it is handed (a project directory descends to its `private/claude/`; a non-vault tree is refused, exit 2) — field-found during review: linting a repo as if it were a vault reports valid vault-root links as broken, and a fix run from the wrong root would rewrite them into dead project-rooted forms. Preserves line endings exactly on `--fix` (`newline=''` on both read and write) — an independent mutation-test run's real-file sweep caught the tool silently converting entire files LF→CRLF on Windows, invisible to unit fixtures that shared the same translating-write blind spot. Ships with an 18-test suite named by spec clause (`test_WL1_…`, `test_AUTH3_…`) whose fixture mirrors a real measured population (12 broken links: 7 mechanically fixable, 5 judgment), plus a human checklist at `tests/checklists/v0.2.9__Tool__vault-lint.md`. Validated against two real vaults: the measured population fixed 7/refused 5 exactly, and a 430-file vault surveyed read-only.

## [0.2.8] - 2026-07-29

### Fixed

- **`hooks/pre-commit` no longer word-splits staged paths.** Both checks iterated `for file in $(git diff --cached --name-only)`, which splits on whitespace, so `my report.log` arrived as `my` and `report.log`. Two consequences: the private-content regex matched fragments rather than whole paths, and the large-file guard's `[ -f "$file" ]` test failed on every fragment -- meaning **any file whose name contained a space was never size-checked at all**. Both checks now read a NUL-delimited list, the only safe form for paths.

  Note for anyone applying this pattern elsewhere: the list must be carried in a *file*, not a shell variable. Command substitution strips NUL bytes, so `X=$(git ... -z)` silently concatenates every path into a single string, and the checks then inspect one nonexistent filename instead of the staged set.

- **Version-script resolution reaches subtrees mounted outside `scripts/`.** v0.2.7 generalized the lookup across `scripts/repokit-common/`, `scripts/`, and a recursive `find` beneath `scripts/` -- which covers consumers that nest the subtree under `scripts/` at any depth, but still silently no-ops the version stamp for one mounted elsewhere (e.g. `Software/<area>/<tools>/Repokit-Scripts/`). A final fallback now asks git's index (`git ls-files -- '*sync-versions.py'`), which is layout-agnostic by construction and costs no directory walk -- relevant on large work trees, where a recursive `find` can take minutes. Applied to `update-version.sh` resolution as well. Purely additive: it runs only when all existing candidates miss, so consumers on the established layouts resolve exactly as before.

### Changed

- **`hooks/pre-push` protected-branch policy moved to per-repo config.** The block previously carried a hardcoded branch pattern, which is repo policy rather than shared-library behaviour. It now reads `repokit.protectedBranchRe` from the consuming repo's own config and is skipped entirely when unset, so repos that do not use it are unaffected. Keeping the value in `.git/config` also means it is never committed, which matters when the branch name itself is sensitive. Matching still covers both source and destination refs. **Migration:** a repo relying on the previous hardcoded pattern must set the config value, or its protection lapses.

- **`hooks/pre-commit` performs each check in a single pass.** The per-file loops spawned one or two processes per staged path -- roughly 1,300 for a 650-file commit, which is slow everywhere and markedly worse under Git Bash on Windows, where it contributed to multi-minute commit times. The private-content check is now one `grep` over the whole list, consulting the allowlist only for paths that actually match; the large-file check batches through `xargs -0 du`. Patterns, thresholds, allowlist semantics, messages and exit codes are unchanged.

## [0.2.7] - 2026-06-11

Formal release of the nested-subtree-placement fixes: consumers can now mount
the subtree at `scripts/repokit-common/` (keeping their own project scripts in
`scripts/` without collisions) and have every path-dependent tool work. Folds in
the earlier hook fix (155be9b, shipped unversioned) and completes the path
helpers it left untouched.

### Fixed

- **Hooks resolve the version script layout-agnostically** (155be9b): `hooks/pre-commit` and `hooks/post-commit` try `scripts/repokit-common/sync-versions.py`, then `scripts/sync-versions.py`, then a recursive `find` under `scripts/` (same for the `update-version.sh` fallback). The hardcoded flat path silently no-op'd the version stamp for every nested-layout consumer. `install-hooks.sh` help text prints the resolved path. Also adds `.repokit-allowlist` support to the private-content check.
- **`paths.sh`**: `REPO_ROOT` now walks up to the nearest `.git` (dir or worktree file) instead of assuming the scripts-repo's parent directory -- which was wrong for any nesting depth other than flat `scripts/`.
- **`update-common.sh`**: `REPO_ROOT` via `git rev-parse --show-toplevel`; subtree `PREFIX` derived from the script's own location relative to the repo root, so `update-common.sh --check/--push` and `git subtree pull` work at any prefix depth (e.g. `scripts/repokit-common`).

First consumer: `DazzleTools/dazzlelink` (file-association scripts live in `scripts/`; subtree moves to `scripts/repokit-common/`).

## [0.2.6] - 2026-05-18

### Added

- **`generate-backlinks.py`**: Obsidian-style reverse-link index generator for `private/claude/` knowledge vaults. Walks all `.md` files, parses `[[wikilinks]]` and `[[wikilinks|aliases]]`, builds a reverse-link (backlinks) index, writes to `_oracle/backlinks.md`. Zero deps beyond Python stdlib; optional `networkx` for `--graph FILE` export. Flags: `--stats` (summary), `--orphans` (notes with no links in either direction), `--broken` (dangling wikilinks), `--validate` (regenerate + report), `--dry-run`, `--json`. Auto-detects vault from cwd via the `private/claude/` or `_maps/` markers, or accepts an explicit path arg. Powers the "Phase 1a" RAG-lite metadata that the Claude Code `oracle` agent expects (`_oracle/manifest.md`, `_oracle/concepts.md`, `_oracle/backlinks.md`); without it, oracle's "what references X?" queries fall back to recursive grep.

  **Provenance note:** originally written in `github-traffic-tracker`; ships here so every repokit-common consumer (amdead, wtf-windows, Prime-Square-Sum, dazzlecmd, etc.) picks it up via subtree pull. Long-term home is a `dazzlecmd` tool (see `DazzleTools/dazzlecmd#70` — graduate fully-generic utility scripts to dazzlecmd tools); this distribution channel is a stepping stone, not the destination.

## [0.2.5] - 2026-05-15

### Fixed

- **`update-version.sh` package auto-detection on src/ layout**: the auto-detect added in v0.2.2 walked only top-level directories looking for `__init__.py` + `_version.py` together. On PEP 517 / setuptools src-layout projects (where the package lives at `src/<package>/`, not at the repo root), no top-level dir contains those files, so the script exited with `Error: Could not find _version.py in any package directory`. Added the same `src/*/` fallback that `pre-push` already has — first the flat loop, then `src/*/` if `src/` exists and the flat loop didn't find a candidate. Discovered while integrating repokit-common into a src-layout project (`DazzleTools/dazzlecmd` -- src/dazzlecmd/_version.py); pre-commit hooks weren't affected (they use `sync-versions.py --auto` which reads `version-source` from `[tool.repokit-common]`), but anyone running `bash scripts/update-version.sh` manually on a src-layout project hit the bug. Note: `update-version.sh` is upstream-deprecated in favor of `sync-versions.py`, but the fix keeps the legacy fallback functional for consumers that haven't migrated yet.

## [0.2.4] - 2026-04-19

### Fixed

- **`gh_issue_full.py` null `commit_id` crash**: `process_timeline()` crashed with `TypeError: 'NoneType' object is not subscriptable` when a GitHub timeline event returned `commit_id=None` (explicit JSON null rather than missing key). Root cause: `dict.get(key, default)` only returns `default` when the key is missing, not when the value is `None`. Fixed the `"referenced"` event branch with idiomatic `(item.get("commit_id") or "")[:7]` null-and-empty coercion. The `"closed"` branch was already guarded correctly. Reproduced and verified against `DazzleTools/dazzlecmd#13`.

## [0.2.3] - 2026-04-07

### Added

- **Tag-only push detection in `pre-push` hook**: Tag pushes don't change code, so running the full pytest suite and syntax checks is wasted time. The hook now reads stdin ref info from git and exits early when every ref being pushed is a tag (`refs/tags/*`), printing `Tag-only push -- skipping validation`.

## [0.2.2] - 2026-04-04

### Added

- **`update-common.sh`**: subtree management script for consuming projects. Supports `pull` (default), `--check` (version status vs upstream), and `--push` (propagate local changes upstream).
- **`VERSION` file** (`0.2.2`): simple top-level version tracking. `update-common.sh --check` uses it to compare local vs upstream at a glance.
- **`docs/sync-versions.md`**: reference documentation for the version management system -- configuration, PEP 440 mapping, git hooks integration, and full flag reference.

### Fixed

- **`demo/build_demo.py` and `demo/demo_render.py` path resolution**: after moving into `demo/` subdirectory (v0.1.4-alpha), the scripts' `Path(__file__).resolve().parent.parent` pattern resolved to `scripts/` instead of the project root. Updated to `parent.parent.parent` and fixed the default VHS tape path from `scripts/vhs/` to `scripts/demo/vhs/`.

### Removed

- **`.github/workflows/ci.yml` and `release.yml`**: template leftovers that always failed because this repo isn't a pip-installable package.
- **`tests/test_version.py`**: template placeholder with literal `$PACKAGE_NAME` that never worked here. Test infrastructure (`conftest.py`, `tests/one-offs/`, `tests/output/`) retained for future use.

### Refs

- Refs #1 (consumer tracking)

## [0.1.4-alpha] - 2026-04-04

### Added

- **`git_tag_exists()` helper in `sync-versions.py`**: checks whether a given git tag exists in the repository.

### Fixed

- **`--check` CHANGELOG validation on new repos**: new projects without their first release would fail `--check` because the CHANGELOG compare link references a tag that doesn't exist yet. Now accepts the `releases/tag/...` link format (used for first releases with no prior tag to compare against), and when the tag doesn't exist yet reports informational `[--]` instead of error `[X]` -- avoiding the need for `--force` on every new project.

### Changed

- **Demo tooling reorganized into `demo/` subdirectory**: `build_demo.py`, `demo_render.py`, and `vhs/` moved into `demo/` to reduce clutter. Most projects don't use demo recording; keeping it in a single subdirectory makes the top level cleaner.

### Removed

- **`pyproject.toml.comfyui` and `pyproject.toml.pypi`**: redundant archetype templates that belong in `git-repokit-template`, not in common scripts.

## [0.1.3-alpha] - 2026-04-03

### Added

- **`[tool.repokit-common]` section in `pyproject.toml`**: explicit config with `version-source`, `changelog`, `repo-url`, `tag-prefix`, `tag-format`, and `private-patterns`.
- **Git hooks (via repokit-common)**: `pre-commit` version sync + private file protection, `post-commit` hash refresh, `pre-push` syntax and test checks.
- **`tag-format` config option in `sync-versions.py`**: `"pep440"` (default) produces `v0.1.3a1` style tags for PyPI compatibility; `"human"` produces `v0.1.3-alpha` style tags for projects using human-readable tags that match CHANGELOG headers. Unknown values warn and fall back to `pep440`.
- **`scripts/README.md` tag-format documentation**: format table with guidance on when to use each option.

### Fixed

- **`sync-versions.py to_tag()` PEP 440 hardcoding**: `to_tag()` ignored the project's chosen `tag-format` and always emitted PEP 440 style tags. This caused `--check` to reject valid human-readable CHANGELOG links as mismatches, and `update_changelog_links()` to silently rewrite those links into broken PEP 440 URLs. The corruption cascaded to subsequent releases. Fixed by honoring `tag-format` in all tag-producing code paths.
- **`pre-push` hook package detection**: the auto-detection logic only checked root-level directories for `__init__.py`, missing `src/` layout projects. Now also walks `src/*/` when a root-level package isn't found.
- **`pre-push` hook syntax check**: used a `py_compile` glob that failed when no `.py` files existed at the target path. Replaced with `compileall -q`, which handles empty directories gracefully.
- **`pre-push` hook test runner**: treated "no tests collected" as a pytest failure, blocking pushes to `main` on projects without tests. Now skips the test step when no `test_*.py` files exist.
- **Dynamic version import in downstream consumers**: `locked.py --version` replaced a hardcoded version string with a dynamic import from `_version.py` (`get_base_version`).
- **Stale embedded version metadata**: `locked/.wtf.json` was stuck at `0.1.1`; updated to `0.1.3`.

### Changed

- **Version**: `0.1.2-alpha` -> `0.1.3-alpha`.
- **`_version.py __version__` now includes git metadata**: branch, build count, date, and commit hash are appended via `sync-versions.py`.

### Refs

- Refs #3 (epic -- shared tooling integration)

### Design

- `2026-04-02__23-00-06__dev-workflow_sync-versions-tag-format-and-check-robustness.md`

## [0.2.1] - 2026-03-31

### Changed

- **README and TODO updated to use the git subtree workflow** instead of git submodule. Replaced submodule instructions with `git subtree add --prefix=scripts`, added a named remote recipe (`git remote add repokit-common`), and documented the pull/push cycle for bidirectional sync. Also noted that pre-existing files in `scripts/` must be moved out first, since `git subtree add` requires an empty prefix directory.

## [0.2.0] - 2026-03-31

### Changed

- **Scripts moved to repo root for submodule compatibility** (later superseded by subtree approach in v0.2.1). When added as a submodule at `scripts/repokit-common/`, having scripts inside a nested `scripts/` subdirectory caused `scripts/repokit-common/scripts/sync-versions.py` -- double nesting. Moving everything to the repo root produces the cleaner `scripts/repokit-common/sync-versions.py`. `install-hooks.sh` uses `$(dirname "$0")` so paths resolve correctly regardless of where the submodule is checked out.
- **`FUNDING.yml` expanded to the full format**; paths in README and TODO adjusted accordingly.

## [0.1.0] - 2026-03-31

### Added

- **Initial DazzleTools shared toolbox**, parameterized for reuse across projects.
- **Git hooks** (`hooks/`):
  - `pre-commit`: version sync, private content protection, large file blocking
  - `post-commit`: version hash refresh
  - `pre-push`: syntax check, pytest, debug statement detection (auto-detects package directory via `__init__.py`)
- **Version management**:
  - `sync-versions.py`: reads config from `pyproject.toml [tool.repokit-common]`
  - `update-version.sh`: legacy bash updater (deprecated in favor of `sync-versions.py`)
- **GitHub tools**:
  - `gh_issue_full.py`: full issue context viewer (timeline, cross-refs, sub-issues, comments)
  - `gh_sub_issues.py`: sub-issue relationship management
- **Claude Code session tools**:
  - `search_sesslog.py`: search JSONL session transcripts
  - `extract_tool_result.py`: extract tool results from sessions
- **CLI demo recording**: `build_demo.py`, `demo_render.py` (template/example), `vhs/` tape templates.
- **Utilities**: `install-hooks.sh` (auto-detects project name), `paths.sh`, `safe_move.sh`.
- **`TODO.md`**: post-setup checklist for consuming projects.
- **`README.md`**: usage instructions and configuration docs.

All project-specific hardcoding (`wtf-restarted`, `comfydbg`) was replaced with auto-detection or `$placeholder` variables. Project-level files (`.github/`, `CONTRIBUTING.md`, `.repokit.json`, `.vscode/`) were substituted with real values for `git-repokit-common`.

[Unreleased]: https://github.com/DazzleTools/git-repokit-common/compare/v0.2.10...HEAD
[0.2.10]: https://github.com/DazzleTools/git-repokit-common/compare/v0.2.9...v0.2.10
[0.2.5]: https://github.com/DazzleTools/git-repokit-common/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/DazzleTools/git-repokit-common/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/DazzleTools/git-repokit-common/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/DazzleTools/git-repokit-common/compare/v0.1.4-alpha...v0.2.2
[0.1.4-alpha]: https://github.com/DazzleTools/git-repokit-common/compare/v0.1.3-alpha...v0.1.4-alpha
[0.1.3-alpha]: https://github.com/DazzleTools/git-repokit-common/compare/v0.2.1...v0.1.3-alpha
[0.2.1]: https://github.com/DazzleTools/git-repokit-common/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/DazzleTools/git-repokit-common/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DazzleTools/git-repokit-common/releases/tag/v0.1.0
