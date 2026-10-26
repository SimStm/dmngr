---
type: concept
title: uninstall command — spec
description: Contract for removing managed apps from disk and the registry.
tags: [change, uninstall, cli, spec]
---

# Spec — uninstall / remove / rm

## Problem

dmngr can install and update apps it manages, but there is no command to remove them. Users must
delete the `.app` by hand and/or edit the registry. `known-limitations.md` listed “no uninstall”.

## Goal

A first-class uninstall that removes the artifact from the **registered** install path and drops the
registry item, with aliases `uninstall`, `remove`, and `rm`.

## Scope

### In scope

- Commands `uninstall` / `remove` / `rm` with the same behaviour.
- App items: delete `installedPath` when present and still the same identity; then unregister.
- PKG items: delete still-present `observedApps` paths (same identity rules); attempt
  `pkgutil --forget` for recorded receipts without elevation; warn that PKG cleanup is incomplete.
- Flags: `--yes`, `--dry-run`, `--keep-files`, `--json`.
- Refuse if the app is running or the on-disk bundle id no longer matches the registry.
- Docs + tests + CHANGELOG.

### Out of scope

- Full PKG rollback (services, scripts, files outside observed apps).
- Elevating to delete from unwritable directories.
- Uninstalling apps dmngr did not install.

## Expected behavior

1. `dmngr uninstall <item>` resolves by id/name/alias; ambiguity → exit 3.
2. Without `--yes` / interactive cancel → exit 3; with `--yes` or interactive yes → proceed.
3. Default: delete registered `.app` path(s), then remove registry item.
4. Path already missing: unregister after confirm (note that disk was already gone).
5. `--keep-files`: only remove the registry entry.
6. `--dry-run`: print plan; no disk/registry mutation.
7. Running app or identity mismatch → exit 6 / 5 respectively; nothing removed.
8. `--json` never prompts.

## Acceptance criteria

- [x] Aliases `uninstall`, `remove`, `rm` share one implementation.
- [x] Unit test: install fixture app → uninstall deletes path and registry entry.
- [x] Unit test: `--keep-files` leaves the `.app` on disk.
- [x] Running app / bundle-id mismatch blocked.
- [x] `bun run typecheck && bun test tests/unit` pass; docs updated.
