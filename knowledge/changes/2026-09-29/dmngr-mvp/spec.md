---
type: concept
title: dmngr MVP — spec
description: Contract satisfied by the first functional version of dmngr.
tags: [change, dmngr-mvp, spec]
provenance: retroactive
---

# Spec — dmngr MVP

> Written after implementation (see the bundle README). Every statement here is verifiable against the
> current code and tests; nothing describes intended-but-absent behaviour.

## Problem

Installing apps that are distributed only as DMG/PKG means: open the Finder, mount the image, drag the
app, remember where it came from, and repeat the whole ritual for every update. Nothing keeps track of
the source or the installed version, and any "check for updates" has to be done by hand.

## Goal

A macOS CLI that installs an app from an HTTPS URL or a local file, registers its origin and identity,
reports the installed version (or `unknown`), and updates it later — without opening the Finder,
without leaving temporary downloads behind, and without ever guessing about versions or identity.

## Scope

### In scope

- `install` from `https://` or a local path; DMG containing a `.app`, PKG directly or inside a DMG.
- Local registry (`~/Library/Application Support/dmngr/registry.json`) for items dmngr installed.
- Origin resolution for GitHub Releases (asset selection by name, saved pattern or architecture).
- `list`, `info`, `check`, `update <item>`, `update <item> --url`, `update <url> --app`, `update --all`,
  `doctor`.
- Flags: `--json`, `--yes`, `--dry-run`, `--reinstall`, `--destination`, `--sha256`, `--keep-download`,
  `--allow-unverified`, `--allow-http`, `--allow-private-network`, `--elevate`, `--app`, `--url`.
- Integrity and trust checks: sha256, two-tier signature policy, identity before installation.

### Out of scope

- Homebrew / MAS / MDM behaviour; importing apps that dmngr did not install.
- ZIP→app, encrypted DMGs, Sparkle feeds, TUI, Finder integration, history/backup of the registry.
- Generic PKG rollback; downgrades (refused, no opt-in flag yet).

## Expected behaviour

1. **Identity first.** An artifact is associated with an existing item by `CFBundleIdentifier` or PKG
   identifiers — never by file name. Installing an artifact whose bundle id already exists continues as
   an update without creating a duplicate.
2. **Version evidence.** The installed version comes from the artifact (`Info.plist`, receipt,
   `Distribution`) and is recorded with `versionEvidence`; `null` is allowed and displayed as
   "versão desconhecida". The version is re-read from disk on `info`/`check`/`update`.
3. **Comparison universe.** A release tag is compared with an app version only while
   `source.tagComparable` is valid; HTTP metadata (ETag/Last-Modified/size) indicates change only.
   `check` returns `update_available | up_to_date | unknown | not_found | error`, and never claims
   `update_available` without evidence.
4. **Safe installation.** DMG is mounted read-only and always detached; candidates are scanned with
   symlink/escape protection; the `.app` is copied to a staging directory in the destination
   filesystem, verified there, and swapped with a backup and automatic restore on failure. PKG is
   inspected before installation and installed with `installer -pkg … -target /`.
5. **Explicit risk.** Invalid signature blocks; missing notarization, PKG install scripts, bundle-id
   change, architecture change and weak identity require explicit acceptance that `--yes` cannot grant,
   each recorded in `verification.overrides`.
6. **Automation contract.** stdout carries data only; `--json` never prompts (exit 3 when a decision is
   needed); exit codes distinguish usage (2), ambiguity (3), network (4), security (5), installation
   (6) and inconsistent state (7).
7. **No silent privilege.** dmngr runs as the user; only `/usr/sbin/installer` is elevated, and
   `--elevate none` explains the manual command instead of escalating.

## Scenarios

### Main

- Install a DMG that contains a single `.app`; the item is registered with bundle id, version, arch,
  sha256 and origin; `list` shows it; running `install` again is a no-op.
- Install a GitHub release asset through `/releases/latest/download/<asset>`; the tag, asset pattern,
  size and digest are recorded; `check` compares the mapped tag.
- Install a PKG directly; identifiers, versions, install location and observed apps are recorded, or
  the item is marked `unknown`/`installedPath: null`.
- `update <item> --url <new>` installs the new artifact and replaces the stored origin.
- `update <url> --app <id>` associates the artifact by identity and updates that item.

### Error

- Hash mismatch (`--sha256` or GitHub digest) → exit 5, nothing installed, partial file removed.
- Unsigned app in non-interactive mode → exit 5 with the `--allow-unverified` hint.
- Downgrade → refused, exit 6.
- Same version but different file, or unknown/uncomparable version, in non-interactive mode → exit 3.
- PKG that requires root with `--elevate none` → exit 6 printing the manual `sudo installer` command.
- Unreadable registry → exit 7.

### Edge cases

- DMG with more than one installable item → interactive choice or exit 3 listing candidates.
- Destination already contains a different app with the same file name → replace / keep both / cancel
  (interactive), exit 3 non-interactively; the occupying app is never overwritten silently.
- App is running → abort with a request to quit it.
- Two different apps that share a display name, or a bundle id installed twice → id suffixes
  (`<id>#2`) and identity-based association, never filename matching.
- GitHub release with several compatible assets (e.g. arm64 + x64) → interactive choice; a single
  compatible asset is selected by architecture.
- URL with credentials/signature → stored without the query, `signed-url`, update requires `--url`.
- Private/internal URL → blocked unless `--allow-private-network`.
- App self-updated by its own updater → `check` refreshes the version from disk and invalidates a stale
  tag mapping.

## Acceptance criteria

- [x] Install a DMG containing a `.app`, record id/version, list it, re-run without duplicating, and
      update with `--url`.
- [x] Install a PKG directly and a PKG inside a DMG; record verifiable identities/versions and clearly
      flag unknown cases.
- [x] Detect a GitHub Release with a single compatible asset; `check` does not download the file,
      `update` downloads and installs only when the choice/version is proven.
- [x] On network, permission, space, integrity, mount or copy errors: never record false success,
      detach/clean up or explain recovery, and preserve the previous `.app` in replacements.
- [x] Cover duplicate names, an app already installed outside dmngr, same version, `--reinstall`,
      unknown version, downgrade, redirects and ambiguous assets.
