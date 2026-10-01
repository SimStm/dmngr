---
type: Reference
title: Change bundles (OKF)
description: Convention for knowledge/changes — one directory per implementation set.
tags: [change, okf, convention]
---

# Change bundles

Spec: [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

```
knowledge/changes/<yyyy-MM-dd>/<feature-or-fix-name>/
  README.md   # frontmatter + summary, issues/tasks, affected repositories, links
  spec.md     # contract: problem, goal, scope, scenarios, acceptance criteria
  plan.md     # current-code analysis, decisions, risks, sequence, deviations
  tasks.md    # ordered tasks, verification command per task, status, results
```

Rules:

1. One directory = one implementation set. Follow-ups on the same change stay in the same directory.
2. Cross-repo work would reuse the identical `<feature-or-fix-name>`; dmngr currently has one repo.
3. Every concept needs OKF frontmatter (`type` required; prefer `title`, `description`, `tags`).
4. `spec.md`, `plan.md` and `tasks.md` are required — the `README.md` does not replace them.
5. Repository facts must be separated from proposals and assumptions; never invent files, commands or
   behaviour.
6. `spec.md`/`plan.md`/`tasks.md` are written **before** implementation; `tasks.md` and `plan.md` are
   updated during and after it (results, limitations, deviations).
7. `provenance: retroactive` marks bundles that document work which shipped before OKF adoption. It is
   allowed for the pre-OKF baseline only — do not create new retroactive bundles.

## Bundles

| Bundle | Purpose |
| --- | --- |
| [`2026-09-29/dmngr-mvp`](./2026-09-29/dmngr-mvp/README.md) | Baseline: install/update of DMG and PKG with a local registry (retroactive documentation) |
| [`2026-09-29/agents-knowledge-bootstrap`](./2026-09-29/agents-knowledge-bootstrap/README.md) | Install `AGENTS.md` + the `knowledge/` system |
