---
type: Reference
title: CI green — cold-start timeout and the impossible-architecture gate
description: Fix the flaky unit timeout on cold runners and block explicitly-pinned incompatible assets.
tags: [change, okf, ci-fixes]
---

# CI green — cold-start timeout and the impossible-architecture gate

## Summary

Two fixes found by the first CI run: a 5 s default test timeout is too tight for the first
`codesign`/`lipo` invocations on a fresh macOS runner, and an explicitly pinned asset for the wrong
architecture (`--pin` with an arm64 build on an Intel Mac) was not blocked before the download, so the
user saw a signature error instead of the architecture error. The first is fixed with a global test
preload, the second in `assetArchConcern` + `handleArchConcern`.

## Issues / tasks

| Id | URL |
| --- | --- |
| CI run | https://github.com/SimStm/dmngr/actions/runs/36877427878 (job 110420329997 arm64, job 110420329704 Intel) |

## Affected repositories

- `dmngr`

## Product knowledge

- [`security-policy.md`](../../../product/security-policy.md) — architecture acceptance rules (unchanged
  for the impossible case, now enforced before the download)

## Related concepts

- [`spec.md`](./spec.md), [`plan.md`](./plan.md), [`tasks.md`](./tasks.md)
