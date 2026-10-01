---
type: concept
title: GitHub release channel and architecture validation — plan
description: Technical approach, real file references, risks and sequence.
tags: [change, github-channel-and-arch-validation, plan]
---

# Plan — GitHub release channel and architecture validation

## Current code

| Concern | Where it lives today |
| --- | --- |
| GitHub URL parsing | `src/core/input/resolve.ts` → `parseGithubReleaseUrl()` (only `/download/` and `/latest/download/` forms; tag pages throw; repo pages return `null`) |
| Release + asset selection | `src/core/providers/github.ts` → `latestRelease()`, `releaseByTag()`, `selectReleaseAsset()` with `ARCH_TOKENS` (no machine awareness, no platform filtering, no "incompatible" outcome) |
| Source resolution | `src/core/ops/source.ts` → `resolveSourceForInput()` / `resolveSourceForUpdate()`; sets `source.channel` from `release.prerelease` |
| Check decisions | `src/core/ops/decide.ts` → `decideGithubCheck()` uses `item.source.tagComparable` and `item.artifact.releaseTag` |
| Check/update orchestration | `src/core/ops/check.ts`, `src/core/ops/update.ts` (always stable channel; `archsOf(item)` only for asset selection) |
| App inspection | `src/core/inspect/app-bundle.ts` → `readAppBundle().archs` (from `lipo -archs`) |
| Registry schema | `src/core/registry/schema.ts` → `SourceInfo` has `channel` and `tagComparable`, no pin information |
| CLI flags | `src/cli/program.ts` → `install`/`update` option blocks |
| Options plumbing | `src/core/ops/context.ts` → `OperationOptions` |

## Affected components

- **New** `src/core/system.ts`: machine architecture, macOS version, architecture tokens/classification
  and compatibility (`ok` / `needs-rosetta` / `impossible` / `unknown`), Rosetta probe.
- `src/core/providers/github.ts`: `listReleases()`, `releaseForChannel()`, `classifyAssetPlatform()`,
  machine-aware `selectReleaseAsset()` returning an explicit incompatible result, `GithubClient.fromEnv()`
  honoring `DMNGR_GITHUB_API_URL`.
- `src/core/input/resolve.ts`: `parseGithubUrl()` (renamed, richer kinds) + non-installable section errors.
- `src/core/registry/schema.ts`: `SourceInfo.pinnedTag` (optional nullable field, no schema bump).
- `src/core/ops/{context,source,decide,apply,install,update,check}.ts`: new options, channel decision
  plumbing, pinned logic, pre/post arch validation, channel inheritance.
- `src/cli/program.ts`, `src/cli/render.ts`: new flags, environment line in `doctor`, report notes.
- Tests: `tests/unit/{system,github,input,decide,cli}.test.ts` (new/extended) and
  `tests/integration/flows.test.ts` (fake GitHub API flow).

## Technical decisions

1. **Machine architecture is an input, not a global.** `system.ts` exposes `machineArch()`; provider and
   selection functions take it as an option so they stay pure and testable for both `arm64` and `x64`
   (CI runs on both).
2. **Two kinds of GitHub reference.** `{tag, asset}` where each may be null: a null tag means "channel
   head", a null asset means "choose from the release". This models repo pages, tag pages and download
   URLs with one shape and removes the special cases in the old parser.
3. **Ask, never guess.** Per the user's decision, a pinned URL that is not the channel head always asks;
   `--pin`/`--latest` are the explicit bypasses, and non-interactive runs fail with exit 3 instead of
   choosing. This keeps `--yes` meaningful without making the URL authoritative.
4. **`--prerelease` = newest published release** (stable included) rather than "newest prerelease only",
   so opting into prereleases can never produce a downgrade relative to a newer stable release.
5. **Architecture compatibility is a two-tier policy**: an `arm64` build cannot run on Intel (hard
   block, `InstallError`/exit 6); an `x64` build on Apple Silicon needs Rosetta 2 and therefore an
   explicit acceptance recorded as `arch-mismatch`. Unknown names/assets are noted and confirmed after
   download, where `lipo` gives the truth.
6. **Pins are recorded, not implied.** `source.pinnedTag` preserves the deliberate choice; `update`
   refuses to leave the pin without `--latest`, and `check` reports the pin instead of claiming an
   update is available.
7. **API base override for tests**: `DMNGR_GITHUB_API_URL`, used by the integration test to serve a fake
   release whose asset URL points at a local HTTP server. Documented as a testing/enterprise hook.
8. **No new runtime dependencies.** Everything uses `fetch`, `Bun.spawn` and existing helpers.

## Data or API changes

- `registry.json`: `items[].source.pinnedTag: string | null` (additive; existing registries stay valid).
- `source.channel` now means the selected channel (`stable` | `prerelease`) instead of the `prerelease`
  flag of the release that happened to be installed.
- New CLI flags and two new `check` reason codes: `pinado-em-outra-versao`, `arquitetura-incompativel`.
- New env var `DMNGR_GITHUB_API_URL` (default `https://api.github.com`).

## Risks

- **Extra API calls** (channel head is always queried when a tag is pinned) — acceptable: metadata only,
  and `GITHUB_TOKEN` raises the rate limit; failures surface as exit 4 without touching the system.
- **Name-based architecture inference is heuristic** — mitigated by post-download `lipo` verification
  before installation, and by never blocking on `unknown`.
- **Prerelease channel semantics** could surprise users who expect "prereleases only" — documented in
  the spec, the product doc and `--help`.
- **`--allow-arch-mismatch` could be used to install something that will not run** — mitigated by
  recording the override, mentioning Rosetta availability, and keeping the impossible direction hard.
- **Existing tests asserting `parseGithubReleaseUrl` throwing on tag pages** will change — the unit test
  is updated as part of the change.

## Implementation sequence

1. `src/core/system.ts` + unit tests (arch classification/compatibility matrices).
2. `providers/github.ts`: `listReleases`, `releaseForChannel`, platform/arch-aware selection, API base
   override + unit tests.
3. `input/resolve.ts`: `parseGithubUrl` + unit tests.
4. Schema (`pinnedTag`) and options plumbing (`OperationOptions`).
5. `ops/source.ts`: channel resolution, choose-channel/choose-asset callbacks, pin recording, arch
   concern reporting.
6. `ops/apply.ts` + `ops/install.ts`/`ops/update.ts`/`ops/check.ts`: pre/post arch validation, channel
   inheritance, pinned update/check behaviour.
7. CLI flags + `doctor` environment line.
8. Integration test with a local fake GitHub API; manual smoke against a real repository.
9. Product docs, README, CHANGELOG, bundle results.

## Deviations

1. **The architecture gate was missing in the `install` path.** The integration test for
   "x64 asset on Apple Silicon without acceptance" installed successfully, revealing that
   `handleArchConcern` was only wired into `update`. Fixed by calling it from `runInstall` and passing
   the outcome through `fetchAndApply` → `applyArtifact`. The spec's "checked before download" now holds
   for both entry points.
2. **A dedicated flag for architecture acceptance.** `--allow-unverified` was the only override, which
   made it impossible to accept an ad-hoc-signed fixture while still exercising the architecture gate.
   Added `--allow-arch-mismatch` (specific to `arch-mismatch`) while keeping `--allow-unverified` as the
   broad override; `requireArchAcceptance` records whichever flag was used.
3. **Pre-download acceptance had to travel to the item.** The acceptance happens before the item exists,
   so `ArchConcernOutcome.overrides` is passed to `applyArtifact` as `preAcceptedOverrides` and seeded
   into `verification.overrides`; without it, a script-only bundle (no `lipo` slices) would report only
   `unverified` and lose the `arch-mismatch` record.
4. **Non-interactive architecture risk exits with 5, not 3.** Accepting an x64-on-arm64 build is a risk
   decision (it needs the `--allow-arch-mismatch`/`--allow-unverified` override), unlike the
   pinned-versus-head *choice*, which exits with 3. `spec.md` did not pin the code; the
   `security-policy.md` documentation now does.
5. **`--prerelease` selects the newest published release, including stable.** Implemented per the user's
   decision; "prereleases only" would allow a downgrade when a newer stable was published after the last
   prerelease. Documented in the product doc and `--help`.
6. **Dry-run shows the channel head and the pending question instead of prompting.** Asking is
   impossible in a non-mutating plan, so the note states the pinned tag, the head tag and the two flags
   that resolve the choice; the JSON report exposes `source.tag`, `source.channel` and
   `source.pinnedTag` for scripts.
7. **`MixedContent`-style edge kept conservative:** a release whose only macOS assets are for the other
   architecture fails with the candidate list (`details.assetsIncompativeis`) rather than silently
   picking something; x64-on-arm64 is the single case that can be accepted.
