---
type: Reference
title: Waive invalid codesign integrity with --allow-unverified
description: codesign --verify --strict failure is no longer an unwaivable hard block; explicit acceptance records override integrity.
tags: [change, okf, security, codesign]
---

# Waive invalid codesign integrity with `--allow-unverified`

## Summary

PhotoCraft 0.16.0 (and similar apps) fail `codesign --verify --strict` with Apple's
“resource fork / Finder information / detritus” message while Gatekeeper still accepts them as
Notarized Developer ID. dmngr treated every `--strict` failure as unwaivable tampering (exit 5).

Integrity failures now follow the same explicit-risk path as missing notarization: interactive
confirm, or `--allow-unverified` in non-interactive mode. Acceptance is recorded as
`verification.overrides: ["integrity"]`. `integrityOk` stays `false` on the item so `info`/`doctor`
remain honest. `--yes` still does not grant this.

## Issues / tasks

| Id | Note |
| --- | --- |
| User report | `dmngr install` of `photocraft-0.16.0-macos-universal.dmg` → exit 5 |

## Affected repositories

- `dmngr`

## Product knowledge

- [`security-policy.md`](../../../product/security-policy.md)
- [`safety-invariants.md`](../../../rules/safety-invariants.md)

## Related concepts

- [`spec.md`](./spec.md), [`plan.md`](./plan.md), [`tasks.md`](./tasks.md)
