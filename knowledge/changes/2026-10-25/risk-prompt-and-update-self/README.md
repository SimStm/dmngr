---
type: Reference
title: Structured risk prompts and dmngr update-self
description: Clearer interactive risk notices during install, plus a self-update command from GitHub Releases.
tags: [change, okf, cli, ux, update-self]
---

# Structured risk prompts and `dmngr update-self`

## Summary

1. **Risk prompts** — integrity / notarization / similar confirmations print a labeled block (app,
   check, result, details) with optional ANSI colors on a TTY, instead of one dense sentence.
2. **`update-self`** — checks `SimStm/dmngr` GitHub Releases (`releases/latest`), compares to the
   compiled `VERSION`, and can download + replace the running binary after sha256 verification.

## Affected repositories

- `dmngr`

## Related concepts

- [`spec.md`](./spec.md), [`plan.md`](./plan.md), [`tasks.md`](./tasks.md)
