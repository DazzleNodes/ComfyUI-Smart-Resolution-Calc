# shellcheck shell=sh
#
# repokit-common hook library -- sourced by hooks/pre-commit, post-commit and
# pre-push, from the folder they sit in. POSIX sh (pre-commit runs under sh).
# Nothing here exits: each hook decides what a failure means.
#
# Installed hooks are small stubs in .git/hooks (written by install-hooks.sh)
# that run the real hook from this checkout's vendored copy, so a hook finds
# its copy as the folder above hooks/. The candidate-path lookup below is the
# fallback for a hook copied straight into .git/hooks (older installs, tests).
# One place for all of this, so a fix reaches every hook (#14).

RK_DEFAULT_STRICT_BRANCHES="main master staging live"

# Sets REPO_ROOT, RK_DIR (the vendored copy), CONFIG_TOOL, VENDORED_DIR (RK_DIR
# relative to the root; empty when repokit-common is the project itself),
# SYNC_SCRIPT, UPDATE_SCRIPT and CURRENT_BRANCH.
rk_locate() {
    # Which overrides came from the environment, noted before any settings are
    # read: an empty REPOKIT_STRICT_BRANCHES in the environment means "no gated
    # branches this run", while an unset strict-branches setting reads as empty
    # too and means "the default set".
    _RK_ENV_STRICT="${REPOKIT_STRICT_BRANCHES+set}"
    _RK_ENV_OUTPUT="${REPOKIT_OUTPUT+set}"
    # One path form throughout: git answers C:/..., sh's pwd /c/...; resolving
    # through cd makes prefix stripping below reliable.
    REPO_ROOT="$(cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && pwd)"
    _rk_hooks="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
    RK_DIR=""
    if [ -f "$_rk_hooks/../repokit_config.py" ]; then
        RK_DIR="$(cd "$_rk_hooks/.." && pwd)"
    else
        for _rk_cand in "$REPO_ROOT/scripts/repokit-common" "$REPO_ROOT/scripts" "$REPO_ROOT"; do
            [ -f "$_rk_cand/repokit_config.py" ] && { RK_DIR="$_rk_cand"; break; }
        done
        if [ -z "$RK_DIR" ]; then
            _rk_rel="$(git ls-files -- ':(glob)**/repokit_config.py' 2>/dev/null | head -n1)"
            [ -n "$_rk_rel" ] && [ -f "$REPO_ROOT/$_rk_rel" ] && RK_DIR="$(cd "$(dirname "$REPO_ROOT/$_rk_rel")" && pwd)"
        fi
    fi
    CONFIG_TOOL=""
    VENDORED_DIR=""
    if [ -n "$RK_DIR" ]; then
        CONFIG_TOOL="$RK_DIR/repokit_config.py"
        [ "$RK_DIR" != "$REPO_ROOT" ] && VENDORED_DIR="${RK_DIR#"$REPO_ROOT"/}"
    fi

    # The version tools: beside the copy when there is one, else the layouts
    # consumers have used, a bounded find under scripts/, then git's index
    # (layout-agnostic, no directory walk).
    SYNC_SCRIPT=""
    UPDATE_SCRIPT=""
    [ -n "$RK_DIR" ] && [ -f "$RK_DIR/sync-versions.py" ] && SYNC_SCRIPT="$RK_DIR/sync-versions.py"
    [ -n "$RK_DIR" ] && [ -f "$RK_DIR/update-version.sh" ] && UPDATE_SCRIPT="$RK_DIR/update-version.sh"
    if [ -z "$SYNC_SCRIPT" ]; then
        for _rk_cand in "$REPO_ROOT/scripts/repokit-common/sync-versions.py" "$REPO_ROOT/scripts/sync-versions.py"; do
            [ -f "$_rk_cand" ] && { SYNC_SCRIPT="$_rk_cand"; break; }
        done
        [ -z "$SYNC_SCRIPT" ] && SYNC_SCRIPT="$(find "$REPO_ROOT/scripts" -name sync-versions.py -type f -print 2>/dev/null | head -n1)"
        if [ -z "$SYNC_SCRIPT" ]; then
            _rk_rel="$(git ls-files -- '*sync-versions.py' 2>/dev/null | head -n1)"
            [ -n "$_rk_rel" ] && [ -f "$REPO_ROOT/$_rk_rel" ] && SYNC_SCRIPT="$REPO_ROOT/$_rk_rel"
        fi
    fi
    if [ -z "$UPDATE_SCRIPT" ]; then
        for _rk_cand in "$REPO_ROOT/scripts/repokit-common/update-version.sh" "$REPO_ROOT/scripts/update-version.sh"; do
            [ -f "$_rk_cand" ] && { UPDATE_SCRIPT="$_rk_cand"; break; }
        done
        if [ -z "$UPDATE_SCRIPT" ]; then
            _rk_rel="$(git ls-files -- '*update-version.sh' 2>/dev/null | head -n1)"
            [ -n "$_rk_rel" ] && [ -f "$REPO_ROOT/$_rk_rel" ] && UPDATE_SCRIPT="$REPO_ROOT/$_rk_rel"
        fi
    fi

    # symbolic-ref first: on a branch with no commits yet (a new or orphan
    # branch's first commit) rev-parse --abbrev-ref answers "HEAD".
    CURRENT_BRANCH="$(git symbolic-ref --short -q HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
}

# rk_read_settings KEY... -- sets REPOKIT_<KEY> for each key from the project's
# [tool.repokit-common] (one call to repokit_config.py). A variable already set
# in the environment wins over the setting, so REPOKIT_OUTPUT=plain or
# REPOKIT_STRICT_BRANCHES="" loosen or change one run without editing files.
# Returns 1 when a settings file exists but cannot be read; 0 otherwise
# (including no copy found or no python: nothing is set).
rk_read_settings() {
    [ -n "$CONFIG_TOOL" ] || return 0
    command -v python >/dev/null 2>&1 || return 0
    _rk_keep=""
    for _rk_key in "$@"; do
        _rk_var="REPOKIT_$(printf '%s' "$_rk_key" | tr 'abcdefghijklmnopqrstuvwxyz-' 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_')"
        if eval "[ \"\${$_rk_var+set}\" = set ]"; then
            _rk_keep="$_rk_keep $_rk_var"
            eval "_rk_saved_$_rk_var=\"\$$_rk_var\""
        fi
    done
    _rk_out="$(python "$CONFIG_TOOL" --shell "$@")" || return 1
    eval "$_rk_out"
    for _rk_var in $_rk_keep; do
        eval "$_rk_var=\"\$_rk_saved_$_rk_var\""
    done
    return 0
}

# rk_setup_output -- sets RK_OK, RK_WARN, RK_FAIL, RK_INFO and the colour codes
# RED, GREEN, YELLOW, BLUE, NC. The `output` setting (or REPOKIT_OUTPUT, which
# wins) is auto, plain or rich. auto: rich when the hook's output is a terminal,
# plain otherwise -- captured output (an IDE's git panel, CI, a tool) gets
# [OK]/[!]/[X] and no escape codes, which every console can show. Rich uses
# BMP symbols only; the astral emoji some consoles cannot draw are not used.
# Read settings (with the output key) first.
rk_setup_output() {
    _rk_mode="${REPOKIT_OUTPUT:-auto}"
    if [ "$_rk_mode" = auto ]; then
        if [ -t 1 ]; then _rk_mode=rich; else _rk_mode=plain; fi
    fi
    if [ "$_rk_mode" = rich ]; then
        RK_OK="✓"; RK_WARN="⚠"; RK_FAIL="✗"; RK_INFO="▸"
        RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
    else
        RK_OK="[OK]"; RK_WARN="[!]"; RK_FAIL="[X]"; RK_INFO="--"
        RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
    fi
}

# Branches where private content may be committed.
rk_is_private_branch() {
    case "$1" in
        local|private|feature/*|feat/*|prototype/*|experiment/*|spike/*) return 0 ;;
    esac
    return 1
}

# rk_is_strict_branch BRANCH -- true when BRANCH matches strict-branches (shell
# glob patterns, one per line or space-separated), or git-repokit's default set
# when the project sets none: main (passes CI), master (its other name),
# staging (pre-release) and live (production). Read settings first.
rk_is_strict_branch() {
    if [ "${_RK_ENV_STRICT-}" = set ] || [ -n "${REPOKIT_STRICT_BRANCHES-}" ]; then
        _rk_patterns="${REPOKIT_STRICT_BRANCHES-}"     # the environment's (even empty) or the setting's
    else
        _rk_patterns="$RK_DEFAULT_STRICT_BRANCHES"     # the project sets none
    fi
    # Patterns are matched, never expanded against files.
    _rk_noglob_was=""
    case $- in *f*) _rk_noglob_was=1 ;; esac
    set -f
    for _rk_p in $_rk_patterns; do
        case "$1" in
            $_rk_p) [ -z "$_rk_noglob_was" ] && set +f; return 0 ;;
        esac
    done
    [ -z "$_rk_noglob_was" ] && set +f
    return 1
}
