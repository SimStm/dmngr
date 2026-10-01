---
type: Reference
title: Product overview
description: Identity, audience and non-goals of dmngr.
tags: [product, overview]
---

# Product overview

## Purpose

dmngr installs and updates macOS apps that are distributed as DMG or PKG and that have no package
manager: the user has a URL (usually a GitHub Release asset) or a file on disk, and wants the app
installed, tracked and updatable later without opening the Finder, without leaving temporary
downloads behind and without trusting a filename.

## Audience

- People who install apps from vendor websites / GitHub Releases and want a single place that knows
  what is installed, from where and with which version.
- Scripts and CI jobs that need `--json`, stable exit codes and non-interactive behaviour.

## What it is

- A per-user registry of **apps dmngr itself installed**, with origin, identity, version and the
  evidence used to determine that version.
- A safe pipeline: download → inspect → verify → stage → swap, with the app's identity and signature
  checked before anything installed is touched.
- An honest update checker: it reports `unknown` instead of guessing, and only offers
  `update_available` when the version relationship is proven.

## Non-goals

- Replacing Homebrew, the Mac App Store, or an MDM/enterprise fleet manager.
- Importing or adopting apps that were not installed by dmngr (explicit `import` is future work).
- Detecting updates for arbitrary URLs: a static URL, an ETag or a file date are not versions.
- Generic rollback of PKG installations: install scripts can change services, files and settings
  outside `/Applications`.
- Running as root: dmngr keeps user state and elevates only the `installer` call.

## Invariants

- Only managed items appear in the registry, and every item records how its version was determined.
- A failed or uncertain operation never produces a "successful" registry entry.
- Nothing installed by dmngr is replaced without a backup path or a documented recovery instruction.
