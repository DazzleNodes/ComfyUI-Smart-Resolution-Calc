# Post-Setup TODO

## Adding to Your Project (git subtree)

```bash
# 1. Add repokit-common as a subtree in your scripts/ directory
git subtree add --prefix=scripts https://github.com/DazzleTools/git-repokit-common.git main --squash

# 2. Add a named remote so you don't type the URL each time
git remote add repokit-common https://github.com/DazzleTools/git-repokit-common.git

# 3. Future updates
git subtree pull --prefix=scripts repokit-common main --squash

# 4. Push local improvements back upstream
git subtree push --prefix=scripts repokit-common main
```

Note: If you already have files in `scripts/`, move them out first, do the subtree add, then move them back. Git subtree requires an empty prefix directory on first add.

## Required (after subtree add)

- [ ] **Configure pyproject.toml**: Add `[tool.repokit-common]` section (no `pyproject.toml`? put the same table in `.repokit-common.toml` at the repository root):
  ```toml
  [tool.repokit-common]
  version-source = "your_package/_version.py"
  changelog = "CHANGELOG.md"
  repo-url = "https://github.com/YourOrg/your-project"
  tag-prefix = "v"
  private-patterns = ["private/", "local/", ".env"]
  ```
  `private-patterns` entries are literal path prefixes from the repository root (not regular expressions), added to the pre-commit hook's built-in list.
- [ ] **Check the pre-push test step**: with no settings it runs pytest over your declared `testpaths`, or over `tests/` without `one-offs/` and `thinking/`. If your tests are scripts rather than pytest, or live elsewhere, set `test-command` (or declare `testpaths`)
- [ ] **Create `_version.py`**: Copy the version module template into your package directory and edit the initial version values
- [ ] **Install hooks**: run `bash scripts/repokit-common/install-hooks.sh` (or `scripts/install-hooks.sh` in a flat layout). It writes small stubs that run the vendored hooks, so later subtree pulls update the hooks without re-installing. Re-run it only after changing `strict-branches`.

## Customize (as needed)

- [ ] **VHS demo tapes** (`scripts/demo/vhs/*.tape`): Replace placeholder CLI commands with your actual command name
- [ ] **demo_render.py** (`scripts/demo/`): Rewrite with your project's output format (the existing content is a template/example)
- [ ] **Pre-push hook**: Verify the auto-detected package directory is correct for your project

## Optional

- [ ] **search_sesslog.py**: Useful if you use Claude Code -- searches session transcripts
- [ ] **extract_tool_result.py**: Useful if you use Claude Code -- extracts tool results from sessions
- [ ] **build_demo.py** (`scripts/demo/`): Run after customizing VHS tapes to generate demo GIFs

## Notes

- The hooks auto-detect your Python package directory (looks for `__init__.py` at the project root)
- `sync-versions.py`, `gh_issue_full.py` and the hooks read `[tool.repokit-common]` automatically, through `repokit_config.py`
- `--prefix=scripts` must be used consistently for all subtree operations
- Your project-specific scripts can coexist alongside repokit-common files in `scripts/`
