---
type: Reference
title: GitHub release channel and architecture validation
description: Resolve GitHub links via the API (stable/prerelease channel, platform, architecture) before installing.
tags: [change, okf, github-channel-and-arch-validation]
---

# GitHub release channel and architecture validation

## Summary

Any GitHub link now identifies `org/repo` and is resolved through the public API before installation:
the newest published release of the selected channel (`stable`, or `--prerelease`), the macOS asset for
this machine's architecture (`arm64` vs `x64`), and a pre-download validation against the local system.
When a URL pins a version that is not the channel head, dmngr always asks which one to install;
non-interactive runs exit with code 3 and explain `--pin` / `--latest`.

## Issues / tasks

| Id | URL |
| --- | --- |
| — (user request in session: "quando um link do GitHub for colocado … checar via API qual é a última versão") | — |

## Affected repositories

- `dmngr`

## Product knowledge

- [`version-truth-and-updates.md`](../../../product/version-truth-and-updates.md) — channel resolution, pinned items
- [`install-pipeline.md`](../../../product/install-pipeline.md) — resolve/discover/validate steps
- [`security-policy.md`](../../../product/security-policy.md) — architecture-mismatch acceptance
- [`registry-and-cli-contract.md`](../../../product/registry-and-cli-contract.md) — new flags and `source` fields

## Related concepts

- [`spec.md`](./spec.md), [`plan.md`](./plan.md), [`tasks.md`](./tasks.md)
