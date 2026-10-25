---
type: concept
title: Waive invalid codesign integrity — spec
description: Contract for making codesign --verify --strict failure an explicit-risk override.
tags: [change, codesign, security, spec]
---

# Spec — waive invalid codesign integrity

## Problem

Installing PhotoCraft 0.16.0 fails with exit 5 (“assinatura inválida”) even though:

- Developer ID + stapled notarization ticket are present;
- `spctl -a -t exec` accepts (`Notarized Developer ID`);
- non-strict `codesign --verify` passes;
- `--strict` fails only with the detritus / FinderInfo message.

dmngr hard-threw `SecurityError` on any `!integrityOk`, so `--allow-unverified` could not help and the
item never recorded what happened.

## Goal

Default remains fail-closed. Explicit acceptance (interactive prompt or `--allow-unverified`) may
waive **any** `codesign --verify --strict` failure, recording override `integrity` while keeping
`verification.integrityOk: false`.

## Scope

### In scope

- `applyAppBundle` `beforeCommit`: `requireOrNote(..., "integrity")` instead of hard throw.
- CLI help for `--allow-unverified` mentions invalid signature / integrity.
- Product/rule docs, CHANGELOG, unit test covering block + waive + override record.

### Out of scope

- Auto-accepting detritus without a flag.
- Stripping xattrs.
- Changing PKG signature handling (already uses `requireOrNote` for unsigned).

## Expected behavior

1. Without acceptance → exit 5, hint mentions `--allow-unverified`, nothing installed.
2. With `--allow-unverified` or interactive yes → install proceeds; `verification.overrides` contains
   `integrity`; `integrityOk` remains `false`.
3. Missing notarization still adds `unverified` (may appear together with `integrity`).
4. `--yes` alone never grants integrity acceptance.

## Scenarios

### Main

- PhotoCraft-like DMG + `--allow-unverified` → installed; overrides include `integrity`.

### Error

- Same DMG without flag / non-interactive → exit 5.

### Edge

- Ad-hoc unsigned fixture: both `integrity` and `unverified` may be recorded when both checks fail.

## Acceptance criteria

- [x] Integrity failure uses `requireOrNote` with override name `integrity`.
- [x] Unit test: broken integrity without flag → exit 5; with `--allow-unverified` → override present.
- [x] `bun run typecheck && bun test tests/unit` pass.
- [x] Docs/CHANGELOG/help updated; `integrityOk` stays false when waived.
