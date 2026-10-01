---
type: concept
title: README rewrite and release automation — spec
description: Contract for the English README and the automated release pipeline.
tags: [change, readme-and-release-automation, spec]
---

# Spec — README rewrite and release automation

## Problem

The README is Portuguese, dense and written for someone who already knows the project; it has no
installation instructions for people who just want the binary. Releases are manual: nothing keeps the
version in `package.json`, `src/version.ts` and the git tag in sync, the CHANGELOG is not promoted per
version, and the GitHub Release description has to be written by hand.

## Goal

A README any macOS user can follow (English, plain language, install → use → update) and a release flow
that, from one click, produces a consistent version everywhere, a dated changelog section, tagged
binaries for both architectures, checksums, and a release description taken from the changelog.

## Scope

### In scope

- `README.md` rewritten in English with: badges (CI, latest release, downloads, license, platform,
  runtime), a short pitch, an "In short" summary, features in plain language, **Install** (download the
  standalone binary, verify its checksum, put it in `~/.local/bin` with PATH guidance or
  `/usr/local/bin` with `sudo`, `chmod +x`), Quick start examples, how updates work, safety in plain
  language, limitations, development, documentation links and license.
- `scripts/release.py` with two subcommands:
  - `prepare --bump patch|minor|major [--allow-dirty] [--dry-run]` — validate the tree, compute the next
    version from `package.json`, refuse when the target tag already exists, refuse when
    `[Unreleased]` is empty, rewrite `package.json` and `src/version.ts`, promote the changelog section
    to `## [X.Y.Z] - YYYY-MM-DD` with a fresh empty `[Unreleased]`, and report
    `version`/`tag` (also to `$GITHUB_OUTPUT` when present). Re-running on an already-tagged HEAD
    resumes instead of bumping again.
  - `notes --version X.Y.Z` — print that version's changelog section, for the release body.
- `.github/workflows/release.yml` rewritten: `workflow_dispatch` with a `bump` input
  (`patch|minor|major`, default `patch`) and `dry_run`; `push` on `v*` tags as a second entry point.
  The job runs typecheck + tests as a gate, prepares the version, commits `chore(release): vX.Y.Z
  [skip ci]`, tags and pushes, builds `bun-darwin-arm64` and `bun-darwin-x64`, writes per-asset
  `.sha256` files plus a combined `SHA256SUMS`, and creates the GitHub Release with the changelog
  section as its body.
- `dmngr -v` works in addition to `--version`, and reports the released version.
- Durable knowledge: `knowledge/product/release-and-versioning.md` and
  `knowledge/rules/release-versioning.md`, plus an `AGENTS.md` command entry.

### Out of scope

- Automatic version bumps on every merge (no semantic-release), prerelease channels, Homebrew cask,
  notarization/code-signing of the dmngr binary itself.
- Changing the release asset names (`dmngr-darwin-arm64`, `dmngr-darwin-x64`).
- Translating `knowledge/` or the CHANGELOG mechanics beyond what is described here.

## Expected behavior

1. **One source of truth.** `package.json.version` and `src/version.ts` `VERSION` are always equal after
   a prepare run, and the git tag is `v` + that version. `dmngr -v`, `dmngr --version` and the release
   name all report the same value.
2. **Changelog-driven release notes.** The description of the GitHub Release is exactly the promoted
   `## [X.Y.Z]` section of `CHANGELOG.md` (English), and the section keeps living in the file.
3. **Fail closed.** Preparing fails, with an actionable message and without changing anything, when:
   `[Unreleased]` has no entries; the file versions disagree; the working tree is dirty (unless
   `--allow-dirty`); the target tag already exists.
4. **Recoverable.** If a release run fails after tagging (tests, build, upload), re-running the workflow
   with any bump value resumes from the existing version instead of creating a new one, and completes
   the build/release.
5. **Tag pushes work too.** Pushing a `vX.Y.Z` tag (with the files already bumped) runs the same build
   and release path; the workflow verifies the tag matches the files and fails loudly when it does not.
6. **Installable by a stranger.** Every command in the README installation section works as written on
   a clean macOS machine, both for Apple Silicon and Intel, without cloning the repository.
7. **Nothing else changes.** No CLI behavior changes besides `-v`; registry schema, flags and JSON
   shapes stay as they are.

## Scenarios

### Main

- Maintainer goes to Actions → Release → Run workflow → `bump: minor` → the version becomes the next
  minor, the changelog section is dated, the tag is created, both binaries and their checksums are
  attached, and the release description lists the changes.
- A user on Apple Silicon runs the two install commands from the README, verifies the checksum, puts the
  binary in `~/.local/bin`, adds it to `PATH` and runs `dmngr --version`.
- A user who already has dmngr re-runs the same commands to update to the newest release.

### Error

- `[Unreleased]` empty → release fails before any commit, telling the maintainer to add a CHANGELOG entry.
- Versions out of sync (`package.json` ≠ `src/version.ts`) → fails before changing anything.
- Tag exists for a different version than the files → fails with the mismatch details.
- Dry run (`dry_run: true`) → prints the plan, changes nothing, creates no tag or release.
- Checksum verification fails for the user → they see the mismatch and stop before installing.

### Edge cases

- Re-running a failed release resumes instead of double-bumping.
- The first release from `0.1.0` works with any bump (the project has no tags yet).
- A version with three components always yields tags like `v0.2.0`; a `-pre` suffix is not supported by
  `prepare` (prerelease channels are out of scope).
- The README installation section must stay valid if the repository owner/name changes → the URLs are
  written from the current remote (`SimStm/dmngr`).

## Acceptance criteria

- [x] `README.md` is fully English, has badges, and contains an Install section with checksum
      verification, the `~/.local/bin` path guidance, the `/usr/local/bin` + `sudo` alternative and
      `chmod +x`.
- [x] `scripts/release.py prepare` updates `package.json`, `src/version.ts` and `CHANGELOG.md`
      (dated section + fresh `[Unreleased]`), refuses empty changelogs/dirty trees/existing tags, and
      reports `version`/`tag`.
- [x] `scripts/release.py notes --version X.Y.Z` prints exactly that changelog section.
- [x] A local dry-run of `prepare` on a scratch clone shows the expected diff and changes nothing in the
      real repository.
- [x] `.github/workflows/release.yml` supports `workflow_dispatch` (`bump`, `dry_run`) and tag pushes,
      runs the test gate, commits/tags, builds both architectures, publishes per-asset `.sha256` files
      and `SHA256SUMS`, and creates the release with the changelog section as the body.
- [x] `dmngr -v` prints the version (in addition to `--version`).
- [x] `knowledge/product/release-and-versioning.md`, `knowledge/rules/release-versioning.md`, the
      `knowledge/product/README.md` index, `AGENTS.md` and `CHANGELOG.md` are updated.
- [x] `bun run typecheck` and `bun test tests/unit` still pass.
