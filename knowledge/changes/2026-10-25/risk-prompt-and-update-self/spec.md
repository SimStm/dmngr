---
type: concept
title: Structured risk prompts and update-self — spec
description: Contract for risk notice formatting and the self-update command.
tags: [change, cli, ux, update-self, spec]
---

# Spec — structured risk prompts and `update-self`

## Problem

1. Interactive integrity prompts dump a long single line that mixes app name, check name, and
   assessment details, hard to scan during install.
2. README tells users to re-run curl to update dmngr; there is no first-party command to check or
   apply a newer public release.

## Goal

Readable risk notices on stderr, and `dmngr update-self` that detects and applies updates from the
public `SimStm/dmngr` releases.

## Scope

### In scope

- Structured risk rendering for `requireOrNote` / risk acceptance (TTY colors when enabled).
- `dmngr update-self` with `--check`, `--dry-run`, `--yes`, `--json`.
- Asset selection `dmngr-darwin-arm64` / `dmngr-darwin-x64`, sha256 from sibling `.sha256` asset.
- Docs: README, CHANGELOG, product notes.

### Out of scope

- Self-update when running via `bun run` (dev); clear error instead.
- Prerelease channel for self-update (stable / `releases/latest` only).
- Elevating with sudo to write to `/usr/local/bin` (tell the user if not writable).

## Expected behavior

### Risk prompts

1. Before confirm / when accepting via `--allow-unverified`, stderr shows a block with at least:
   headline, app (when known), check, result, and key/value detail rows.
2. Without a TTY or with `NO_COLOR`, the same structure without ANSI.
3. `--json` still fails closed without prompting (unchanged exit codes).
4. Flat one-line form remains available for dry-run notes and SecurityError messages.

### `update-self`

1. `dmngr update-self --check` reports `current`, `latest`, `status`
   (`up_to_date` | `update_available` | `unknown`) without downloading.
2. `dmngr update-self` when `update_available`: prompts (or `--yes`), downloads binary + checksum,
   verifies sha256, replaces the executable in place; exit 0.
3. When already latest: no-op exit 0 with clear message.
4. Dev/`bun` invocation: exit 2 with hint to use an installed binary.
5. Not writable install dir: exit 6 with path and hint.

## Acceptance criteria

- [x] Risk integrity prompt uses labeled rows (app / check / result) in unit or CLI coverage.
- [x] `update-self --check` unit-tested against a local fake GitHub API.
- [x] `bun run typecheck && bun test tests/unit` pass.
- [x] README documents `update-self`; CHANGELOG entries present.
