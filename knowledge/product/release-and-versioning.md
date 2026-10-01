---
type: Reference
title: Release and versioning
description: How a dmngr version is defined, bumped, tagged, built and published.
tags: [product, release, versioning, ci]
---

# Release and versioning

## Sources of truth

| Artifact | Role |
| --- | --- |
| `package.json` `version` | Canonical version; read by tooling and by `scripts/release.py` |
| `src/version.ts` `VERSION` | Compiled into the binary; what `dmngr -v` / `dmngr --version` prints |
| Git tag `vX.Y.Z` | Identifies the released commit; `v` prefix is mandatory |
| `CHANGELOG.md` | `[Unreleased]` is the input; the promoted `[X.Y.Z]` section is the release description |
| GitHub Release | Binaries + checksums, described by the changelog section |

Both files are always written together; a mismatch is a hard error (`as versões estão fora de
sincronia`). Version strings are plain `X.Y.Z` (no pre-release suffixes).

## Flow

Releases run in `.github/workflows/release.yml`, triggered by `workflow_dispatch` (inputs: `bump` =
`patch|minor|major`, `dry_run`) or by pushing a `vX.Y.Z` tag.

1. **Quality gate** — `bun run typecheck`, unit tests and integration tests must pass before anything
   changes.
2. **Prepare** (`python3 scripts/release.py prepare --bump <kind>`) — validates the tree, computes the
   next version, promotes the changelog and rewrites the two version files.
3. **Commit and tag** — `chore(release): vX.Y.Z [skip ci]` is pushed to the default branch and an
   annotated tag `vX.Y.Z` is created.
4. **Build** — `bun run build:arm64` and `bun run build:x64` (the Intel binary is cross-compiled on an
   arm64 runner; only its architecture is asserted, not executed).
5. **Checksums** — `<asset>.sha256` per binary plus a combined `SHA256SUMS`, so users can verify a
   download with `shasum -a 256 -c`.
6. **Publish** — GitHub Release named after the tag, description taken verbatim from the changelog
   section via `python3 scripts/release.py notes --version X.Y.Z`.

Asset names are stable and must not change: `dmngr-darwin-arm64`, `dmngr-darwin-x64`. The README
installation commands depend on them, together with the `releases/latest/download/` URL shape.

## Guards (fail closed, change nothing)

- `[Unreleased]` without entries → the release stops; the changelog is the release-notes source.
- `package.json` ≠ `src/version.ts` → stop.
- Dirty working tree → stop unless `--allow-dirty` (local debugging only).
- Target tag already exists → stop, suggesting another bump, tag removal or `--resume`.

## Recovery

- **Run failed after tagging** (tests, build or upload): re-run the workflow. The job detects a tag that
  exists at `HEAD` with no published GitHub Release and calls `prepare --resume`, which reuses the
  current version instead of bumping again.
- **Run failed before tagging**: nothing was committed; re-run with the same or a different bump.
- **Wrong version published**: delete the GitHub Release and the tag, revert the release commit (or bump
  the files back), then re-run. Never edit a published version's changelog section in place — add a new
  entry under `[Unreleased]`.

## Local use

```bash
python3 scripts/release.py current                            # version currently in the files
python3 scripts/release.py prepare --bump minor --dry-run      # plan + preview of the notes
python3 scripts/release.py notes --version 1.0.0 --output notes.md
```

`prepare` writes `version`/`tag`/`resumed` to `$GITHUB_OUTPUT` when that variable exists, which is how
the workflow consumes the result.

## Related

- `CHANGELOG.md` — Keep a Changelog categories (Added, Changed, Fixed, Removed), newest first.
- `AGENTS.md` — "Commands" and the rule against editing version numbers by hand.
- `knowledge/changes/2026-10-01/readme-and-release-automation/` — the change that introduced this flow.
