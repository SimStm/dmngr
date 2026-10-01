---
type: concept
title: CI green — plan
description: Files, decisions and risks for the timeout and architecture-gate fixes.
tags: [change, ci-fixes, plan]
---

# Plan — CI fixes

## Current code

| Concern | Where |
| --- | --- |
| Test timeouts | Bun default 5 s; `tests/integration/flows.test.ts` and `tests/integration/github-flow.test.ts` call `setDefaultTimeout(120_000)`; no global preload (`bunfig.toml` does not exist) |
| Asset arch detection | `src/core/system.ts` (`assetArchConcern` lives in `src/core/ops/source.ts`) → `assetArchConcern()` returns `needs-rosetta`/`unknown`/null |
| Pre-download gate | `src/core/ops/install.ts` → `handleArchConcern()` (called by `runInstall`, both `update` paths) |
| Selection short-circuit | `src/core/providers/github.ts` → `selectReleaseAsset()` returns `asset-name`/`saved-pattern` matches without an architecture check |
| Post-download gate | `src/core/ops/apply.ts` → `checkBundleArchitecture()` (already blocks `impossible`) |

## Affected components

- `bunfig.toml` (new) + `tests/helpers/setup.ts` (new).
- `src/core/ops/source.ts` (`AssetArchConcern.kind`, `assetArchConcern`).
- `src/core/ops/install.ts` (`handleArchConcern`).
- `tests/unit/source.test.ts` (new assertions).
- `knowledge/product/install-pipeline.md` (clarify that the explicit-asset path is also gated),
  `CHANGELOG.md`, this bundle.

## Technical decisions

1. **Fix the timeout globally, not test by test.** Every test that signs or inspects a bundle pays the
   cold-start cost; a preload keeps the intent ("these tests shell out to macOS tools") in one place
   instead of scattering `test(..., { timeout })` over 40 call sites.
2. **Keep the `asset-name` short-circuit, gate it afterwards.** The user explicitly asked for that asset;
   rejecting the *selection* would be wrong (it is the only sensible message author), so the architecture
   policy stays in one place — `assetArchConcern` + `handleArchConcern` — and now covers `impossible`
   for every path (explicit name, saved pattern, heuristic).
3. **`impossible` is not waivable.** No flag is consulted; the message says so, matching the product
   rule that an arm64-only app on Intel cannot run.
4. **Leave the post-download `checkBundleArchitecture` as-is.** It remains the authoritative check for
   real Mach-O bundles, including the case where the asset name lied about the architecture.

## Data or API changes

None: exit codes, JSON shapes and flags are unchanged (exit 6 for the impossible case was already the
documented contract).

## Risks

- Raising the default timeout could hide a genuine hang. Mitigated by keeping 30 s (not minutes) and by
  the fact that CI runs the same suite twice (unit + integration) within the job timeout.
- A preload changes behavior for every test file; it is two lines and additive (files that need more
  time still call `setDefaultTimeout` themselves).

## Implementation sequence

1. Bundle (this).
2. `bunfig.toml` + `tests/helpers/setup.ts`.
3. `AssetArchConcern` `impossible` + `assetArchConcern` + `handleArchConcern`.
4. Unit tests for the new branch.
5. Local verification (unit + integration), docs/CHANGELOG, commit and push.

## Deviations

1. **The architecture policy now lives in one place.** Keeping the `asset-name` short-circuit in
   `selectReleaseAsset()` and adding the missing branch to `assetArchConcern()` means every path
   (explicit name, saved pattern, heuristic, and the selection-level `incompatible` result) ends in the
   same non-waivable decision, instead of duplicating compatibility logic in the selector.
2. **`impossible` uses `InstallError` (exit 6), not `SecurityError`.** It is a compatibility failure, not
   a security signal, and the exit code was already the documented contract for this case; the
   integration test expectation (6 on Intel) was therefore kept rather than adjusted.
3. **The test-timeout fix is a preload, not per-test options.** With ~130 tests shelling out to macOS
   tools, a single global limit documents the real constraint ("cold CI runner"), and suites that need
   more (integration) keep their own explicit `setDefaultTimeout(120_000)`.
