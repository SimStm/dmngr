---
type: Reference
title: Installation pipeline
description: How an input becomes an installed, registered item — per artifact type.
tags: [product, pipeline, dmg, pkg]
---

# Installation pipeline

Implemented in `src/core/ops/install.ts`, `src/core/ops/apply.ts`, `src/core/install/*`.

## 1. Resolve the input

`src/core/input/resolve.ts` accepts `https://` URLs and local paths. `http://` requires
`--allow-http`; other schemes and `file://` are rejected with a hint. URLs are stored redacted;
URLs whose query carries credentials/signatures (`X-Amz-Signature`, `token`, …) are classified as
`signed-url`, stored without the query, and can only be updated with an explicit `--url`.

GitHub links are recognized in every release form — repo page, `/releases`, `/releases/latest`,
`/releases/tag/<tag>`, both `/download/` forms and the API equivalents (`parseGithubUrl`). A tag pinned
by the URL is compared against the channel head and, when they differ, the choice is always asked
(`--pin` / `--latest` bypass it explicitly). `/archive/` URLs and sections that never hold an
installable file are refused with guidance.

## 2. Discover before downloading

For GitHub sources, `src/core/providers/github.ts` resolves the channel head
(`releaseForChannel`: `releases/latest` for stable, newest non-draft publication for `--prerelease`),
selects the asset (`asset-name` exact → saved pattern exact → machine architecture → universal/unknown),
reports assets that exist only for other platforms, and reads the optional `digest: sha256:…` published
with the asset. Architecture is inferred from the asset name here and confirmed with `lipo` after the
download. `check` uses this metadata only — it never downloads.

## 3. Download and inspect

`src/core/input/download.ts` streams to a private temp dir (`download-<rand>/`) with redirects
followed manually (each hop revalidated), retry with `Retry-After` on 408/425/429/5xx, size limit
(`maxDownloadBytes`), sha256 computed while streaming, and optional comparison with `--sha256` or the
release digest. Partial files are deleted on any failure.

Format is detected from content, never from the extension: XAR (`xar!`) = flat PKG, `koly` trailer =
UDIF DMG (`encrcdsa` = encrypted, unsupported), `PK\x03\x04` = ZIP (unsupported today).

## 4. DMG → `.app`

1. `hdiutil attach -readonly -nobrowse -noverify -noautoopen -plist`; every returned device node is
   remembered and detached in a `finally` (also on SIGINT/SIGTERM via `src/core/cleanup.ts`).
2. `scanMountedImage()` walks at most two levels, skips dotfiles and symlinks (including the
   `/Applications` shortcut inside drag-install DMGs), and rejects anything whose real path escapes
   the mount point. Candidates at the shallowest depth win; more than one requires a choice
   (interactive) or exits with code 3.
3. Identity and version come from `Contents/Info.plist` (`plutil -convert json`), architecture from
   `lipo -archs`.
4. `handleArchConcern()` gates the machine architecture **before the download** for every asset path —
   explicit asset name (`--pin` or a download URL), saved pattern or heuristic: arm64-on-Intel throws
   with exit 6 and cannot be waived, x64-on-Apple-Silicon requires Rosetta 2 plus an explicit
   acceptance. After the download, `checkBundleArchitecture()` repeats the decision with the real bundle
   slices (`lipo -archs`), catching names that lied.
5. `installAppBundle()` (`src/core/install/app-swap.ts`) copies with `ditto` into
   `.dmngr-staging-<rand>` **inside the destination directory** (same filesystem), runs the
   `beforeCommit` verification hook (identity re-read, `codesign --verify --strict`, `spctl`), moves
   any existing app to `.dmngr-backup-<rand>`, renames staging into place, and removes the backup.
   On failure the previous app is restored; if restoration itself fails, both paths are reported and
   the staging directory is preserved.
6. Destination: `--destination` > `config.destinationAppDir` > `/Applications` when writable >
   `~/Applications` (with a warning). Updates stay in the directory where the item already lives
   unless `--destination` is given.

## 5. PKG (direct or inside a DMG)

`src/core/inspect/pkg.ts` inspects without installing: expands with `pkgutil --expand` into a
non-existent temp path, reads component identifiers/versions/`install-location`/`relocatable` and the
`<bundle>` refs inside the payload (which later become `observedApps`), and reports whether the
package ships install scripts. Signature comes from `pkgutil --check-signature` plus
`spctl -t install`.

Installation is `installer -pkg <file> -target /`, executed by `src/core/install/pkg.ts`:
directly when already root, otherwise through an `osascript` argv form with administrator privileges
(GUI prompt), with `--elevate sudo` for terminals and `--elevate none` to refuse and print the manual
command. After a successful install, receipts are read back with `pkgutil --pkg-info-plist` and the
payload's app bundles are confirmed on disk.

Architecture validation for PKG is limited to the asset name from the API: the payload is not
extracted, so there is no `lipo` equivalent before installation.

PKG installation is **not transactional**: scripts run as root and dmngr cannot undo them. This is
announced before installation, and recorded in the item as the `pkg-scripts` override when accepted.

## 6. Persist and finalize

The registry is updated under lock only after success, in `src/core/ops/apply.ts`. `artifact.sha256`
is the hash of the downloaded file, `versionEvidence` says where the version came from, and
`previousVersion` records the version that was replaced. Temp directories are removed unless
`--keep-download`; if a DMG could not be detached, the command warns and prints the paths that were
preserved instead of deleting them.

## Idempotency

`src/core/ops/decide.ts` decides: identical hash ⇒ no-op (unless `--reinstall`), same version with a
different file ⇒ confirmation, newer version ⇒ install, older version ⇒ refused, unknown/uncomparable
⇒ confirmation. `--reinstall` bypasses only the version/hash equality check, never identity or
security checks.
