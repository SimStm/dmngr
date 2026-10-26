---
type: Reference
title: uninstall / remove / rm
description: Remove a dmngr-managed app from disk at the registered path and drop it from the registry.
tags: [change, okf, uninstall, cli]
---

# uninstall / remove / rm

## Summary

Adds `dmngr uninstall|remove|rm <item>` to delete the managed `.app` at the registered
`installedPath` (and PKG `observedApps` when present), then remove the item from the registry.
Destructive; confirms unless `--yes`. `--keep-files` only forgets the registry entry.
`--dry-run` plans without touching disk or state.

## Affected repositories

- `dmngr`

## Related concepts

- [`spec.md`](./spec.md), [`plan.md`](./plan.md), [`tasks.md`](./tasks.md)
