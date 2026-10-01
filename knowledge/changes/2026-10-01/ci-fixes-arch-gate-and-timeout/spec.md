---
type: concept
title: CI green — spec
description: Contract for the cold-start timeout fix and the impossible-architecture gate.
tags: [change, ci-fixes, spec]
---

# Spec — CI fixes

## Problem

Observed in the first CI run (run 36877427878):

1. **arm64 job** — `app bundles > lê identidade, versão e arquitetura` timed out after 5000 ms in the
   unit suite. Locally the same test takes ~100 ms; on a cold runner the first `codesign -s -`,
   `plutil` and `lipo` invocations are much slower than 5 s. The Intel job ran the same suite in
   seconds, so this is environment cold-start, not a logic error.
2. **Intel job** — `fluxo GitHub com API local > arquitetura incompatível…` expected exit code 6
   (architecture blocked) and received 5 (security/signature). Repository facts: when a URL pins an
   asset name explicitly, `selectReleaseAsset()` returns it via the `asset-name` branch without any
   compatibility check; `assetArchConcern()` only handled `needs-rosetta` and `unknown`, so the
   `impossible` case (arm64 build on an x64 machine) produced no concern. The download proceeded and the
   failure surfaced later, from the signature gate — the wrong error, and a violation of
   `knowledge/product/install-pipeline.md` ("arm64 on Intel blocks with no override").

## Goal

Both CI jobs green, with the architecture rule enforced before the download for every path, including
explicitly pinned assets.

## Scope

### In scope

- A global Bun test timeout suitable for cold CI runners (30 s), without weakening the assertions.
- `AssetArchConcern` gains the `impossible` kind; `assetArchConcern()` reports it; `handleArchConcern()`
  throws an `InstallError` (exit 6) with a message that cannot be waived by any flag.
- Unit tests for the new branch, keeping the existing ones honest.
- Bundle, product/rule check, `CHANGELOG.md` entry.
- Bump the GitHub Actions used by the workflows to their current majors
  (`actions/checkout@v7`, `actions/upload-artifact@v7`, `softprops/action-gh-release@v3`), since the
  runners warned that `@v4`/`@v2` were being forced onto Node.js 24.

### Out of scope

- Changing the CI matrix or the release workflow.
- Retrying flaky tests or skipping them on CI.
- Any change to the `needs-rosetta` acceptance policy or to the pinned/channel question.

## Expected behavior

1. A unit test that shells out to system tools may take up to 30 s on a cold runner before failing.
2. `dmngr install <url pinned to an arm64 asset>` on an Intel Mac fails with exit code 6 **before the
   download**, naming the asset and the machine architecture; `--allow-arch-mismatch` and
   `--allow-unverified` do not change this outcome.
3. On Apple Silicon, the same pinned x64 asset keeps the current behavior: confirmation or
   `--allow-arch-mismatch`, exit 5 when nothing is accepted in non-interactive mode.
4. An asset whose architecture cannot be determined (`unknown`) still proceeds with a note and is
   confirmed after the download.

## Scenarios

### Main

- CI: arm64 and Intel jobs run typecheck, unit tests, integration tests, both builds and the smoke test
  to completion.

### Error

- arm64 asset pinned on Intel → exit 6, message names `arm64`/`Intel`, no registry entry created.
- x64 asset pinned on Apple Silicon without acceptance → exit 5 with the `--allow-arch-mismatch` hint
  (unchanged).

### Edge cases

- `unknown` architecture (no token in the name) → no pre-download block, note only.
- `universal` asset on either machine → no concern.
- The impossible case also applies when the machine is x64 and the release only publishes arm64 assets
  selected heuristically — that path already returned an `incompatible` selection; both paths must now
  produce exit 6 for the same reason.

## Acceptance criteria

- [x] `bun test tests/unit` and `DMNGR_INTEGRATION=1 bun test tests/integration` pass locally.
- [x] A preload sets the default test timeout to 30 s and is wired through `bunfig.toml`.
- [x] Unit tests cover `assetArchConcern(..., "x64")` for an arm64 asset returning `impossible`, and the
  integration test asserting exit 6 on Intel passes.
- [x] `handleArchConcern` throws a non-waivable `InstallError` for `impossible`.
- [x] `CHANGELOG.md` has a `Fixed` entry; the bundle records results.
