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

- [ ] **Configure pyproject.toml**: Add `[tool.repokit-common]` section (hooks depend on this):
  ```toml
  [tool.repokit-common]
  version-source = "your_package/_version.py"
  changelog = "CHANGELOG.md"
  repo-url = "https://github.com/YourOrg/your-project"
  tag-prefix = "v"
  private-patterns = ["private/", "local/", ".env"]
  ```
- [ ] **Create `_version.py`**: Copy the version module template into your package directory and edit the initial version values
- [ ] **Install hooks**: Run `bash scripts/install-hooks.sh`

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
- `sync-versions.py` reads config from `pyproject.toml [tool.repokit-common]` automatically
- `--prefix=scripts` must be used consistently for all subtree operations
- Your project-specific scripts can coexist alongside repokit-common files in `scripts/`
