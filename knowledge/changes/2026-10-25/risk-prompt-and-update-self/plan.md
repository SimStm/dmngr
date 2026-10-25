---
type: concept
title: Structured risk prompts and update-self — plan
description: File-level plan for risk UX and self-update.
tags: [change, cli, ux, update-self, plan]
---

# Plan

## Risk formatting

- Add `src/core/style.ts` (ANSI gated by stderr TTY + `NO_COLOR`).
- Add `RiskNotice` + `formatRiskNotice` / `printRiskNotice` in `src/core/ops/risk.ts` (or
  `src/cli/risk-render.ts`).
- Extend `requireOrNote` to accept `string | RiskNotice`; string path wraps into a simple notice.
- `apply.ts` builds notices from `SignatureAssessment` for integrity / unverified.

## update-self

- Constants: owner `SimStm`, repo `dmngr`, assets `dmngr-darwin-{arm64,x64}`.
- `src/core/ops/update-self.ts`: resolve path via `process.execPath`, reject bun runtimes, use
  `GithubClient.latestRelease`, `compareVersions` / `normalizeTag`, `downloadToFile` with expected
  sha256 parsed from the `.sha256` asset text, atomic replace beside the binary.
- Wire `update-self` in `src/cli/program.ts`.
- Unit tests with `Bun.serve` fake API + temp binary path injection for replace logic where practical.

## Sequence

1. OKF bundle.
2. Style + risk notice + apply call sites.
3. update-self + CLI + tests.
4. Docs / CHANGELOG / changes index.
5. typecheck + unit tests; commit + push.
