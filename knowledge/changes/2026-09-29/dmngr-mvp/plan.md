---
type: concept
title: dmngr MVP — plan
description: Architecture actually used for the MVP, with the deviations discovered while building it.
tags: [change, dmngr-mvp, plan]
provenance: retroactive
---

# Plan — dmngr MVP

> Written after implementation. It describes the code that exists, not an intention.

## Current code

```
src/index.ts                     entry point → runCli()
src/cli/program.ts               Commander program: list/info/check/install/update/doctor
src/cli/render.ts                tables and item/check/doctor renderers
src/core/errors.ts               DmngrError hierarchy + EXIT_CODES (public contract)
src/core/output.ts               Reporter: stdout = data, stderr = progress (progress only on TTY)
src/core/process.ts              run()/runChecked()/runInteractive() via Bun.spawn with arg arrays
src/core/fsx.ts                  writeFileAtomic, sha256File, findFiles, expandHome, isWritableDirectory
src/core/paths.ts                stateDir() (+DMNGR_APP_SUPPORT_DIR), tmpPath/tempDir helpers
src/core/plist.ts                plist → JSON through `plutil -convert json`
src/core/prompts.ts              confirm/chooseOne/askText on stderr; isInteractive()
src/core/cleanup.ts              registerCleanup + SIGINT/SIGTERM/SIGHUP handlers
src/core/config.ts               Config schema + resolveDestinationDirFor()
src/core/versioning.ts           parseVersion/compareVersions/normalizeTag/tagMapsToVersion
src/core/registry/schema.ts      types + hand-written validation
src/core/registry/store.ts       loadRegistry/updateRegistry/saveRegistry/upsertItem/uniqueItemId
src/core/registry/lock.ts        O_EXCL lock file with pid + stale detection
src/core/registry/resolve.ts     matchItems/resolveItem/findItemsByIdentity/suggestItems
src/core/input/resolve.ts        classifyInput, GitHub URL parsing, SSRF policy, URL redaction
src/core/input/download.ts       streaming download, retries, limits, hashing, probeUrl
src/core/input/format.ts         content-based format detection
src/core/inspect/app-bundle.ts   Info.plist + lipo + codesign/spctl assessment, isAppRunning
src/core/inspect/pkg.ts          pkgutil --expand inspection, receipts, payload bundles
src/core/install/dmg.ts          attach/detach lifecycle, candidate scan, listAttachedImages
src/core/install/app-swap.ts     staging/backup/rename + uniqueAppName + stagingArtifacts
src/core/install/pkg.ts          installer elevation paths + observed apps from payload
src/core/ops/*.ts                context, decide, item, live, source, apply, install, update, check, doctor
src/core/providers/github.ts     Releases client, asset selection, digest parsing
tests/unit/*                     offline suite (local Bun.serve for network behaviour)
tests/integration/flows.test.ts  real DMG/PKG flows against the compiled CLI surface
```

## Affected components

All of the above were created by this change; `README.md`, `.github/workflows/*` and `package.json`
scripts exist to ship and document it.

## Technical decisions

1. **Bun + TypeScript strict, macOS-only, Commander as the only runtime dependency.** Everything else
   is `node:*`/Bun built-ins and system tools; the standalone compile stays small and dependency-free.
2. **JSON registry (schemaVersion 1) with atomic writes and a file lock.** Writes go through
   `updateRegistry()`; the lock is an `O_EXCL` file containing pid + timestamp, with stale detection
   because the runtime has no `flock`.
3. **`plutil -convert json` instead of a plist parser** for `Info.plist`, `hdiutil -plist` output and
   `pkgutil --pkg-info-plist`.
4. **Manual redirect handling** so every hop can be revalidated against the SSRF policy.
5. **Statement of intent per decision** (`decide.ts`): artifact decisions are pure functions, so the
   version/downgrade/unknown matrix is unit-testable without touching the system.
6. **Two-tier signature policy** — `codesign --verify --strict` blocks; `spctl` rejection is an
   explicit-risk dialog. Chosen because ad-hoc/self-signed apps are common and legitimate, while a
   failed integrity check is a tampering signal.
7. **osascript argv form for elevation** (`on run argv` + `quoted form of item 1 of argv`) so paths can
   never be injected into the shell command.
8. **Digest-first updates** — when the GitHub release publishes a sha256 matching the installed
   artifact, `update` skips the download entirely.
9. **Exit codes as a contract** (0/1/2/3/4/5/6/7) with `--json` errors emitted as JSON on stderr.

## Data or API changes

- New on-disk formats: `registry.json` (schemaVersion 1), `config.json`, `registry.lock`.
- No network API is produced; GitHub is consumed read-only, with `GITHUB_TOKEN` optional.
- Public CLI surface and JSON shapes documented in `knowledge/product/registry-and-cli-contract.md`.

## Risks

- **PKG non-transactionality** — mitigated by pre-install inspection, script detection and explicit
  acceptance; not solvable in-process.
- **`spctl`/`codesign` output format drift across macOS versions** — mitigated by parsing loosely and
  asserting outcomes (integrity vs Gatekeeper acceptance) rather than raw text in tests.
- **SSRF via DNS rebinding** — mitigated by revalidating every redirect hop and resolving all
  addresses; a CLI cannot fully pin addresses, which is documented.
- **Destination conflicts on systems where `/Applications` is not writable** — mitigated by the
  `--destination`/config fallback to `~/Applications` with a warning.
- **Version guesswork** — deliberately avoided: `unknown` is returned instead of a guess.

## Implementation sequence

0. Skeleton: errors/exit codes, output discipline, process runner, args.
1. State: registry schema/store/lock/resolution, config, `list`/`info`.
2. Input: classification, SSRF, download, format detection.
3. DMG → `.app`: attach/detach, scan, identity, staging/swap.
4. PKG: inspect, signature, elevation, receipts, observed apps.
5. Providers and updates: GitHub client, `check`, `update`, `--reinstall`, downgrade refusal, `--all`.
6. Polish: `--json` everywhere, `doctor`, README, CI, standalone builds.

## Deviations

Discovered during implementation; all are reflected in the shipped code and the product docs.

1. **`PackageInfo` is not `plutil`-parsable** (root tag `<pkg-info>`) → attributes are read from the
   XML with a small extractor instead of a plist conversion.
2. **`pkgutil --expand` fails on an existing directory** (error 17) → `tempPath()` returns a
   not-yet-created path.
3. **Signature detection bug found against a real notarized app**: Developer ID apps print
   `Signature size=…`, not `Signature=…`; detection now accepts both. This is why an end-to-end check
   against a real release is part of the verification.
4. **`--destination` creates the directory** (mkdir) instead of failing when it does not exist; a path
   that exists but is not a directory still fails with a usage error.
5. **`--dry-run` semantics split**: URL inputs stop after metadata (declared in the output); local files
   are inspected read-only (the DMG is mounted) and the plan lists every requirement the real run
   would need.
6. **Digest-based no-op** was added so `update` does not re-download an artifact that provably matches
   the installed hash.
7. **`lastCheckStatus` added to the registry item** so `check` can persist its verdict alongside
   `lastCheckedAt`, keeping `lastResult` (install/update outcome) meaningful.
8. **Refused downgrade uses exit code 6** (installation-family failure) rather than 3, because the
   decision is deterministic, not ambiguous.
