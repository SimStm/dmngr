---
type: concept
title: README rewrite and release automation — plan
description: Files, decisions and risks for the README rewrite and the release pipeline.
tags: [change, readme-and-release-automation, plan]
---

# Plan — README rewrite and release automation

## Current code

| Concern | Today |
| --- | --- |
| README | `README.md` (pt-BR): princípios, comandos, exit codes, pipeline, segurança, limites, desenvolvimento |
| Version | `src/version.ts` (`VERSION = "0.1.0"`, compiled into the binary) and `package.json` `version`; no tags yet |
| CLI version flag | `src/cli/program.ts` → `.version(VERSION, "-V, --version", "mostra a versão e sai")` |
| Changelog | `CHANGELOG.md` with `## [Unreleased]` and two entries (MVP baseline, knowledge bootstrap) |
| Release | `.github/workflows/release.yml` on `push: tags: v*` → typecheck, unit tests, integration tests, build arm64/x64, `softprops/action-gh-release` with `generate_release_notes: true`; no version bump, no changelog promotion, no checksums |
| CI | `.github/workflows/ci.yml` on push/PR → typecheck, unit, integration, builds |

## Affected components

- `README.md` — full rewrite (English) modelled on the structure of the reference README: badges,
  one-line pitch, "In short", features, install, quick start, updating, safety, limitations,
  development, docs, license.
- `scripts/release.py` — new: `prepare` and `notes` subcommands (stdlib only, `python3`).
- `.github/workflows/release.yml` — rewrite: `workflow_dispatch(bump, dry_run)` + tag push.
- `src/cli/program.ts` — `-v, --version`.
- `knowledge/product/release-and-versioning.md`, `knowledge/rules/release-versioning.md`,
  `knowledge/product/README.md`, `AGENTS.md`, `CHANGELOG.md`.

## Technical decisions

1. **Version bump is a script, not inline YAML.** `scripts/release.py` is testable locally, keeps the
   workflow readable, and needs no npm dependency (Python 3 ships with the macOS runners and with
   macOS itself for local dry-runs).
2. **Manual trigger with an explicit bump.** `workflow_dispatch` with `patch|minor|major` (default
   `patch`) keeps the maintainer in control; automatic bumps on every merge were rejected as too
   opinionated for a CLI with a hand-written changelog.
3. **Tag push as a second entry point.** `push: tags: v*` supports the "I bumped it myself" flow; the
   workflow validates that `package.json`/`src/version.ts` match the tag and fails loudly otherwise.
4. **CHANGELOG is the release body.** The `[Unreleased]` section is promoted to `## [X.Y.Z] - DATE` and
   becomes the GitHub Release description verbatim, so there is exactly one place to write release
   notes. An empty `[Unreleased]` blocks the release (aligns with the project rule that every change set
   gets a changelog entry).
5. **Resumable releases.** A failed run can be retried: if the current version's tag already points at
   HEAD, `prepare` resumes (no new bump) and the workflow continues to build/release. This avoids
   orphan tags.
6. **Two checksum artifacts.** Per-asset `<asset>.sha256` (verifiable with `shasum -c` without
   `--ignore-missing`, which behaves inconsistently across macOS versions) plus a combined
   `SHA256SUMS` for convenience.
7. **`-v` replaces `-V`.** Commander rejects multiple short flags for one option, and the project has no
   released CLI surface yet, so `-v, --version` matches the request with no compatibility cost.
8. **README written for users, not maintainers.** Jargon is translated (no "bundle id", "codesign",
   "SSRF"); the deep, technical descriptions stay in `knowledge/product/`, linked from the README.
9. **Integration tests stay in the release gate.** They build real DMGs/PKGs in temp directories and are
   already wired for CI, so the release runs the same gate as CI (`bun run test:integration`).

## Data or API changes

- New files: `scripts/release.py`.
- Workflow inputs: `bump`, `dry_run`; workflow env/outputs: `version`, `tag`.
- CLI: `-v` alias added for `--version`. No registry, flag or JSON-shape changes.
- Release assets: binaries gain `.sha256` siblings and a `SHA256SUMS` file.

## Risks

- **Broken install instructions** (wrong URL/asset name) would be user-visible. Mitigated by using the
  existing asset names produced by `bun run build:*` and by verifying the download flow locally with a
  real binary before committing.
- **Version drift** between `package.json`, `src/version.ts` and the tag. Mitigated by a single script
  that writes both files and the workflow validating the tag match on tag pushes.
- **Workflow permissions**: committing and tagging needs `contents: write` (default token). Documented
  in the workflow header; no PAT required.
- **`[skip ci]` on the release commit** hides that commit from CI; acceptable because the release job
  itself runs typecheck + unit + integration before publishing.
- **`python3` availability** on `macos-14` runners and on macOS itself: both ship it; the script is
  stdlib-only.

## Implementation sequence

1. Bundle (`README`, `spec`, `plan`, `tasks`).
2. `scripts/release.py` + local verification on a scratch git repository.
3. `.github/workflows/release.yml` rewrite.
4. `src/cli/program.ts`: `-v, --version`.
5. `README.md` rewrite.
6. Product doc, rule, index, `AGENTS.md`, `CHANGELOG.md` entry.
7. Full checks (`typecheck`, unit, integration, CLI smoke), bundle results, commit and push.

## Deviations

1. **`-v` replaced `-V` instead of being added next to it.** Commander rejects two short flags for one
   option, and the CLI has no published release yet, so the request is honoured without compatibility
   cost. Recorded under Changed in the changelog.
2. **CI runners updated (`macos-13` → `macos-15-intel`).** While writing the release workflow the GitHub
   runner reference showed `macos-13` retired; keeping it would have failed the first CI run. The matrix
   is now `macos-15` (arm64) plus `macos-15-intel` (real Intel), with the native binary smoke-tested per
   runner.
3. **`--resume` is explicit; the workflow detects the recoverable case.** An automatic resume inside
   `prepare` would have re-released the current version right after a *successful* release (tag at HEAD,
   nothing to bump). The script stays deterministic; the workflow checks `gh release view` and calls
   `--resume` only when a tag exists at HEAD with no published release.
4. **Smoke test distinguishes execution from architecture.** Rosetta is not guaranteed on macOS runners,
   so the x64 binary is checked with `file` while the arm64 binary is executed.
5. **README examples use `--json`.** The plain-text CLI messages are still pt-BR (translating the CLI is
   a separate change), so the sample output in an English README uses the JSON contract, which is
   English; the README states this explicitly.
6. **`LICENSE` added.** `package.json` declares MIT and the README badge links to the file, which did
   not exist. Copyright holder is the repository account (`SimStm`) — trivial to adjust.
