---
type: Reference
title: Product knowledge index
description: Durable behaviour of dmngr, independent of any single change.
tags: [product, index]
---

# Product knowledge

Durable behaviour that outlives one change set. Read the files relevant to the task at hand; every rule here is grounded in the implementation and covered by tests.

| File | Covers |
| --- | --- |
| [`product-overview.md`](./product-overview.md) | What dmngr is, who it is for, explicit non-goals |
| [`install-pipeline.md`](./install-pipeline.md) | Input → download → inspect → install → persist, per artifact type |
| [`version-truth-and-updates.md`](./version-truth-and-updates.md) | Version evidence, comparison universes, check statuses |
| [`security-policy.md`](./security-policy.md) | Signature tiers, overrides, SSRF, elevation, redaction |
| [`registry-and-cli-contract.md`](./registry-and-cli-contract.md) | Registry/config schema, JSON output contracts, exit codes |
| [`release-and-versioning.md`](./release-and-versioning.md) | Version sources of truth, release workflow, recovery |
| [`known-limitations.md`](./known-limitations.md) | What dmngr deliberately does not do (yet) |

Change-scoped detail lives in `knowledge/changes/<date>/<name>/`.
