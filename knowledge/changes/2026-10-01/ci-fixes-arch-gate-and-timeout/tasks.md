---
type: concept
title: CI green — tasks
description: Ordered execution with the command that verifies each step.
tags: [change, ci-fixes, tasks]
---

# Tasks — CI fixes

| # | Task | Depends on | Verification | Status |
| --- | --- | --- | --- | --- |
| 1 | Open the OKF bundle | — | `ls knowledge/changes/2026-10-01/ci-fixes-arch-gate-and-timeout` | done |
| 2 | `bunfig.toml` + `tests/helpers/setup.ts` (30 s default timeout) | 1 | `bun test tests/unit` (still green, slower limit applies) | done |
| 3 | `assetArchConcern` reports `impossible`; `handleArchConcern` blocks it with exit 6 | 1 | `bun test tests/unit/source.test.ts` | done |
| 4 | Unit tests for the `impossible` branch | 3 | `bun test tests/unit` | done |
| 5 | Docs + CHANGELOG entry | 3, 4 | docs link/frontmatter check | done |
| 6 | Full local verification and push | 5 | `bun run typecheck && DMNGR_INTEGRATION=1 bun test tests/integration` then watch the CI run | done |
| 7 | Bump workflow actions to the current majors (Node 20 deprecation warning) | 6 | inputs checked against each action's `action.yml`; green CI run | done |

## Results

- Root cause of the Intel failure confirmed against the code path: `selectReleaseAsset()` returns an
  explicitly named asset from the `asset-name` branch without a compatibility check, and
  `assetArchConcern()` had no `impossible` branch — so an arm64 asset pinned with `--pin` on an Intel Mac
  downloaded first and failed later at the signature gate (exit 5 instead of 6).
- Fix verified: `assetArchConcern(asset("App-arm64.dmg"), "x64")` now returns `impossible` (new unit
  test), `handleArchConcern()` throws `InstallError` (exit 6) with the asset and machine named, and
  `resolveSourceForInput` with `--pin` on an arm64 asset reports the `impossible` concern before the
  download (new unit test using the fake API). The `needs-rosetta` and `unknown` behaviors are
  unchanged.
- Timeout fix verified with a throwaway project: a test that sleeps 6 s passes with
  `preload = ["./tests/helpers/setup.ts"]` and fails with `timed out after 5000ms` without it — i.e. the
  preload, not the assertion, is what changes the limit.
- `bun run typecheck` clean; `bun test tests/unit` → 132 pass (was 131); `DMNGR_INTEGRATION=1 bun test
  tests/integration` → 21 pass, 1 skipped (root-only PKG install).
- Documentation check → all `knowledge/` documents keep frontmatter and resolvable relative links.

- Actions bumped and verified: the inputs used by the workflows (`ref`, `fetch-depth`, `name`, `path`,
  `if-no-files-found`, `tag_name`, `body_path`, `files`, `draft`, `generate_release_notes`) all exist in
  the new majors, confirmed against each action's `action.yml` at the pinned tag.
- The green CI run after the bump is the evidence for this item; the release workflow's publish step can
  only be re-exercised by the next release (its inputs were verified statically).

Limitations:

- The `impossible` end-to-end path (x64 machine + arm64 asset) can only be executed on the Intel runner;
  locally it is covered by unit tests of `assetArchConcern` and by the integration test that now asserts
  exit 6 on `macos-15-intel`.
- The 30 s default is a ceiling for cold starts, not a performance budget; a genuine hang would still
  fail the suite (and the job).
