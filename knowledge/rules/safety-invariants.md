---
type: Playbook
title: Safety invariants
description: Rules that keep dmngr from doing something the user did not consent to.
tags: [agents, rules, security]
---

# Safety invariants

- `codesign --verify --strict` failure **blocks** the installation. Never downgrade this to a warning.
- Missing signature / missing notarization, a PKG containing install scripts, a bundle-id change, an architecture change, an app without a native build for this machine and a downgrade all require **explicit** acceptance. `--yes` and `--json` never grant it.
- Architecture acceptance has its own flag (`--allow-arch-mismatch`); an arm64-only app on an Intel Mac is always blocked, regardless of flags.
- Never choose between a version pinned by a URL and the release channel head silently: ask, or exit 3 naming `--pin` / `--latest`.
- Every accepted risk must be recorded in the item's `verification.overrides` and visible in `dmngr info`.
- Never remove `com.apple.quarantine` or otherwise bypass Gatekeeper.
- Never run shell strings: use `run([...])` with argument arrays; for privileged PKG installation use the `osascript` argv form that quotes `item 1 of argv`.
- Never install or replace anything before the artifact's identity and signature were checked on the **staged copy**.
- Never delete a mounted DMG, staging directory or backup that a failure message points to as recovery material.
- Reject non-HTTPS URLs and private/internal hosts unless the user opted in on the command line; revalidate every redirect hop.
- `--yes` answers only unambiguous decisions; ambiguity must exit with code 3.
- See also: `knowledge/product/security-policy.md`
