---
type: concept
title: uninstall command — plan
description: Implementation plan for uninstall.
tags: [change, uninstall, cli, plan]
---

# Plan — uninstall

## Current code

- Registry already has `removeItem()` in `src/core/registry/store.ts`.
- Apps land at `item.installedPath`; PKG also tracks `observedApps[]` and `receipts[]`.
- `isAppRunning` / `readAppBundle` / `removePath` exist.
- Limitation documented in `knowledge/product/known-limitations.md`.

## Decisions

1. **Only registered paths** — never search `/Applications` by name alone.
2. **Identity check** before delete when `bundleId` is known.
3. **`--yes` grants the uninstall confirmation** (primary intent of the command); it does not waive
   running-app or identity-mismatch failures.
4. **PKG**: best-effort delete of observed apps + `pkgutil --forget` without sudo; warn about leftovers.
5. **Aliases** via Commander `.alias()` / duplicate commands pointing at the same action.

## Sequence

1. OKF bundle.
2. `src/core/ops/uninstall.ts` + CLI wiring.
3. Unit tests (temp destination, no `/Applications`).
4. Product/README/CHANGELOG; remove “no uninstall” limitation.
5. typecheck + unit tests; commit + push.
