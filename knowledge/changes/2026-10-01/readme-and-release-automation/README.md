---
type: Reference
title: README rewrite and release automation
description: User-facing README in English plus automated version bump, changelog promotion and GitHub Release.
tags: [change, okf, readme-and-release-automation]
---

# README rewrite and release automation

## Summary

Two user-visible pieces of infrastructure: a rewritten `README.md` (English, aimed at any user, with a
real installation section for the standalone binaries) and an automated release flow — a
`workflow_dispatch` (or tag push) workflow that bumps the version in `package.json` and `src/version.ts`,
promotes the `CHANGELOG.md` `[Unreleased]` section into a dated version section, tags `vX.Y.Z`, builds
both architectures, publishes checksums and creates the GitHub Release whose description is the
changelog section. `dmngr -v/--version` reflects the released version because it is compiled from
`src/version.ts`.

## Issues / tasks

| Id | URL |
| --- | --- |
| — (user request in session) | — |

## Affected repositories

- `dmngr`

## Product knowledge

- [`release-and-versioning.md`](../../../product/release-and-versioning.md) — mechanism, sources of truth and recovery

## Related concepts

- [`spec.md`](./spec.md), [`plan.md`](./plan.md), [`tasks.md`](./tasks.md)
