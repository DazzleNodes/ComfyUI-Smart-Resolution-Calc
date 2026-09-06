# Mutation survivor memory

Triaged *equivalent* and *don't-care* survivors, so future sweeps do not re-litigate them.
Guarded authority, not a blind allowlist: each group is keyed by the target file's content hash
(`git hash-object <file>`, first 12). When the current hash no longer matches the heading, every
entry under it is STALE and must be re-triaged before reuse. Only separated-generation runs
(fresh-context or separate-session generators) may add entries.

## web/utils/prompt_seed.js @ 41d32c68e55a

- `    if (typeof text !== 'string' || !text) return new Map();` -> `    if (typeof text !== 'string') return new Map();`
  **equivalent** -- an empty string reaches `JSON.parse('')`, which throws `SyntaxError`, and the
  `catch` returns the same empty `Map`; the early return is a shortcut with no observable difference.
  2026-09-06, generation mode 1 (fresh subagent, zero tools), sweep `v0.12.4__spec__prompt_seed.json` M8.
- `'value' in raw` -> `Object.prototype.hasOwnProperty.call(raw, 'value')` in `concreteSeed`
  **don't-care** -- the input is a parsed JSON prompt block, whose objects only ever have own
  properties; the two checks differ only for a `value` inherited from a prototype, which is
  outside the contract. 2026-09-06, generation mode 1, sweep `v0.12.4__spec__prompt_seed__round2.json` R8.

## web/smart_resolution_calc.js @ aa9e8ca3a279

- `if (seeds.size > 0) {` -> `if (seeds.size >= 0) {` in the handleFile hook
  **don't-care** -- publishing an empty seed map as the pending entry is observable only in a
  debug line; `applyImageSeed` finds no matching node id and changes nothing. 2026-09-06,
  generation mode 1, sweep `v0.12.4__spec__handlefile_hook.json` W5.
- `setTimeout(() => { if (pendingImageSeeds === entry) pendingImageSeeds = null; }, 5000);` ->
  `setTimeout(() => { pendingImageSeeds = null; }, 5000);`
  **don't-care** -- the identity check only matters when a second image is loaded between
  roughly 4.75 s and 5 s after the first, so that its nodes configure after the first entry's
  timer; a defensive guard, not a contract. 2026-09-06, generation mode 1, same sweep, W6.
