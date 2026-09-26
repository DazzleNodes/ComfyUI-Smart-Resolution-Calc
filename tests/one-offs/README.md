# One-Off Scripts

Quick checks, one-time diagnostics, and proof-of-concept scripts go here.

## Purpose

This folder is the starting point for experimental code. Scripts here are:
- Quick tests of an idea before writing a proper test
- Diagnostic tools for debugging a specific issue
- Proof-of-concept implementations

## Graduation Path

Scripts naturally evolve through stages:

1. **`tests/one-offs/`** -- Start here. Quick checks, one-time diagnostics.
2. **`tests/`** -- When a one-off proves its value as a repeatable test (pytest-style regression).
3. **`scripts/`** -- When a one-off proves its value as a reusable utility/diagnostic tool.
4. **Project source** -- When a script becomes integral to the project's functionality.

Flow: `one-offs -> tests` (elevated to regression) XOR `one-offs -> scripts` (elevated to reusable tool), and eventually `scripts -> project source` when the tool is genuinely part of the program.

## Guidelines

- Include one-off scripts in commits (they document what you were investigating and why)
- Name scripts descriptively: `test_does_foo_handle_unicode.py`, not `test1.py`
- Add a brief comment at the top explaining what the script tests/investigates
- Don't worry about code quality here -- this is a scratch pad
