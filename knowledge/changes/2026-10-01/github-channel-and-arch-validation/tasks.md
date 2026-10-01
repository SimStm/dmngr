---
type: concept
title: GitHub release channel and architecture validation — tasks
description: Ordered execution with the command that verifies each step.
tags: [change, github-channel-and-arch-validation, tasks]
---

# Tasks — GitHub release channel and architecture validation

| # | Task | Depends on | Verification | Status |
| --- | --- | --- | --- | --- |
| 1 | `src/core/system.ts`: machine arch, macOS version, arch tokens/classification/compatibility, Rosetta probe | — | `bun test tests/unit/system.test.ts` | done |
| 2 | `providers/github.ts`: `listReleases`, `releaseForChannel`, platform/arch-aware `selectReleaseAsset` (+ incompatible result), `fromEnv` API base | 1 | `bun test tests/unit/github.test.ts` | done |
| 3 | `input/resolve.ts`: `parseGithubUrl` with repo/releases/tag/latest/api forms and section errors | 2 | `bun test tests/unit/input.test.ts` | done |
| 4 | Schema `source.pinnedTag` + `OperationOptions` (prerelease, pin, latest, allowArchMismatch) | — | `bun run typecheck` | done |
| 5 | `ops/source.ts`: channel resolution, pin recording, choose-channel/choose-asset, arch concern | 2, 3, 4 | `bun test tests/unit/decide.test.ts` (pure helpers) | done |
| 6 | `ops/{apply,install,update,check}.ts`: pre/post arch validation, channel inheritance, pinned behaviour, `update --all` | 5 | `bun run test:integration` | done |
| 7 | `cli/program.ts`: `--prerelease`, `--pin`, `--latest`, `--allow-arch-mismatch`; `doctor` environment line | 6 | `bun run src/index.ts install --help` | done |
| 8 | Integration test with a local fake GitHub API (channel head, pin question, arch block/override) | 6, 7 | `DMNGR_INTEGRATION=1 bun test tests/integration` | done |
| 9 | Manual smoke against a real repository (channel + prerelease + pinned URL) | 8 | see Results | done |
| 10 | Product docs, README, CHANGELOG, bundle results | 9 | doc/link check like the bootstrap verification | done |

## Results

Verification commands actually run:

- `bun run typecheck` — clean (Bun 1.3.14, TypeScript 5.9).
- `bun test tests/unit` — **131 tests, 0 failures** across 11 files. New/updated coverage:
  `system.test.ts` (arch classification from names and from `lipo` lists, full compatibility matrix,
  Rosetta probe), `github.test.ts` (platform classification, machine-aware asset selection including the
  "x64 on Apple Silicon is installable / arm64 on Intel is not" split, `releaseForChannel` with drafts
  skipped and the newest-publication rule), `source.test.ts` (pinned-vs-head decision, `--pin`,
  `--latest`, `--prerelease`, digest propagation, arch concerns, no-build-for-machine failure,
  `--pin` usage errors), `decide.test.ts` (pinned items and architecture-incompatible releases),
  `input.test.ts` (all new GitHub link forms and refusals), `cli.test.ts` (new flags, exit codes,
  `doctor` environment line).
- `DMNGR_INTEGRATION=1 bun test tests/integration` — **21 tests, 0 failures, 1 skipped** (the root-only
  PKG install). New `github-flow.test.ts` runs the real binary against a local fake GitHub API serving
  real DMGs: pinned URL vs channel head → exit 3; `--latest` installs the head and records
  `channel: stable`; `--pin` installs the pinned version, `update` refuses to leave the pin and
  `--latest` clears it; `--prerelease` picks the newest published release including a prerelease;
  `check` follows the recorded channel and reports `up_to_date`; architecture: arm64 asset on an Intel
  machine blocks with exit 6 (also with `--allow-arch-mismatch`), x64 asset on Apple Silicon requires
  acceptance (exit 5 with no flag, `arch-mismatch` recorded with `--allow-arch-mismatch`); a 404 from the
  API leaves no registry file behind.
- Real-world smoke tests (public API, no download): `install https://github.com/exelban/stats` resolves
  the repo → `v3.0.19` + `Stats.dmg`; the same repo with a `v3.0.18` asset URL reports the pinned/head
  mismatch and exits 3 non-interactively; `--pin` keeps `v3.0.18`; `--prerelease` on `iina/iina` selects
  `v1.5.0-beta2` with its `.dmg`.
- `bun run build:arm64` / `build:x64` — both compile; the compiled binary resolved the real repo
  (`source.channel: stable`, `pinnedTag: null`) in a dry-run.

Limitations recorded:

- The pre-download architecture decision is heuristic (asset name). Post-download `lipo` confirmation is
  authoritative for `.app` bundles; PKG payloads are not checked (documented in `known-limitations.md`).
- The fixture apps in the integration test are scripts, so `lipo` reports no architectures and the
  post-download path is exercised as `unknown`; the `needs-rosetta`/`impossible` post-download branches
  are covered by unit tests of `archsCompatibility`.
- `--prerelease` intentionally includes stable releases (newest publication wins); "prereleases only"
  was rejected by design so opting into prereleases cannot cause a downgrade.
- Interactive prompts (`chooseOne` for pinned-vs-head and the `confirm` for architecture acceptance)
  are not covered by automated tests (no TTY in the test runner); their non-interactive counterparts
  (exit 3 / exit 5 with the flag hints) are.
