---
type: concept
title: Agents knowledge bootstrap — tasks
description: Ordered execution and verification of the knowledge bootstrap.
tags: [change, agents-knowledge-bootstrap, tasks]
---

# Tasks — agents knowledge bootstrap

Update status while implementing. Record the command used for each check.

| # | Task | Depends on | Verification | Status |
| --- | --- | --- | --- | --- |
| 1 | Discover repository state (agent docs, scripts, deps, workflows, test evidence) | — | `ls -a`, `package.json` scripts, `ls .github/workflows` | done |
| 2 | Write `AGENTS.md` (identity, rules pointer, stack, structure, conventions, knowledge, self-learning, DoD, commands, anti-patterns) | 1 | `bun run typecheck` (unchanged) + read-through | done |
| 3 | Write `knowledge/rules/` index + five rule files | 2 | `ls knowledge/rules` matches the index table | done |
| 4 | Write `knowledge/product/` index + six durable docs | 2 | every rule/product statement cross-checked against `src/` and `tests/` | done |
| 5 | Write `knowledge/changes/README.md` convention | 4 | convention matches `AGENTS.md` §"OKF changes" | done |
| 6 | Write the retroactive MVP bundle (`README`, `spec`, `plan`, `tasks`) | 5 | acceptance criteria map to recorded test evidence | done |
| 7 | Write this bootstrap bundle (`README`, `spec`, `plan`, `tasks`) | 5 | acceptance criteria checked in task 9 | done |
| 8 | Write `CHANGELOG.md` linking both bundles | 6, 7 | links resolve on disk | done |
| 9 | Verify acceptance criteria and that no code file changed | 8 | `git status --short` shows only docs; `bun test tests/unit` | done |

## Results

- Files created (documentation only): `AGENTS.md`, `CHANGELOG.md` and 21 files under `knowledge/`
  (`rules/` 6, `product/` 7, `changes/` convention + 2 bundles × 4).
- `git status --short` confirms no modification under `src/`, `tests/`, `package.json` or `.github/`.
- `bun run typecheck` — clean (unchanged code).
- `bun test tests/unit` — 94 tests, 0 failures (unchanged code; run as a baseline sanity check).
- Acceptance criteria in `spec.md`: all checked (see the boxes there), except the documented language
  split, which is recorded as a deviation in `plan.md` and as a rule in
  `knowledge/rules/artifacts-language.md`.

## Limitations

- No `okf-change` generator (Plop/Hygen) yet; bundles are created by hand following the convention.
- IDE-specific rule folders are intentionally not created; if a future change wants them, they must
  mirror `knowledge/rules/` rather than become the source of truth.
