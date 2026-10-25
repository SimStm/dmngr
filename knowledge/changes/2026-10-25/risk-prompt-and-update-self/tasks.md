---
type: concept
title: Structured risk prompts and update-self — tasks
description: Ordered tasks.
tags: [change, cli, ux, update-self, tasks]
---

# Tasks

| # | Task | Verify | Status |
| --- | --- | --- | --- |
| 1 | OKF bundle | files exist | done |
| 2 | Style + RiskNotice + risk.ts / apply.ts | unit | done |
| 3 | `update-self` ops + CLI | unit | done |
| 4 | README / product / CHANGELOG / index | review | done |
| 5 | `bun run typecheck && bun test tests/unit` | pass | done |
| 6 | Commit + push | `a8a0a85` on `origin/main` | done |

## Results

- `bun run typecheck` clean; `bun test tests/unit` → 141 pass.
- Risk prompts: labeled stderr block with optional ANSI (`formatRiskNotice`).
- `update-self`: checks `SimStm/dmngr` latest release, verifies sha256, replaces binary.
- Pushed: `a8a0a85` → `origin/main`.

## Limitations

- `update-self` refuses `bun` runtime; needs a writable install directory (no sudo elevation).
- Stable channel only (`releases/latest`).
