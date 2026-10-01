---
type: concept
title: Agents knowledge bootstrap — spec
description: Contract for installing the agent knowledge system in dmngr.
tags: [change, agents-knowledge-bootstrap, spec]
---

# Spec — agents knowledge bootstrap

## Problem

The repository has no agent-facing documentation: no `AGENTS.md`, no always-on rules, no durable
product knowledge, no change bundles and no changelog. The product contract (pipeline semantics,
version truth rules, security policy, exit codes, known limitations) exists only in the working
session and in the code itself, so a new session must re-derive it — and risks violating invariants
that are already implemented and tested.

## Goal

Install a portable, agent-agnostic knowledge system that makes the project's real invariants explicit,
keeps durable behaviour out of chat history, and gives every future feature or fix a required planning
bundle plus a macro changelog entry.

## Scope

### In scope

- Root `AGENTS.md`: identity, language/naming rules, stack, structure, real conventions, the three
  knowledge layers, the self-learning loop, definition of done, commands, anti-patterns.
- `knowledge/rules/` — short always-on rules (index + language, safety, state, macOS tooling, bundles).
- `knowledge/product/` — durable domain docs (overview, pipeline, version truth, security, registry/CLI
  contract, limitations).
- `knowledge/changes/` — convention plus two bundles: the retroactive MVP baseline and this bootstrap.
- `CHANGELOG.md` at the repository root.

### Out of scope

- Any change to `src/`, `tests/`, `package.json`, workflows or the CLI surface.
- Backfilling bundles for any other past work (only the MVP baseline, explicitly labelled).
- IDE-specific rule folders (`.cursor/rules`, etc.); the portable `knowledge/rules/` is the source of
  truth. Mirroring into IDE folders can be a later, optional change.
- Plop/Hygen generators for change bundles.

## Expected behaviour

1. `AGENTS.md` instructions are actionable: an agent that reads only it plus `knowledge/rules/*.md`
   knows how to start, what not to break and where to write conclusions.
2. Every rule is a real constraint of this repository (verifiable in code/tests), not generic advice.
   Constraints that are *not* implemented (e.g. `--allow-downgrade`, uninstall) are described as
   limitations instead of rules.
3. Product docs describe behaviour that outlives a change and mirror the implementation; where a
   limitation exists it is stated as such.
4. The change convention requires `spec.md`, `plan.md` and `tasks.md` before code, and `CHANGELOG.md`
   links every bundle path.
5. The retroactive MVP bundle is clearly marked (`provenance: retroactive`) so it is not mistaken for
   pre-implementation planning.
6. Durable artifacts are written in English; the pt-BR human surface (`README.md`, CLI strings,
   existing source comments) stays untouched.

## Scenarios

### Main

- A new agent session starts a feature: it reads `AGENTS.md` → rules → relevant product docs → opens a
  bundle with the three files → implements → updates bundle/CHANGELOG.
- A maintainer wants to know how updates are decided: `knowledge/product/version-truth-and-updates.md`
  answers without reading the source.
- A maintainer checks what is intentionally unsupported: `knowledge/product/known-limitations.md`.

### Error

- A bundle without `spec.md`/`plan.md`/`tasks.md` is a rule violation, caught in review (the convention
  and `AGENTS.md` both state it).
- Documentation drifting from code: the rules require grounding new statements in the repository, and
  the code quality bar requires tests for behaviour changes (which forces doc updates in the same
  change set).

### Edge cases

- Language collision: the bootstrap writes English artifacts in a repository whose README and comments
  are pt-BR. The split is declared in `AGENTS.md` and `knowledge/rules/artifacts-language.md`, and no
  existing file is rewritten.
- Renaming/public-surface rule: the bootstrap must not "tidy up" CLI flags, JSON keys or exit codes.

## Acceptance criteria

- [x] `AGENTS.md` exists at the root with identity, language/naming rules, stack, structure,
      conventions, the three knowledge layers, the planning requirement, the self-learning loop, the
      definition of done, commands and anti-patterns.
- [x] `knowledge/rules/README.md` indexes every rule file, and each rule file carries OKF frontmatter.
- [x] `knowledge/rules/` contains only rules that are true in the current code (verified against
      `knowledge/product/` docs and the source).
- [x] `knowledge/product/` documents overview, pipeline, version truth, security, registry/CLI contract
      and limitations, each consistent with the implementation.
- [x] `knowledge/changes/README.md` documents the convention, including `spec.md`/`plan.md`/`tasks.md`.
- [x] The MVP baseline bundle exists, is labelled `provenance: retroactive`, and its acceptance
      criteria map to the recorded test evidence.
- [x] This bundle (`agents-knowledge-bootstrap`) has `spec.md`, `plan.md`, `tasks.md` and
      `README.md`.
- [x] `CHANGELOG.md` exists, is English, newest first, and links both bundles.
- [x] No file under `src/`, `tests/`, `package.json`, `.github/` or `README.md` is modified by this
      change.
