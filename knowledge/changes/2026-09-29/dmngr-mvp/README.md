---
type: Reference
title: dmngr MVP
description: Install/update of DMG and PKG from URL or local file with a per-user registry.
tags: [change, okf, dmngr-mvp]
provenance: retroactive
---

# dmngr MVP

> **Provenance: retroactive.** This bundle documents work that was implemented and verified before the
> OKF system was adopted (same date). It was written after the code, from the verified implementation
> and test results, and is kept as the product baseline for future changes. Do not use it as a model
> for pre-implementation planning.

## Summary

First functional version of dmngr: a macOS-only Bun/TypeScript CLI that installs apps from DMG/PKG
URLs or local files, records origin/identity/version in a local registry, and updates them later with
explicit version evidence. Includes the GitHub Releases provider, the two-tier signature policy,
`--json` contracts, stable exit codes and an end-to-end test suite.

## Issues / tasks

| Id | URL |
| --- | --- |
| — (spec provided in the working session, no tracker item) | — |

## Affected repositories

- `dmngr`

## Product knowledge

- [`installed pipeline`](../../../product/install-pipeline.md)
- [`version truth and updates`](../../../product/version-truth-and-updates.md)
- [`security policy`](../../../product/security-policy.md)
- [`registry and CLI contract`](../../../product/registry-and-cli-contract.md)
- [`known limitations`](../../../product/known-limitations.md)

## Related concepts

- `spec.md`, `plan.md`, `tasks.md` in this directory.
