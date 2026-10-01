---
type: concept
title: Agents knowledge bootstrap — plan
description: Files created and decisions taken to install the knowledge system.
tags: [change, agents-knowledge-bootstrap, plan]
---

# Plan — agents knowledge bootstrap

## Current code

No code changes. Observable repository state before this change:

- `AGENTS.md`, `CHANGELOG.md`, `knowledge/` do not exist (`ls -a` on the root).
- No IDE agent folders (`.cursor/`, `.claude/`) exist either.
- Scripts available for verification: `bun run typecheck`, `bun test tests/unit`,
  `bun run test:integration`.
- Product truth was spread across: `README.md` (pt-BR, human), the source tree under `src/core/`
  (behaviour), `tests/unit/*` (invariants as assertions) and the working session (spec + decisions).

## Affected components

Documentation only:

```
AGENTS.md
CHANGELOG.md
knowledge/rules/README.md
knowledge/rules/{artifacts-language,safety-invariants,registry-and-state,macos-tooling,change-bundles}.md
knowledge/product/README.md
knowledge/product/{product-overview,install-pipeline,version-truth-and-updates,security-policy,registry-and-cli-contract,known-limitations}.md
knowledge/changes/README.md
knowledge/changes/2026-09-29/dmngr-mvp/{README,spec,plan,tasks}.md
knowledge/changes/2026-09-29/agents-knowledge-bootstrap/{README,spec,plan,tasks}.md
```

## Technical decisions

1. **Language split.** English for agent-facing durable artifacts (`AGENTS.md`, `knowledge/`,
   `CHANGELOG.md`); pt-BR stays for the human surface (`README.md`, CLI strings, existing source
   comments). No existing file is rewritten to satisfy the new language rule, and the split is stated
   in both `AGENTS.md` and `knowledge/rules/artifacts-language.md`.
2. **Rules grounded, not aspirational.** Only constraints already enforced by the code/tests became
   rules (e.g. `codesign` blocking, `--yes` not consenting to ambiguity, no shell interpolation). Not-yet
   -implemented features (downgrade opt-in, uninstall, `import`) are documented as limitations.
3. **Five rules, one topic each**, to keep always-on context small: language, safety, registry/state,
   macOS tooling/tests, change bundles.
4. **Product docs split by domain** (overview, pipeline, version truth, security, contracts,
   limitations) instead of one large document, so a task only loads what it needs.
5. **MVP baseline bundle as retroactive documentation.** The implementation shipped before OKF
   adoption; the bundle records the contract, the real architecture and the real evidence, and is
   marked `provenance: retroactive` so it is never mistaken for pre-implementation planning. Without
   it, future changes would have no baseline to diff against.
6. **No IDE mirror.** `.cursor/rules` (or equivalent) is intentionally not created; `knowledge/rules/`
   is portable and `AGENTS.md` points at it.
7. **No scaffolding generator yet.** A Plop/Hygen `okf-change` generator is noted as a follow-up instead
   of being built here (keeps the change documentation-only).

## Data or API changes

None. No registry field, CLI flag, JSON shape or exit code is touched.

## Risks

- **Doc drift** — mitigated by the rules (ground new statements in the repo), by the change-bundle
  requirement (docs updated in the same change set as behaviour), and by keeping behavioural depth in
  product docs rather than duplicating the code.
- **Over-documentation** — mitigated by keeping rules short (bullets) and using the product layer only
  for durable behaviour; change detail stays in bundles.
- **Language inconsistency** — the split is explicit; a future change that wants pt-BR agent artifacts
  must say so, which the rule file records.

## Implementation sequence

1. Discover the repository state (no agent docs; capture scripts, deps, workflows, test evidence).
2. Write `AGENTS.md`.
3. Write `knowledge/rules/` (index + five rules).
4. Write `knowledge/product/` (index + six docs) grounded in `src/` and the test evidence.
5. Write `knowledge/changes/README.md` (convention) and the two bundles.
6. Write `CHANGELOG.md` with entries for the MVP baseline and this bootstrap.
7. Verify the acceptance criteria (files exist, no code file touched, links resolve).

## Deviations

1. **Language rule applied as a documented split** rather than rewriting existing pt-BR artifacts to
   English. The skill's canonical wording targets agent artifacts; rewriting the product's README and
   all existing comments would produce a large diff with no behavioural value and would contradict the
   repo's user-facing language. Recorded in `AGENTS.md` and in the language rule.
2. **Two bundles created on the same date**, one of them retroactive. The bootstrap is the real change;
   the MVP bundle exists because the change convention requires every change set to have a bundle and
   the MVP is the baseline future changes will reference.
