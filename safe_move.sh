#!/bin/bash
# Safe archive helper v4: hash-verified move with full timestamp preservation
#
# Usage: safe_move.sh <source_file> <dest_dir> [addendum_text]
#
# Arguments:
#   source_file   - Path to the file to move
#   dest_dir      - Destination directory (created if it doesn't exist)
#   addendum_text - Optional text to append after the move
#
# Workflow:
# 1. Record all timestamps (Creation, LastWrite, LastAccess) via PowerShell
# 2. Use 'preserve MOVE --no-manifest' for hash-verified safe move
# 3. Optionally append addendum to the moved file
# 4. Restore all original timestamps via PowerShell
#
# Requires: preserve (pip install preserve), PowerShell (Windows)

set -euo pipefail

if [ $# -lt 2 ]; then
    echo "Usage: safe_move.sh <source_file> <dest_dir> [addendum_text]"
    echo "  source_file   - File to move"
    echo "  dest_dir      - Destination directory"
    echo "  addendum_text - Optional text to append after move"
    exit 1
fi

SRC="$1"
DST_DIR="$2"
ADDENDUM="${3:-}"
BASENAME=$(basename "$SRC")
DEST="$DST_DIR/$BASENAME"

# Verify source exists
if [ ! -f "$SRC" ]; then
    echo "FAIL: Source file not found: $SRC"
    exit 1
fi

# Create destination if needed
mkdir -p "$DST_DIR"

# Convert to Windows paths for PowerShell
WIN_SRC=$(cygpath -w "$SRC" 2>/dev/null || readlink -f "$SRC" 2>/dev/null || echo "$SRC")
WIN_DST=$(cygpath -w "$DEST" 2>/dev/null || echo "$DST_DIR/$BASENAME")

# Step 1: Record ALL original timestamps via PowerShell
TIMESTAMPS=$(powershell.exe -Command "
  \$f = Get-Item '$WIN_SRC'
  '{0}|{1}|{2}' -f \$f.CreationTime.ToString('yyyy-MM-ddTHH:mm:ss.fffffff'), \$f.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss.fffffff'), \$f.LastAccessTime.ToString('yyyy-MM-ddTHH:mm:ss.fffffff')
" | tr -d '\r')

CTIME=$(echo "$TIMESTAMPS" | cut -d'|' -f1)
MTIME=$(echo "$TIMESTAMPS" | cut -d'|' -f2)
ATIME=$(echo "$TIMESTAMPS" | cut -d'|' -f3)

# Step 2: Use preserve MOVE for hash-verified transfer
preserve MOVE "$SRC" --dst "$DST_DIR" --flat --no-manifest --hash SHA256 -q 2>/dev/null

# Verify file arrived
if [ ! -f "$DEST" ]; then
    echo "FAIL: $BASENAME not found in $DST_DIR/ after preserve MOVE"
    exit 1
fi

# Step 3: Append addendum (if provided)
if [ -n "$ADDENDUM" ]; then
    printf "\n%s" "$ADDENDUM" >> "$DEST"
fi

# Step 4: Restore ALL original timestamps via PowerShell
powershell.exe -Command "
  \$f = Get-Item '$WIN_DST'
  \$f.CreationTime = [DateTime]::Parse('$CTIME')
  \$f.LastWriteTime = [DateTime]::Parse('$MTIME')
  \$f.LastAccessTime = [DateTime]::Parse('$ATIME')
" 2>/dev/null

# Report with verification
FINAL_TS=$(powershell.exe -Command "
  \$f = Get-Item '$WIN_DST'
  'C={0} M={1} A={2}' -f \$f.CreationTime.ToString('yyyy-MM-dd HH:mm:ss'), \$f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'), \$f.LastAccessTime.ToString('yyyy-MM-dd HH:mm:ss')
" | tr -d '\r')

echo "OK: $BASENAME -> $DST_DIR/ [$FINAL_TS]"
