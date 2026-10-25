---
type: concept
title: Waive invalid codesign integrity — tasks
description: Ordered tasks for the integrity override.
tags: [change, codesign, security, tasks]
---

# Tasks — waive invalid codesign integrity

| # | Task | Verify | Status |
| --- | --- | --- | --- |
| 1 | OKF bundle updated to waiver approach | review | done |
| 2 | `apply.ts`: `requireOrNote(..., "integrity")` | unit test | done |
| 3 | Help + product/rules + CHANGELOG | review | done |
| 4 | Unit test block + waive + override | `bun test tests/unit` | done |
| 5 | Baseline | `bun run typecheck && bun test tests/unit` | done |

## Results

- `bun run typecheck` clean.
- `bun test tests/unit`: 134 pass (incl. `tests/unit/integrity-override.test.ts`).
- Without `--allow-unverified`, integrity failure → exit 5 with hint; with the flag → install and
  `verification.overrides` contains `integrity`, `integrityOk` stays `false`.

## Limitations

- Does not auto-accept FinderInfo/detritus; PhotoCraft still needs `--allow-unverified` (or an
  interactive yes). That is intentional.
- Ad-hoc fixtures that fail both integrity and Gatekeeper record both `integrity` and `unverified`.
