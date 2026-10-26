---
type: concept
title: uninstall command — tasks
description: Ordered tasks for uninstall.
tags: [change, uninstall, cli, tasks]
---

# Tasks

| # | Task | Verify | Status |
| --- | --- | --- | --- |
| 1 | OKF bundle | files exist | done |
| 2 | `runUninstall` + CLI aliases | unit | done |
| 3 | Unit tests | `bun test tests/unit/uninstall.test.ts` | done |
| 4 | Docs / CHANGELOG / limitations | review | done |
| 5 | Baseline + commit + push | pass | pending |

## Results

- `bun run typecheck` clean; uninstall unit tests pass (4).
- Deletes registered path after identity + running checks; `--keep-files` / aliases covered.

## Limitations

- PKG: best-effort observed apps + `pkgutil --forget` without sudo.
