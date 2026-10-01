---
type: Playbook
title: Release and versioning
description: Versions are written only by the release script; the changelog drives the release notes.
tags: [agents, rules, release]
---

# Release and versioning

- Never edit `package.json` `version` or `src/version.ts` `VERSION` by hand: `scripts/release.py prepare`
  writes both together, and a mismatch fails the release.
- Every change set gets an entry under `## [Unreleased]` in `CHANGELOG.md` (English, Keep a Changelog
  categories). An empty `[Unreleased]` blocks the next release by design.
- The release description is the promoted changelog section — write it for users, not for maintainers.
- Never edit the section of an already published version; add a new `[Unreleased]` entry instead.
- Keep the release asset names (`dmngr-darwin-arm64`, `dmngr-darwin-x64`) and the `releases/latest/download/`
  URLs stable: the README installation commands depend on them.
- Release only from a green quality gate; the workflow runs typecheck + unit + integration tests before
  touching the version files.
- See also: `knowledge/product/release-and-versioning.md`
