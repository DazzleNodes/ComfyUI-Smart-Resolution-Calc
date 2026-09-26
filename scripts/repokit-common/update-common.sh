#!/usr/bin/env bash
# Update git-repokit-common scripts to the latest version.
#
# Usage:
#   bash scripts/update-common.sh          # pull latest from upstream
#   bash scripts/update-common.sh --check  # show current vs latest version
#   bash scripts/update-common.sh --push   # push local changes back upstream

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Repository root via git (works for any subtree prefix depth)
REPO_ROOT="$(cd "$SCRIPT_DIR" && git rev-parse --show-toplevel)"
# Subtree prefix derived from this script's location relative to the repo root
PREFIX="${SCRIPT_DIR#"$REPO_ROOT"/}"
REMOTE_NAME="repokit-common"
REMOTE_URL="https://github.com/DazzleTools/git-repokit-common.git"

cd "$REPO_ROOT"

# Ensure remote exists
if ! git remote get-url "$REMOTE_NAME" &>/dev/null; then
    echo "Adding remote: $REMOTE_NAME -> $REMOTE_URL"
    git remote add "$REMOTE_NAME" "$REMOTE_URL"
fi

case "${1:-pull}" in
    --check|check|--version|version|-v)
        echo "=== git-repokit-common status ==="
        echo ""
        # Show version from VERSION file if it exists
        LOCAL_VER="unknown"
        if [ -f "$SCRIPT_DIR/VERSION" ]; then
            LOCAL_VER=$(cat "$SCRIPT_DIR/VERSION" | tr -d '[:space:]')
        fi
        echo "  Local version:  $LOCAL_VER"
        # Fetch and show upstream version
        git fetch "$REMOTE_NAME" main --quiet 2>/dev/null
        UPSTREAM_VER=$(git show "$REMOTE_NAME/main:VERSION" 2>/dev/null | tr -d '[:space:]' || echo "unknown")
        echo "  Upstream version: $UPSTREAM_VER"
        # Compare commits
        LOCAL_SHA=$(git log --format="%H" --grep="Squashed '$PREFIX/'" -1 2>/dev/null)
        if [ -n "$LOCAL_SHA" ]; then
            BEHIND=$(git rev-list --count "$LOCAL_SHA".."$REMOTE_NAME/main" 2>/dev/null || echo "?")
            if [ "$BEHIND" = "0" ]; then
                echo ""
                echo "  Up to date."
            else
                echo ""
                echo "  $BEHIND commit(s) behind upstream."
                echo "  Run: bash $PREFIX/update-common.sh"
            fi
        fi
        ;;
    --push|push)
        echo "Pushing local $PREFIX/ changes to $REMOTE_NAME..."
        git subtree push --prefix="$PREFIX" "$REMOTE_NAME" main
        echo "Done."
        ;;
    pull|"")
        echo "Pulling latest $REMOTE_NAME into $PREFIX/..."
        git subtree pull --prefix="$PREFIX" "$REMOTE_NAME" main --squash
        echo "Done."
        ;;
    --help|-h|help)
        echo "Usage: bash $PREFIX/update-common.sh [command]"
        echo ""
        echo "Commands:"
        echo "  (none), pull    Pull latest from upstream"
        echo "  --check, -v     Show current vs upstream version"
        echo "  --push          Push local changes back upstream"
        echo "  --help          Show this help"
        ;;
    *)
        echo "Unknown option: $1"
        echo "Run: bash $PREFIX/update-common.sh --help"
        exit 1
        ;;
esac
