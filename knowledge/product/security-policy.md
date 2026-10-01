---
type: Reference
title: Security policy
description: Signature tiers, explicit-risk overrides, network and elevation rules.
tags: [product, security, signatures]
---

# Security policy

## Signature verification — two tiers

| Check | Command | Effect |
| --- | --- | --- |
| Integrity | `codesign --verify --strict` on the **staged** copy | Failure **blocks** the installation (`SecurityError`, exit 5) |
| Gatekeeper assessment | `spctl -a -vvv -t exec` | Rejection does **not** block by itself: it requires explicit acceptance |
| Metadata | `codesign -dv --verbose=4` (`Signature size=`, `Authority=`, `TeamIdentifier=`) | Recorded in the item (`signed`, `notarized`, `teamId`) |

`codesign -dv` output varies ("`Signature=adhoc`" vs "`Signature size=…`"), so detection looks for
both forms; a Developer ID app must not be reported as unsigned.

For PKG, the equivalents are `pkgutil --check-signature` (text status) and `spctl -t install`.

## Explicit-risk overrides

Four situations require acceptance that automation must not grant silently:

1. No Apple-verified signature / notarization.
2. PKG with install scripts running as root.
3. Bundle-id change, architecture change, or a weak identity (no `CFBundleIdentifier`, no package
   identifier).
4. An app without a native build for this machine (x64 on Apple Silicon, i.e. Rosetta 2), checked before
   the download from the asset name and again after it from `lipo -archs`.

Each one prompts interactively. In non-interactive mode `--allow-unverified` accepts all of them, and
`--allow-arch-mismatch` accepts only item 4. Every accepted item records the override name in
`verification.overrides` (`unverified`, `pkg-scripts`, `identity-change`, `arch-change`,
`weak-identity`, `arch-mismatch`) so `dmngr info` and `dmngr doctor` can surface it later. `--yes` never
grants these; `--json` never prompts (exit code 3 for choices, 5 for unaccepted risks).

One case cannot be waived: an arm64-only app on an Intel Mac is blocked with no override, because it
cannot run at all.

The Gatekeeper quarantine attribute is never removed, and no DMG content is ever executed.

## Network policy

- HTTPS only; `http://` requires `--allow-http`.
- Every URL hop (including each redirect target) is checked: hostnames like `localhost`, `*.local`,
  single-label names, and private/link-local/CGNAT addresses (including `169.254.169.254`) require
  `--allow-private-network`. DNS is resolved and all returned addresses are evaluated.
- Redirects are followed manually (max 10) so a public URL cannot bounce into the local network.
- Credentials never reach the registry or logs: URLs are redacted (`REDACTED` for sensitive query
  keys, userinfo stripped), and signed URLs keep only origin+path. Tokens (`GITHUB_TOKEN`, `GH_TOKEN`)
  are read from the environment and are never persisted.
- Downloads are capped (`config.maxDownloadBytes`, default 4 GiB) and hashed while streaming.
- Never choose between a version pinned by a URL and the release channel head silently: ask, or exit 3
  naming `--pin` / `--latest`.

## Privilege model

- dmngr itself never runs as root: the registry and config stay per-user under
  `~/Library/Application Support/dmngr`.
- Only `/usr/sbin/installer` is elevated, either via an `osascript` argv form (GUI password prompt,
  no string interpolation), via `--elevate sudo` in a terminal, or not at all (`--elevate none`,
  which prints the exact manual command).
- Writing to `/Applications` is attempted only when the directory is actually writable; otherwise the
  user is told to pass `--destination`.

## Failure behaviour

- Failures never produce a success entry in the registry.
- Staging/backup directories are removed on success; on failure they are preserved and their paths are
  part of the error message (recovery material).
- If a DMG cannot be detached, the command warns, keeps the artifacts and prints the `hdiutil detach`
  command instead of deleting anything that is still mounted.
