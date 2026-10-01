---
type: concept
title: dmngr MVP — tasks
description: What was executed to deliver the MVP, with the evidence collected.
tags: [change, dmngr-mvp, tasks]
provenance: retroactive
---

# Tasks — dmngr MVP

> Retroactive record. Tasks were executed in the order below; every status reflects a check that was
> actually run, and the commands are the ones used.

| # | Task | Depends on | Verification | Status |
| --- | --- | --- | --- | --- |
| 1 | Project skeleton, error taxonomy, exit codes, output discipline, process runner | — | `bun run typecheck` | done |
| 2 | Registry schema + validation, atomic store, lock, item resolution, config, `list`, `info` | 1 | `bun test tests/unit/registry.test.ts` | done |
| 3 | Input classification, GitHub URL parsing, SSRF policy, download with retries/limits/hash, format detection | 2 | `bun test tests/unit/input.test.ts tests/unit/download.test.ts tests/unit/github.test.ts` | done |
| 4 | DMG attach/detach lifecycle, candidate scan, `.app` identity, staging/backup/swap | 3 | `bun test tests/unit/app-bundle.test.ts tests/unit/install-core.test.ts` | done |
| 5 | PKG inspection (identifiers, versions, scripts, signature) and installation with scoped elevation | 4 | `bun run test:integration` | done |
| 6 | Decision matrix, apply orchestration, `install`/`update`/`check`/`update --all`, GitHub provider | 5 | `bun test tests/unit/decide.test.ts` + integration | done |
| 7 | `doctor`, README, CI workflow, release workflow, standalone builds | 6 | `bun run build:arm64 && ./dist/dmngr-darwin-arm64 --version` | done |
| 8 | Real-world validation against a live GitHub Release | 7 | manual (see Results) | done |
| 9 | Knowledge bootstrap (this OKF system, `AGENTS.md`, rules, product docs, CHANGELOG) | 8 | `ls knowledge/rules product changes` + review | in progress (separate bundle) |

## Results

- `bun run typecheck` — clean.
- `bun test tests/unit` — **94 tests, 0 failures** (`tests/unit/*.test.ts`): version comparison,
  registry validation/store/lock/resolution, input classification + SSRF + redaction, format detection,
  download (redirects, 429 + `Retry-After`, timeout, size limit, hash mismatch, blocked private target),
  `probeUrl` HEAD→Range fallback, GitHub parse/asset selection/client errors, decision matrix,
  app-bundle inspection, signature assessment, staging/swap/backup/restore, CLI contracts
  (help/version/exit codes/JSON/usage errors/dry-run/SSRF block/doctor/corrupt registry).
- `bun run test:integration` — **14 tests, 0 failures, 1 skipped** (the PKG install that requires root,
  gated by `test.skipIf(process.getuid?.() !== 0)`). Covered end to end with real `hdiutil`/`pkgbuild`
  fixtures in temp directories: install DMG→app, no-op re-install, `--reinstall`, update by identity,
  `update --url` (downgrade refused with exit 6, upgrade accepted), `update <url>` on an unknown app
  requiring `--app`, `check` `unknown` for a local source, `list` state, name conflict with a different
  app (exit 3, occupant untouched), PKG inspection/dry-run/security block/`--elevate none`, no DMG left
  mounted, `doctor` free of structural errors.
- Real-world validation: installed `Stats` (`exelban/stats`) from
  `/releases/latest/download/Stats.dmg` — the published sha256 digest matched, the app is signed and
  notarized (no override needed, `teamId RP2S87B72W`), `source.tagComparable` was recorded
  (`v3.0.19` ↔ `3.0.19`), `check` returned `up_to_date` via `mesma-release`, and the following `update`
  skipped the download using the digest (0.1 s).
- Standalone builds: `bun run build:arm64` and `build:x64` (cross-compiled) both produce working
  binaries; `--version` and `list --json` were smoke-tested on the binary.

## Limitations recorded

- The PKG installation test that writes real receipts only runs as root (skipped elsewhere).
- Signature assertions in tests use ad-hoc/unnotarized fixtures; the Developer-ID/notarized path was
  verified manually against the live release above.
- No coverage yet for: `--keep-download`, `update --all` failure paths, `doctor` detections that
  require intentional system damage, Sparkle-fed apps.
