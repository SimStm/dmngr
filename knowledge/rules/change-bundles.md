---
type: Playbook
title: Change bundles and changelog
description: Required documentation around every feature or fix.
tags: [agents, rules, okf]
---

# Change bundles and changelog

- Open `knowledge/changes/<yyyy-MM-dd>/<feature-or-fix-name>/` with `spec.md`, `plan.md` and `tasks.md` **before** editing code, and reuse the same directory for follow-ups.
- `spec.md` is the contract (problem, scope, scenarios, acceptance criteria); `plan.md` explains the approach with real file paths; `tasks.md` lists ordered steps and the command that verifies each one.
- Keep repository facts separate from proposals and assumptions. Do not invent behaviour, files or commands.
- On completion: check each acceptance criterion, run the tests, record results/limitations in `tasks.md`, and justify deviations in `plan.md`. State any decision that changes `spec.md` behaviour before editing the spec.
- Add a macro CHANGELOG entry linking the bundle path.
- Bundles marked `provenance: retroactive` are documentation of work that shipped before OKF adoption — do not create new retroactive bundles.
