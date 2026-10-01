---
type: concept
title: README rewrite and release automation — tasks
description: Ordered execution with the command that verifies each step.
tags: [change, readme-and-release-automation, tasks]
---

# Tasks — README rewrite and release automation

| # | Task | Depends on | Verification | Status |
| --- | --- | --- | --- | --- |
| 1 | Open the OKF bundle (README/spec/plan/tasks) | — | `ls knowledge/changes/2026-10-01/readme-and-release-automation` | done |
| 2 | `scripts/release.py` (`prepare`, `notes`, dry-run, resumable, guards) | 1 | dry-run on a scratch git repo | done |
| 3 | Rewrite `.github/workflows/release.yml` (dispatch + tag push, gate, checksums, changelog body) | 2 | YAML parse + review | done |
| 4 | `-v, --version` in `src/cli/program.ts` | — | `bun run src/index.ts -v` | done |
| 5 | Rewrite `README.md` (English, badges, install section) | 4 | review + run the install commands locally in a temp dir | done |
| 6 | Product doc `release-and-versioning.md` + rule `release-versioning.md` + index + `AGENTS.md` | 2 | `grep` the index/AGENTS entries | done |
| 7 | CHANGELOG entry for this change | 5, 6 | `python3 scripts/release.py notes --version 0.1.0` shows the section | done |
| 8 | Full verification, bundle results, commit and push | 7 | `bun run typecheck && bun test tests/unit && DMNGR_INTEGRATION=1 bun run test:integration` | done |

## Results

- `python3 scripts/release.py` exercised in three scratch git repositories: happy path (`current`,
  `prepare --bump minor --dry-run`, real `prepare` writing `package.json` + `src/version.ts` +
  `CHANGELOG.md`, `notes --version`), and every guard — dirty tree, out-of-sync versions, empty
  `[Unreleased]`, target tag already existing, `--resume` without a tag. Dry-run changed nothing; the
  promoted changelog produced one blank line between `[Unreleased]` and the new version section, and
  the notes preview matched the final release body.
- `.github/workflows/{ci,release}.yml` parsed as YAML; runner labels verified against the current
  GitHub documentation (`macos-13` no longer exists → CI now uses `macos-15` and `macos-15-intel`).
- `dmngr -v` and `dmngr --version` both print `0.1.0`; `-V` is gone (documented under Changed).
- README installation sequence executed locally with the real binary standing in for the download:
  checksum verification printed `OK`, `chmod +x` + `~/.local/bin` move worked, the moved binary ran, and
  a tampered copy made `shasum -a 256 -c` fail with exit 1 — exactly what the README promises.
- `bun run typecheck` clean; `bun test tests/unit` → 131 pass; `DMNGR_INTEGRATION=1 bun test
  tests/integration` → 21 pass, 1 skipped (root-only PKG install); documentation check → 35 documents,
  frontmatter and relative links OK.

Limitations recorded:

- The real `releases/latest/download/...` URLs and the publish step can only be confirmed by the first
  workflow run on GitHub; locally the commands were validated with a local stand-in for the download.
- Rosetta 2 is not guaranteed on the runners, so the x64 binary is architecture-checked with `file`
  instead of executed; the arm64 binary is executed.
- The release workflow pushes the version commit to the default branch; branch protection must allow the
  Actions token (or the maintainer must run the flow with a user token).
