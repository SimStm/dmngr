---
type: concept
title: Waive invalid codesign integrity — plan
description: Decisions and sequence for the integrity override.
tags: [change, codesign, security, plan]
---

# Plan — waive invalid codesign integrity

## Current code (before)

- `assessAppSignature`: `integrityOk = (codesign --verify --strict).code === 0`.
- `apply.ts` `beforeCommit`: `if (!integrityOk) throw new SecurityError(...)` — unwaivable.
- `requireOrNote` / `--allow-unverified` already cover notarization, identity, pkg-scripts, etc.

## Decisions

1. **Waive via existing risk path**, not a silent detritus special-case. User asked for explicit
   `--allow-unverified` covering all integrity failures, recorded on the item.
2. **Override name `integrity`** (distinct from `unverified`) so `info`/`doctor` show seal failure
   separately from missing notarization.
3. **Keep `integrityOk: false`** after waiver — the assessment is factual; the override is consent.
4. **Do not strip xattrs** and **do not drop `--strict`**.

## Sequence

1. Change `apply.ts`; revert any auto-detritus logic in `assessAppSignature`.
2. Update help, product/rules, CHANGELOG, OKF.
3. Unit test with a Mach-O fixture + resource fork so `--strict` fails.
4. `bun run typecheck && bun test tests/unit`.

## Deviations

- Initial exploration considered auto-passing detritus when non-strict verify succeeds; superseded by
  explicit waiver for all integrity failures (user direction).
