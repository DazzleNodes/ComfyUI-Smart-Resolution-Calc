#!/bin/bash
#
# Install git hooks for the current project.
#
# Each hook in .git/hooks is a small stub. The stub finds this checkout's
# vendored repokit-common copy and runs the real hook from there, with the
# shared hooks/lib.sh beside it, so the hooks update with every subtree pull
# and never need re-installing for a new release. A checkout with no copy
# (a branch without the subtree) cannot run the checks: on a gated branch
# (strict-branches, stamped into the stub at install time) the stub blocks,
# elsewhere it warns and lets git continue. See the README's Git Hooks section.
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PROJECT_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "project")
echo -e "${BLUE}${PROJECT_NAME} Git Hook Installer${NC}"
echo "=========================="
echo ""

# Find git directory (handles worktrees where .git is a file, not a directory)
GIT_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
if [ -z "$GIT_DIR" ]; then
    echo -e "${RED}Error:${NC} Git repository not found"
    echo "Please run from the project root directory"
    exit 1
fi

HOOKS_DIR="$GIT_DIR/hooks"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOOKS_DIR"

echo -e "${GREEN}Found git repository at:${NC} $GIT_DIR"
echo ""

# git ignores .git/hooks when core.hooksPath is set, so the stubs would never run.
HOOKS_PATH="$(git config --get core.hooksPath 2>/dev/null || true)"
if [ -n "$HOOKS_PATH" ]; then
    echo -e "${YELLOW}Warning:${NC} core.hooksPath is set to '$HOOKS_PATH'."
    echo "  git runs hooks from there, not from $HOOKS_DIR, so the repokit-common"
    echo "  hooks installed below will not run until it is unset:"
    echo "      git config --unset core.hooksPath"
    echo ""
fi

STUB_MARKER="repokit-common hook stub"

# Ask before replacing a pre-commit hook that is not already one of ours.
if [ -f "$HOOKS_DIR/pre-commit" ] && ! grep -q "$STUB_MARKER" "$HOOKS_DIR/pre-commit"; then
    echo -e "${YELLOW}Warning:${NC} pre-commit hook already exists"
    echo "Do you want to overwrite it? (y/n)"
    read -r response
    if [ "$response" != "y" ] && [ "$response" != "Y" ]; then
        echo "Installation cancelled"
        exit 0
    fi
fi

# The gated branches a stub enforces when it cannot find the vendored copy:
# the project's strict-branches setting now, else git-repokit's default set.
STRICT_BRANCHES=""
if [ -f "$SCRIPT_DIR/repokit_config.py" ] && command -v python >/dev/null 2>&1; then
    STRICT_BRANCHES="$(python "$SCRIPT_DIR/repokit_config.py" --get strict-branches 2>/dev/null | tr '\n' ' ' | sed 's/ *$//' || true)"
fi
[ -n "$STRICT_BRANCHES" ] || STRICT_BRANCHES="main master staging live"
case "$STRICT_BRANCHES" in
    *"'"*) echo -e "${RED}Error:${NC} strict-branches entries cannot contain a quote: $STRICT_BRANCHES"; exit 1 ;;
esac

# Where this copy lives, relative to the repository root: the stub looks here
# first, so a copy at any path (tracked or not) is found without searching.
# Relative, never absolute: every worktree shares .git/hooks, and each must run
# its own checkout's copy. The standard paths and git's index stay as fallbacks.
TOP_DIR="$(cd "$(git rev-parse --show-toplevel)" && pwd)"
if [ "$SCRIPT_DIR" = "$TOP_DIR" ]; then
    INSTALLED_DIR="."
else
    INSTALLED_DIR="${SCRIPT_DIR#"$TOP_DIR"/}"
fi
case "$INSTALLED_DIR" in
    /*|*"'"*) INSTALLED_DIR="." ;;   # outside this repository, or unquotable: rely on the search
esac

write_stub() {
    # $1: hook name. Prints the stub's text.
    cat <<STUB
#!/bin/sh
# $STUB_MARKER -- written by install-hooks.sh; do not edit, re-run it instead.
# Runs this checkout's vendored copy of the $1 hook, so hooks update with every
# subtree pull. With no copy in this checkout the checks cannot run: a gated
# branch is blocked, any other branch gets a warning.
REPOKIT_HOOK='$1'
REPOKIT_INSTALLED_STRICT='$STRICT_BRANCHES'
REPOKIT_INSTALLED_DIR='$INSTALLED_DIR'
# bash when there is one (pre-push needs it); plain sh is enough for the others.
shell=bash; command -v bash >/dev/null 2>&1 || shell=sh
top="\$(git rev-parse --show-toplevel 2>/dev/null)" || top="\$(pwd)"
for d in "\$top/\$REPOKIT_INSTALLED_DIR" "\$top/scripts/repokit-common" "\$top/scripts" "\$top"; do
    if [ -f "\$d/repokit_config.py" ] && [ -f "\$d/hooks/\$REPOKIT_HOOK" ]; then
        exec "\$shell" "\$d/hooks/\$REPOKIT_HOOK" "\$@"
    fi
done
rel="\$(git -C "\$top" ls-files -- ':(glob)**/repokit_config.py' 2>/dev/null | head -n1)"
if [ -n "\$rel" ] && [ -f "\$top/\$(dirname "\$rel")/hooks/\$REPOKIT_HOOK" ]; then
    exec "\$shell" "\$top/\$(dirname "\$rel")/hooks/\$REPOKIT_HOOK" "\$@"
fi
branch="\$(git symbolic-ref --short -q HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null)"
strict="\${REPOKIT_STRICT_BRANCHES-\$REPOKIT_INSTALLED_STRICT}"
set -f
for p in \$strict; do
    case "\$branch" in
        \$p)
            echo "repokit-common: BLOCKED -- the \$REPOKIT_HOOK checks cannot run: this checkout has no repokit-common copy, and '\$branch' is a gated branch." >&2
            echo "  Check out a branch that has the copy, or loosen it for one run: REPOKIT_STRICT_BRANCHES= git <command> (or --no-verify)." >&2
            exit 1 ;;
    esac
done
echo "repokit-common: warning -- \$REPOKIT_HOOK checks skipped: this checkout has no repokit-common copy (branch '\$branch')." >&2
exit 0
STUB
}

# Each hook that would be replaced by a different one is first saved as
# <hook>.backup-<timestamp> beside it, so a project's own hook (or an older
# full-copy install) can be recovered. One timestamp per run keeps a run's
# backups together; an identical hook is left alone and not backed up.
BACKUP_STAMP="$(date +%Y%m%d-%H%M%S)"
install_hook() {
    _src="$SCRIPT_DIR/hooks/$1"
    _dst="$HOOKS_DIR/$1"
    [ -f "$_src" ] || return 0
    _new="$(write_stub "$1")"
    if [ -f "$_dst" ]; then
        if [ "$(cat "$_dst")" = "$_new" ]; then
            echo -e "${GREEN}$1 hook already up to date${NC}"
            return 0
        fi
        cp -p "$_dst" "$_dst.backup-$BACKUP_STAMP"
        echo -e "${YELLOW}Note:${NC} existing $1 hook saved as $1.backup-$BACKUP_STAMP"
    fi
    echo -e "${GREEN}Installing $1 hook...${NC}"
    printf '%s\n' "$_new" > "$_dst"
    chmod +x "$_dst"
}

install_hook pre-commit
install_hook post-commit
install_hook pre-push

if [ -f "$SCRIPT_DIR/sync-versions.py" ]; then
    echo -e "${GREEN}Found sync-versions.py (version management)${NC}"
elif [ -f "$SCRIPT_DIR/update-version.sh" ]; then
    chmod +x "$SCRIPT_DIR/update-version.sh"
    echo -e "${YELLOW}Using legacy update-version.sh (sync-versions.py not found)${NC}"
fi

echo ""
echo -e "${GREEN}Git hooks installed.${NC} Each hook in $HOOKS_DIR runs the copy in"
echo "$SCRIPT_DIR/hooks, so pulling a new repokit-common updates them; there is"
echo "no need to re-run this installer for a new release."
echo ""
echo "pre-commit:"
echo "  - stamps the version (sync-versions.py --auto)"
echo "  - blocks private files on public branches: a built-in list plus the"
echo "    project's private-patterns; .repokit-allowlist exempts paths"
echo "  - blocks files over 10 MB"
echo "post-commit:"
echo "  - writes the new commit's hash into the version string"
echo "pre-push:"
echo "  - checks Python syntax (the package and root-level .py files)"
echo "  - runs the tests: the project's test-command, or pytest over its"
echo "    testpaths or tests/ -- failures block the gated branches"
echo "  - blocks debugger statements"
echo ""
echo "Gated branches for this checkout: $STRICT_BRANCHES"
echo "Settings live in [tool.repokit-common] (pyproject.toml, or .repokit-common.toml);"
echo "see the README. Change a setting that the stubs stamp (strict-branches), then"
echo "re-run this installer."
echo ""
echo "Update the version by hand with:"
echo "  python $SCRIPT_DIR/sync-versions.py"
echo "  python $SCRIPT_DIR/sync-versions.py --bump patch"
echo "  python $SCRIPT_DIR/sync-versions.py --check"
