---
type: Reference
title: Agents knowledge bootstrap
description: Install AGENTS.md plus the knowledge/ system (rules, product, OKF changes, changelog).
tags: [change, okf, agents-knowledge-bootstrap]
---

# Agents knowledge bootstrap

## Summary

Set up the repository's agent-facing knowledge system: root `AGENTS.md`, always-on rules under
`knowledge/rules/`, durable product docs under `knowledge/product/`, the OKF change convention under
`knowledge/changes/` (including a retroactive baseline bundle for the MVP), and a root `CHANGELOG.md`.
No product code changes.

## Issues / tasks

| Id | URL |
| --- | --- |
| — (explicit user request: "@bootstrap-agents-knowledge configure no projeto") | — |

## Affected repositories

- `dmngr`

## Product knowledge

- Created in this change: [`product-overview.md`](../../../product/product-overview.md),
  [`install-pipeline.md`](../../../product/install-pipeline.md),
  [`version-truth-and-updates.md`](../../../product/version-truth-and-updates.md),
  [`security-policy.md`](../../../product/security-policy.md),
  [`registry-and-cli-contract.md`](../../../product/registry-and-cli-contract.md),
  [`known-limitations.md`](../../../product/known-limitations.md)

## Related concepts

- [`spec.md`](./spec.md), [`plan.md`](./plan.md), [`tasks.md`](./tasks.md)
- Baseline bundle: [`../dmngr-mvp/README.md`](../dmngr-mvp/README.md)
