---
type: Reference
title: Always-on agent rules
description: Short, agent-agnostic rules. Load every file in this directory before implementing.
tags: [agents, rules]
---

# Always-on rules

These files are **tool-agnostic**. `AGENTS.md` instructs agents to read every `*.md` here (except this README) at the start of a task.

Keep each rule short and enforceable. Prefer linking to `knowledge/product/` for deep context.

| File | Topic |
| --- | --- |
| [`artifacts-language.md`](./artifacts-language.md) | Language split between agent artifacts and the pt-BR product surface |
| [`safety-invariants.md`](./safety-invariants.md) | Non-negotiable security and confirmation rules |
| [`registry-and-state.md`](./registry-and-state.md) | Where state lives and how it may be written |
| [`macos-tooling.md`](./macos-tooling.md) | How to drive native tools and platform tests |
| [`change-bundles.md`](./change-bundles.md) | OKF bundle required before code, CHANGELOG after |
| [`release-versioning.md`](./release-versioning.md) | Version numbers, changelog-driven releases, stable asset names |
