# Mutation survivors triaged as equivalent or don't-care

Entries expire when the file's `git hash-object` no longer matches its heading; re-triage before reuse.

## hooks/pre-commit @ bb29f4f0fa8c

(Re-triaged 2026-09-27 at this hash: the changes since fb5c666359e6 were header comments, moving the lookup and branch list into hooks/lib.sh, one settings read at the top, and the output markers (#14); the awk line with the CR strip is unchanged, so the entry below stands.)

- `NR == FNR { sub(/\r$/, ""); sub(/^\.\//, "");` -> `NR == FNR { sub(/^\.\//, "");` -- **equivalent (in this environment)**. repokit_config.py on Windows writes CRLF, but Git for Windows' awk (MSYS gawk) strips the CR on input, so entries never carry it (measured: `od -c` shows `a / \r \n`, awk reports length 2). The strip is kept for awk builds that read in binary mode. 2026-09-27, generation mode 1. Update the same day: repokit_config.py now writes LF on every platform, so no CR reaches the hook from it at all; the verdict stands for a second reason.

## hooks/lib.sh @ 3b76d0dcfd09

(Re-triaged 2026-09-27 at this hash: the change since 95cb0599bafc added rk_setup_output (#14 unit 3); rk_locate's line below is unchanged.)

- `if [ -f "$_rk_hooks/../repokit_config.py" ]; then` -> `if [ -f "$_rk_hooks/repokit_config.py" ]; then` -- **don't-care**. It skips the shortcut that finds the copy as the folder above `hooks/`; the fallback (candidate paths, then git's tracked list) reaches the same copy in every layout the installed stub can reach, because the stub finds the copy by the same rules. Cost: one lookup step. 2026-09-27, generation mode 1.

## install-hooks.sh @ 8aa3bc350a29

(Re-triaged 2026-09-27 at this hash: the changes since c099f3b3a05d let the stub fall back to sh when bash is missing and look first where the installer ran from; the chmod line below is unchanged.)

- `chmod +x "$_dst"` -> `chmod -x "$_dst"` -- **equivalent (on Windows)**. Git for Windows runs hooks whatever their executable bit, so no test here can see it; on a POSIX machine git would skip a non-executable hook and the fresh-consumer tests would fail. 2026-09-27, generation mode 1.
